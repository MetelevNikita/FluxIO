import {
  FlagTriangleRight,
  FilePlus2,
  FileText,
  FolderOpen,
  Image,
  Maximize2,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
  Repeat2,
  RadioTower,
  Save,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { attachHlsVideo } from "../hls-video";
import { mediaPath } from "../runtime";
import { mediaThumbnailUrl, startClipPreview, stopClipPreview } from "../media-api";
import { mediaApiUrl } from "../runtime";
import type {
  BroadcastSettings,
  MediaAsset,
  ScheduleMetadata,
  ScheduleOverlayLibrary,
  ScheduleSlot,
  Scte35Marker,
  Scte35MarkerKind,
} from "../types";
import type {
  ScheduleExportExtension,
  ScheduleStartMarker,
  WorkspaceSessionCheckpoint,
} from "@gruber/contracts";

interface PlaylistPreviewScreenProps {
  playlist: MediaAsset[];
  selectedAsset: MediaAsset;
  activeSchedule: ScheduleSlot;
  currentCount: number;
  futureCount: number;
  scheduleMetadata: ScheduleMetadata | null;
  ageLibrary: ScheduleOverlayLibrary | null;
  scheduleLogoSource: string;
  scheduleLogoPath: string;
  scheduleActionMessage: string | null;
  scheduleBusy: boolean;
  workspaceBusy: boolean;
  takeBusy: boolean;
  savedSessionUpdatedAt: string | null;
  recoveryCheckpoint: WorkspaceSessionCheckpoint | null;
  scheduleStartMarker: ScheduleStartMarker | null;
  playoutActive: boolean;
  initialPreviewTimeSeconds: number | null;
  onAddFiles: (files: File[]) => void;
  onAddScte35Marker: (assetId: string, marker: Scte35Marker) => void;
  onMoveItem: (sourceId: string, targetId: string) => void;
  onBulkAgeChange: (assetIds: string[], rating: string | null) => void;
  onBulkLogoChange: (assetIds: string[], enabled: boolean) => void;
  onRemoveItem: (assetId: string) => void;
  onRemoveScte35Marker: (assetId: string, markerId: string) => void;
  onSelectAsset: (assetId: string) => void;
  onScheduleChange: (slot: ScheduleSlot) => void;
  onSaveSchedule: (extension: ScheduleExportExtension) => Promise<void>;
  onSaveSessionList: () => Promise<void>;
  onNewPlaylist: () => Promise<void>;
  onClearStartMarker: () => void;
  onStartFromItem: (assetId: string) => Promise<void>;
  onSelectAgeDirectory?: () => Promise<void>;
  onSelectScheduleLogoDirectory?: () => Promise<void>;
  onSelectScheduleLogoFile?: () => Promise<void>;
  onUpdateItem: (assetId: string, patch: Partial<MediaAsset>) => void;
  scte35Defaults: BroadcastSettings;
}

const AGE_RATINGS = ["0+", "6+", "12+", "16+", "18+"] as const;

export function PlaylistPreviewScreen({
  playlist,
  selectedAsset,
  activeSchedule,
  currentCount,
  futureCount,
  scheduleMetadata,
  ageLibrary,
  scheduleLogoSource,
  scheduleLogoPath,
  scheduleActionMessage,
  scheduleBusy,
  workspaceBusy,
  takeBusy,
  savedSessionUpdatedAt,
  recoveryCheckpoint,
  scheduleStartMarker,
  playoutActive,
  initialPreviewTimeSeconds,
  onAddFiles,
  onAddScte35Marker,
  onMoveItem,
  onBulkAgeChange,
  onBulkLogoChange,
  onRemoveItem,
  onRemoveScte35Marker,
  onSelectAsset,
  onScheduleChange,
  onSaveSchedule,
  onSaveSessionList,
  onNewPlaylist,
  onClearStartMarker,
  onStartFromItem,
  onSelectAgeDirectory,
  onSelectScheduleLogoDirectory,
  onSelectScheduleLogoFile,
  onUpdateItem,
  scte35Defaults,
}: PlaylistPreviewScreenProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const previewContainer = useRef<HTMLDivElement>(null);
  const previewRequest = useRef(0);
  const previewSession = useRef<string | null>(null);
  const seeking = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [volume, setVolume] = useState(72);
  const [previousVolume, setPreviousVolume] = useState(72);
  const [currentTime, setCurrentTime] = useState(932);
  const [trimIn, setTrimIn] = useState(130);
  const [trimOut, setTrimOut] = useState(1_055);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [markerEventId, setMarkerEventId] = useState(scte35Defaults.scte35DefaultEventId);
  const [markerKind, setMarkerKind] = useState<Scte35MarkerKind>("break-start");
  const [markerDuration, setMarkerDuration] = useState(
    scte35Defaults.scte35DefaultBreakDuration,
  );
  const [markerUpid, setMarkerUpid] = useState(scte35Defaults.scte35DefaultUpid);
  const [scheduleExportExtension, setScheduleExportExtension] = useState<ScheduleExportExtension>("air");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set([selectedAsset.id]));
  const [bulkAgeRating, setBulkAgeRating] = useState<string>("16+");
  const ageAssetPaths = ageAssetMap(ageLibrary?.imagePaths ?? []);

  useEffect(() => {
    setSelectedIds((current) => {
      const available = new Set(playlist.map((asset) => asset.id));
      const next = new Set([...current].filter((id) => available.has(id)));
      if (next.size === 0 && selectedAsset.id) next.add(selectedAsset.id);
      return next;
    });
  }, [playlist, selectedAsset.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      setSelectedIds(new Set(playlist.map((asset) => asset.id)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playlist]);

  useEffect(() => {
    const demoTimeline = selectedAsset.id === "production";
    const initialTime = initialPreviewTimeSeconds == null
      ? demoTimeline ? 932 : 0
      : Math.min(initialPreviewTimeSeconds, selectedAsset.durationSeconds);
    setCurrentTime(Math.min(initialTime, selectedAsset.durationSeconds));
    setTrimIn(demoTimeline ? Math.min(130, selectedAsset.durationSeconds) : 0);
    setTrimOut(
      demoTimeline
        ? Math.max(
            Math.min(1_055, selectedAsset.durationSeconds),
            Math.min(130, selectedAsset.durationSeconds),
          )
        : selectedAsset.durationSeconds,
    );
    previewRequest.current += 1;
    previewSession.current = null;
    setPreviewUrl(null);
    setPreviewOffset(0);
    setPreviewBusy(false);
    setPreviewError(null);
    setPlaying(false);
    void stopClipPreview().catch(() => undefined);
  }, [initialPreviewTimeSeconds, selectedAsset.id, selectedAsset.durationSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) {
      return;
    }
    video.muted = true;
    return attachHlsVideo(video, previewUrl, {
      live: false,
      onError: (message) => {
        setPlaying(false);
        setPreviewBusy(false);
        setPreviewError(message);
      },
      onPlaying: () => {
        setPreviewBusy(false);
        setPreviewError(null);
        setPlaying(true);
      },
      onWaiting: () => setPreviewBusy(true),
      retryLimit: 8,
    });
  }, [previewUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume / 100;
      video.muted = previewBusy || volume === 0;
    }
  }, [previewBusy, previewUrl, volume]);

  useEffect(() => () => {
    previewRequest.current += 1;
    void stopClipPreview().catch(() => undefined);
  }, []);

  const selectedIndex = playlist.findIndex(
    (asset) => asset.id === selectedAsset.id,
  );
  const previewSource =
    selectedAsset.id === "production"
      ? mediaPath("program-preview.png")
      : selectedAsset.preview;
  const realMediaPreview = selectedAsset.status === "analyzed" && selectedAsset.id !== "production";
  const scte35Markers = selectedAsset.scte35Markers ?? [];
  const playlistDuration = playlist.reduce(
    (total, asset) => total + (asset.declaredDurationSeconds ?? asset.durationSeconds),
    scheduleMetadata?.delaySeconds ?? 0,
  );
  const scheduleTarget = scheduleMetadata?.targetDurationSeconds ?? 604_800;
  const scheduleVariance = playlistDuration - scheduleTarget;
  const scheduleCoverage = Math.abs(scheduleVariance) < 0.01
    ? "exact"
    : scheduleVariance > 0
      ? "over"
      : "under";

  async function startPreview(position: number): Promise<void> {
    if (!realMediaPreview) {
      setPreviewError("Для воспроизведения импортируйте реальный видеофайл через Electron");
      return;
    }
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewUrl(null);
    previewSession.current = null;
    let waitingForVideo = false;
    try {
      await stopClipPreview();
      const session = await startClipPreview(selectedAsset.filePath, position);
      if (previewRequest.current !== requestId) {
        await stopClipPreview();
        return;
      }
      previewSession.current = session.sessionId;
      setPreviewOffset(session.offsetSeconds);
      setCurrentTime(session.offsetSeconds);
      setPreviewUrl(mediaApiUrl(session.manifestPath));
      waitingForVideo = true;
    } catch (error) {
      if (previewRequest.current === requestId) {
        setPlaying(false);
        setPreviewError(error instanceof Error ? error.message : "Preview failed");
      }
    } finally {
      if (previewRequest.current === requestId && !waitingForVideo) {
        setPreviewBusy(false);
      }
    }
  }

  async function pausePreview(): Promise<void> {
    previewRequest.current += 1;
    const video = videoRef.current;
    if (video) {
      setCurrentTime(Math.min(selectedAsset.durationSeconds, previewOffset + video.currentTime));
      video.pause();
    }
    setPlaying(false);
    setPreviewBusy(false);
    setPreviewUrl(null);
    previewSession.current = null;
    await stopClipPreview().catch(() => undefined);
  }

  async function stopPreview(): Promise<void> {
    await pausePreview();
    setCurrentTime(0);
  }

  async function togglePreview(): Promise<void> {
    if (previewBusy) return;
    if (playing) {
      await pausePreview();
    } else {
      const startAt = currentTime >= selectedAsset.durationSeconds ? 0 : currentTime;
      await startPreview(startAt);
    }
  }

  function updatePreviewTime(relativeSeconds: number): void {
    if (seeking.current) return;
    setCurrentTime(
      Math.min(selectedAsset.durationSeconds, previewOffset + relativeSeconds),
    );
  }

  function finishPreview(): void {
    if (repeat) {
      void startPreview(trimIn);
      return;
    }
    setCurrentTime(selectedAsset.durationSeconds);
    setPlaying(false);
    setPreviewUrl(null);
    previewSession.current = null;
    void stopClipPreview().catch(() => undefined);
  }

  function selectRelative(offset: number) {
    const target = playlist[selectedIndex + offset];
    if (target) {
      onSelectAsset(target.id);
    }
  }

  function toggleMute() {
    if (volume > 0) {
      setPreviousVolume(volume);
      setVolume(0);
    } else {
      setVolume(previousVolume || 72);
    }
  }

  function addScte35Marker(): void {
    const eventId = Math.min(0xffff_ffff, Math.max(0, Math.trunc(markerEventId)));
    const provider = scte35Defaults.scte35Owner === "Provider";
    const segmentationTypeId = markerKind === "break-start"
      ? provider ? 0x34 : 0x36
      : provider ? 0x35 : 0x37;
    onAddScte35Marker(selectedAsset.id, {
      id: globalThis.crypto.randomUUID(),
      positionSeconds: Math.min(currentTime, selectedAsset.durationSeconds),
      eventId,
      kind: markerKind,
      durationSeconds: markerKind === "break-start" ? Math.max(1, markerDuration) : null,
      segmentationTypeId,
      upid: markerUpid.trim(),
    });
    setMarkerEventId((current) => Math.min(0xffff_ffff, current + 1));
  }

  return (
    <main className="playlist-screen">
      <section className="schedule-resource-toolbar">
        <div className="schedule-resource-heading">
          <FileText size={16} />
          <span>
            <strong>Schedule resources</strong>
            <small>AGE is detected from filename suffixes such as [16+]</small>
          </span>
        </div>
        <div className="schedule-resource-control logo-source-control">
          <span>Channel logo</span>
          <strong title={scheduleLogoSource || undefined}>
            {shortPath(scheduleLogoSource) || "Not selected"}
          </strong>
          <div>
            <button disabled={!onSelectScheduleLogoFile || scheduleBusy} onClick={() => void onSelectScheduleLogoFile?.()} type="button">
              <Image size={13} /> File
            </button>
            <button disabled={!onSelectScheduleLogoDirectory || scheduleBusy} onClick={() => void onSelectScheduleLogoDirectory?.()} type="button">
              <FolderOpen size={13} /> Folder
            </button>
          </div>
        </div>
        <div className="schedule-resource-control age-source-control">
          <span>AGE graphics folder</span>
          <strong title={ageLibrary?.directoryPath}>
            {ageLibrary
              ? `${shortPath(ageLibrary.directoryPath)} · ${ageAssetPaths.size} matched`
              : "Not selected"}
          </strong>
          <button disabled={!onSelectAgeDirectory || scheduleBusy} onClick={() => void onSelectAgeDirectory?.()} type="button">
            <FolderOpen size={13} /> Select folder
          </button>
        </div>
        <div className="schedule-save-control">
          <span>Export edited schedule</span>
          <div>
            <select
              aria-label="Schedule export extension"
              onChange={(event) => setScheduleExportExtension(event.target.value as ScheduleExportExtension)}
              value={scheduleExportExtension}
            >
              <option value="air">.AIR</option>
              <option value="txt">.TXT</option>
            </select>
            <button disabled={scheduleBusy || playlist.length === 0} onClick={() => void onSaveSchedule(scheduleExportExtension)} type="button">
              <Save size={14} /> Save schedule
            </button>
          </div>
          <small title={scheduleActionMessage ?? undefined}>
            {scheduleBusy ? "Preparing schedule…" : scheduleActionMessage ?? "Exports current tab and item order"}
          </small>
        </div>
        <div className={`schedule-session-control ${recoveryCheckpoint ? "recovery-pending" : ""}`}>
          <span>Recovery session</span>
          <strong>
            {recoveryCheckpoint
              ? `Interrupted · ${formatHours(recoveryCheckpoint.outTimeSeconds)}`
              : savedSessionUpdatedAt
                ? `Saved · ${new Date(savedSessionUpdatedAt).toLocaleString()}`
                : "Not saved"}
          </strong>
          <div>
            <button
              disabled={workspaceBusy || currentCount + futureCount === 0}
              onClick={() => void onSaveSessionList()}
              type="button"
            >
              <Save size={13} /> Save session list
            </button>
            <button
              className="new-playlist-button"
              disabled={workspaceBusy}
              onClick={() => void onNewPlaylist()}
              type="button"
            >
              <FilePlus2 size={13} /> New playlist
            </button>
          </div>
          <small>Checkpoint updates every 5 seconds while playout is active</small>
          {scheduleStartMarker ? (
            <button
              className="schedule-start-clear"
              onClick={onClearStartMarker}
              title="Clear the selected schedule start clip"
              type="button"
            >
              <MapPin size={12} /> Start clip set · Clear
            </button>
          ) : null}
        </div>
        <div className="schedule-bulk-control">
          <span>Bulk actions</span>
          <strong>{selectedIds.size} / {playlist.length} selected</strong>
          <div className="bulk-selection-actions">
            <button onClick={() => setSelectedIds(new Set(playlist.map((asset) => asset.id)))} type="button">
              Select all
            </button>
            <button disabled={selectedIds.size === 0} onClick={() => setSelectedIds(new Set())} type="button">
              Clear
            </button>
          </div>
          <div className="bulk-overlay-actions">
            <select aria-label="Bulk AGE rating" onChange={(event) => setBulkAgeRating(event.target.value)} value={bulkAgeRating}>
              <option value="off">AGE OFF</option>
              {AGE_RATINGS.map((rating) => <option key={rating} value={rating}>AGE {rating}</option>)}
            </select>
            <button
              disabled={selectedIds.size === 0}
              onClick={() => onBulkAgeChange([...selectedIds], bulkAgeRating === "off" ? null : bulkAgeRating)}
              type="button"
            >Apply AGE</button>
            <button
              disabled={selectedIds.size === 0 || (!scheduleLogoPath && !playlist.some((asset) => asset.itemLogo?.filePath))}
              onClick={() => onBulkLogoChange([...selectedIds], true)}
              type="button"
            >LOGO ON</button>
            <button disabled={selectedIds.size === 0} onClick={() => onBulkLogoChange([...selectedIds], false)} type="button">
              LOGO OFF
            </button>
          </div>
          <small>Ctrl+A / Cmd+A selects every item in the active schedule</small>
        </div>
      </section>
      <aside className="playlist-sidebar">
        <div className="schedule-tabs">
          <button
            className={activeSchedule === "current" ? "active" : ""}
            onClick={() => onScheduleChange("current")}
            type="button"
          >Current <span>{currentCount}</span></button>
          <button
            className={activeSchedule === "future" ? "active" : ""}
            onClick={() => onScheduleChange("future")}
            type="button"
          >Future <span>{futureCount}</span></button>
        </div>
        <div className={`schedule-coverage ${scheduleCoverage}`}>
          <span>
            <b>{scheduleMetadata?.startTime ?? "12:00:00.00"}</b>
            {" → "}<b>{scheduleMetadata?.startTime ?? "12:00:00.00"}</b> +7 days
          </span>
          <strong>{formatHours(playlistDuration)} / 168:00:00</strong>
          <em>
            {scheduleCoverage === "exact"
              ? "Schedule fits the 168-hour window"
              : `${scheduleCoverage === "over" ? "Overrun" : "Underrun"} ${formatHours(Math.abs(scheduleVariance))}`}
          </em>
          {scheduleMetadata ? (
            <small title={scheduleMetadata.sourceFilePath}>
              {scheduleMetadata.sourceName} · {scheduleMetadata.encoding} · delay {scheduleMetadata.delaySeconds}s
              {scheduleMetadata.warnings.length > 0
                ? ` · ${scheduleMetadata.warnings.length} warning(s)`
                : ""}
            </small>
          ) : <small>No .AIR/.TXT schedule loaded</small>}
        </div>
        <div className="playlist-table-header">
          <span>Prev</span>
          <span>Clip name</span>
          <span>Dur</span>
          <span>Codec</span>
        </div>
        <div className="playlist-rows">
          {playlist.map((asset) => (
            <div
              className={`playlist-row ${selectedAsset.id === asset.id ? "selected" : ""} ${selectedIds.has(asset.id) ? "bulk-selected" : ""} ${scheduleStartMarker?.assetId === asset.id ? "schedule-start-row" : ""} status-${asset.status} schedule-type-${asset.scheduleType ?? "manual"}`}
              draggable
              key={asset.id}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setDraggingId(asset.id)}
              onDrop={() => {
                if (draggingId) {
                  onMoveItem(draggingId, asset.id);
                }
                setDraggingId(null);
              }}
            >
              <button
                className="playlist-row-select"
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(asset.id)) next.delete(asset.id);
                      else next.add(asset.id);
                      return next;
                    });
                  } else {
                    setSelectedIds(new Set([asset.id]));
                  }
                  onSelectAsset(asset.id);
                }}
                type="button"
              >
                <span className="playlist-status-stripe" />
                <img alt="" src={asset.preview} />
                <span className="playlist-clip-info">
                  <strong>{asset.name}</strong>
                  <span>
                    {asset.duration} <i /> {formatPlaylistStatus(asset)}
                    {scheduleStartMarker?.assetId === asset.id ? " · START" : ""}
                    {(asset.scte35Markers?.length ?? 0) > 0
                      ? ` · SCTE ${asset.scte35Markers?.length}`
                      : ""}
                  </span>
                </span>
                <span className="playlist-codec">
                  <span>{asset.codecFamily}</span>
                  <span>{asset.codecProfile}</span>
                </span>
              </button>
              <div className="playlist-item-metadata">
                {scheduleStartMarker?.assetId === asset.id ? (
                  <span className="schedule-start-chip" title="This clip is the selected schedule start point">
                    <MapPin size={12} /> START
                  </span>
                ) : null}
                <select
                  aria-label={`Schedule type for ${asset.name}`}
                  onChange={(event) => onUpdateItem(asset.id, {
                    scheduleType: event.target.value as MediaAsset["scheduleType"],
                  })}
                  value={asset.scheduleType ?? "clip"}
                >
                  <option value="movie">MOVIE</option>
                  <option value="chop">CHOP</option>
                  <option value="clip">CLIP</option>
                </select>
                <label
                  className={`overlay-chip age age-rating-control ${asset.ageTitle?.enabled ? "enabled" : ""}`}
                  title={asset.ageTitle?.filePath ?? asset.ageTitle?.text ?? "No age title assigned"}
                >
                  <span>AGE</span>
                  <select
                    aria-label={`Age rating for ${asset.name}`}
                    onChange={(event) => {
                      const rating = event.target.value;
                      if (!rating) {
                        onUpdateItem(asset.id, {
                          ageTitle: asset.ageTitle
                            ? { ...asset.ageTitle, enabled: false }
                            : undefined,
                        });
                        return;
                      }
                      onUpdateItem(asset.id, {
                        ageTitle: {
                          durationSeconds: asset.ageTitle?.durationSeconds ?? 5,
                          enabled: true,
                          filePath: ageAssetPaths.get(rating) ?? null,
                          text: rating,
                        },
                      });
                    }}
                    value={asset.ageTitle?.enabled ? asset.ageTitle.text : ""}
                  >
                    <option value="">OFF</option>
                    {AGE_RATINGS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                  </select>
                  <i className={asset.ageTitle?.filePath ? "matched" : "fallback"} />
                </label>
                <label
                  className={`overlay-chip logo ${asset.itemLogo?.enabled ? "enabled" : ""}`}
                  title={asset.itemLogo?.filePath ?? "No item logo assigned"}
                >
                  <input
                    checked={asset.itemLogo?.enabled ?? false}
                    disabled={!asset.itemLogo}
                    onChange={(event) => asset.itemLogo && onUpdateItem(asset.id, {
                      itemLogo: { ...asset.itemLogo, enabled: event.target.checked },
                    })}
                    type="checkbox"
                  />
                  LOGO
                </label>
                <button
                  className={`playlist-start-button ${playoutActive ? "on-air" : ""}`}
                  disabled={activeSchedule !== "current" || takeBusy || asset.status !== "analyzed"}
                  onClick={() => void onStartFromItem(asset.id)}
                  title={asset.status !== "analyzed"
                    ? "Analyze the clip successfully before selecting it as a start point"
                    : playoutActive
                      ? `Restart the on-air playout from ${asset.name}`
                      : `Set ${asset.name} as the schedule start clip`}
                  type="button"
                >
                  {takeBusy ? <LoaderCircle className="spin" size={13} /> : playoutActive
                    ? <RadioTower size={13} />
                    : <MapPin size={13} />}
                  {playoutActive ? "Take on air" : "Start here"}
                </button>
              </div>
              <button
                aria-label={`Remove ${asset.name} from playlist`}
                className="playlist-remove-button"
                onClick={() => onRemoveItem(asset.id)}
                title="Remove clip from playlist"
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="playlist-footer">
          <span>{playlist.length} clips · {formatTimecode(playlistDuration, "25")} total</span>
          <button onClick={() => fileInput.current?.click()} type="button">
            + Add Clip
          </button>
          <input
            accept="video/*,.mxf,.mkv,.ts"
            className="visually-hidden"
            multiple
            onChange={(event) =>
              onAddFiles(Array.from(event.target.files ?? []))
            }
            ref={fileInput}
            type="file"
          />
        </div>
      </aside>

      <section className="preview-workspace">
        <div className="preview-stage">
        <div className="program-preview" ref={previewContainer}>
          {previewUrl ? (
            <video
              autoPlay
              onEnded={finishPreview}
              onTimeUpdate={(event) => updatePreviewTime(event.currentTarget.currentTime)}
              playsInline
              poster={previewSource}
              ref={videoRef}
            />
          ) : (
            <img alt={`Preview for ${selectedAsset.name}`} src={previewSource} />
          )}
          <div className="preview-hud preview-hud-top">
            <span className="decoding-status">
              {previewBusy ? <LoaderCircle className="spin" size={12} /> : <i />}
              {previewBusy
                ? "Preparing Preview"
                : playing
                  ? "Playing Preview"
                  : previewError
                    ? "Preview Error"
                    : "Ready to Preview"}
            </span>
            <span>
              {selectedAsset.resolution} @ {selectedAsset.fps} | {selectedAsset.codec}
            </span>
          </div>
          <strong className="preview-timecode">
            {formatTimecode(currentTime, selectedAsset.fps)}
          </strong>
          <button
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="preview-center-control"
            disabled={previewBusy}
            onClick={() => void togglePreview()}
            title={previewError ?? undefined}
            type="button"
          >
            {playing ? <Pause size={25} /> : <Play size={25} />}
          </button>
          {previewError ? (
            <span className="preview-error-message" role="alert">{previewError}</span>
          ) : null}
        </div>
        </div>

        <div className="transport-bar">
          <div className="seek-row">
            <span>{formatTimecode(0, selectedAsset.fps)}</span>
            <input
              aria-label="Preview position"
              max={Math.max(selectedAsset.durationSeconds, 1)}
              min={0}
              onChange={(event) => setCurrentTime(Number(event.target.value))}
              onKeyUp={() => {
                if (playing) void startPreview(currentTime);
              }}
              onPointerDown={() => {
                seeking.current = true;
                videoRef.current?.pause();
              }}
              onPointerUp={() => {
                seeking.current = false;
                if (playing) void startPreview(currentTime);
              }}
              type="range"
              value={currentTime}
            />
            <span>{selectedAsset.duration}</span>
          </div>
          <div className="transport-controls">
            <div className="transport-group">
              <IconButton
                disabled={selectedIndex <= 0}
                label="Previous clip"
                onClick={() => selectRelative(-1)}
              >
                <SkipBack size={18} />
              </IconButton>
              <IconButton
                label="Stop"
                onClick={() => void stopPreview()}
              >
                <Square size={14} fill="currentColor" />
              </IconButton>
              <IconButton
                active={playing}
                label={playing ? "Pause" : "Play"}
                onClick={() => void togglePreview()}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </IconButton>
              <IconButton
                disabled={selectedIndex >= playlist.length - 1}
                label="Next clip"
                onClick={() => selectRelative(1)}
              >
                <SkipForward size={18} />
              </IconButton>
              <span className="control-divider" />
              <IconButton
                active={repeat}
                label="Repeat"
                onClick={() => setRepeat((value) => !value)}
              >
                <Repeat2 size={18} />
              </IconButton>
            </div>
            <strong>{formatTimecode(currentTime, selectedAsset.fps)}</strong>
            <div className="transport-group volume-controls">
              <IconButton label="Mute" onClick={toggleMute}>
                {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </IconButton>
              <input
                aria-label="Preview volume"
                max={100}
                min={0}
                onChange={(event) => setVolume(Number(event.target.value))}
                type="range"
                value={volume}
              />
              <span className="control-divider" />
              <IconButton
                label="Fullscreen preview"
                onClick={() => void previewContainer.current?.requestFullscreen()}
              >
                <Maximize2 size={18} />
              </IconButton>
            </div>
          </div>
        </div>

        <div className="filmstrip-panel">
          <div className="filmstrip-labels">
            <strong>Timeline Trimming</strong>
            <span>
              IN: {formatTimecode(trimIn, selectedAsset.fps)} &nbsp;&nbsp; OUT:{" "}
              {formatTimecode(trimOut, selectedAsset.fps)}
            </span>
          </div>
          <div className="filmstrip-track">
            {Array.from({ length: 8 }, (_, index) => {
              const atSeconds = selectedAsset.durationSeconds * ((index + 0.5) / 8);
              const image = realMediaPreview
                ? mediaThumbnailUrl(selectedAsset.filePath, atSeconds)
                : selectedAsset.preview;
              return <img alt="" key={`${selectedAsset.id}-${index}`} src={image} />;
            })}
            {scte35Markers.map((marker) => (
              <span
                className={`scte35-timeline-marker ${marker.kind}`}
                key={marker.id}
                style={{
                  left: `${(marker.positionSeconds / Math.max(selectedAsset.durationSeconds, 1)) * 100}%`,
                }}
                title={`SCTE-35 ${marker.kind} · Event ID ${marker.eventId}`}
              />
            ))}
            <div
              className="trim-dim trim-dim-left"
              style={{
                width: `${(trimIn / Math.max(selectedAsset.durationSeconds, 1)) * 100}%`,
              }}
            />
            <div
              className="trim-dim trim-dim-right"
              style={{
                width: `${100 - (trimOut / Math.max(selectedAsset.durationSeconds, 1)) * 100}%`,
              }}
            />
            <div
              className="playhead"
              style={{
                left: `${(currentTime / Math.max(selectedAsset.durationSeconds, 1)) * 100}%`,
              }}
            />
            <input
              aria-label="Trim in"
              className="trim-range trim-range-in"
              max={Math.max(trimOut - 1, 0)}
              min={0}
              onChange={(event) => setTrimIn(Number(event.target.value))}
              type="range"
              value={trimIn}
            />
            <input
              aria-label="Trim out"
              className="trim-range trim-range-out"
              max={Math.max(selectedAsset.durationSeconds, 1)}
              min={Math.min(trimIn + 1, selectedAsset.durationSeconds)}
              onChange={(event) => setTrimOut(Number(event.target.value))}
              type="range"
              value={trimOut}
            />
          </div>
        </div>

        <section className="scte35-marker-panel">
          <div className="scte35-marker-heading">
            <div>
              <strong><FlagTriangleRight size={15} /> SCTE-35 Marker Planner</strong>
              <span>
                Cue at {formatTimecode(currentTime, selectedAsset.fps)} · {scte35Markers.length} markers
              </span>
            </div>
            <span className={`planner-state ${scte35Defaults.scte35PlanningEnabled ? "enabled" : ""}`}>
              {scte35Defaults.scte35PlanningEnabled ? "Planner enabled" : "Enable in Broadcast"}
            </span>
          </div>
          <div className="scte35-marker-form">
            <label>
              <span>Event ID</span>
              <input
                disabled={!scte35Defaults.scte35PlanningEnabled}
                max={0xffff_ffff}
                min={0}
                onChange={(event) => setMarkerEventId(Number(event.target.value))}
                type="number"
                value={markerEventId}
              />
            </label>
            <label>
              <span>Marker</span>
              <select
                disabled={!scte35Defaults.scte35PlanningEnabled}
                onChange={(event) => setMarkerKind(event.target.value as Scte35MarkerKind)}
                value={markerKind}
              >
                <option value="break-start">Break Start</option>
                <option value="break-end">Break End</option>
              </select>
            </label>
            <label>
              <span>Duration (sec)</span>
              <input
                disabled={!scte35Defaults.scte35PlanningEnabled || markerKind === "break-end"}
                min={1}
                onChange={(event) => setMarkerDuration(Number(event.target.value))}
                type="number"
                value={markerDuration}
              />
            </label>
            <label>
              <span>{scte35Defaults.scte35UpidType} UPID</span>
              <input
                disabled={!scte35Defaults.scte35PlanningEnabled}
                onChange={(event) => setMarkerUpid(event.target.value)}
                placeholder="Optional placement identifier"
                type="text"
                value={markerUpid}
              />
            </label>
            <button
              className="secondary-button"
              disabled={!scte35Defaults.scte35PlanningEnabled}
              onClick={addScte35Marker}
              type="button"
            >
              <FlagTriangleRight size={14} /> Add at Playhead
            </button>
          </div>
          {scte35Markers.length > 0 ? (
            <div className="scte35-marker-list">
              {scte35Markers
                .slice()
                .sort((left, right) => left.positionSeconds - right.positionSeconds)
                .map((marker) => (
                  <span key={marker.id}>
                    <b>{marker.kind === "break-start" ? "OUT" : "IN"}</b>
                    <strong>{formatTimecode(marker.positionSeconds, selectedAsset.fps)}</strong>
                    <em>ID {marker.eventId}</em>
                    <em>type 0x{marker.segmentationTypeId.toString(16)}</em>
                    {marker.upid ? <em>{marker.upid}</em> : null}
                    <button
                      aria-label={`Remove SCTE-35 marker ${marker.eventId}`}
                      onClick={() => onRemoveScte35Marker(selectedAsset.id, marker.id)}
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                ))}
            </div>
          ) : null}
          <p>
            Markers are converted to 90 kHz program PTS and injected into UDP/SRT MPEG-TS by TSDuck.
            Keep the first marker later than the configured pre-roll plus the 2 second startup reserve.
          </p>
        </section>

        <div className="properties-panel">
          <div className="properties-heading">
            <strong>File Properties</strong>
            <span className="asset-status analyzed">Analyzed</span>
          </div>
          <div className="properties-grid">
            <Property label="File Path" value={selectedAsset.filePath} wide />
            <Property label="Codec" value={selectedAsset.codec} />
            <Property label="Resolution" value={selectedAsset.resolution} />
            <Property label="Frame Rate" value={selectedAsset.fps} />
            <Property label="Duration" value={selectedAsset.duration} />
            <Property label="Bitrate" value={selectedAsset.bitrate} />
            <Property label="File Size" value={selectedAsset.size} />
            <Property label="Color Space" value={selectedAsset.colorSpace} />
            <Property label="Audio" value={selectedAsset.audio} />
            <Property label="SHA-256" value={selectedAsset.sha256} />
          </div>
        </div>
      </section>
    </main>
  );
}

function IconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`icon-button ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Property({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <span className={`property ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function formatPlaylistStatus(asset: MediaAsset): string {
  if (typeof asset.progress === "number") {
    return `${asset.progress}%`;
  }
  return asset.status === "error"
    ? "Error"
    : asset.status.charAt(0).toUpperCase() + asset.status.slice(1);
}

function formatTimecode(seconds: number, fpsLabel: string): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const secs = safeSeconds % 60;
  const frameRate = Math.max(1, Math.round(Number.parseFloat(fpsLabel) || 25));
  const frames = Math.floor((seconds % 1) * frameRate);
  return [hours, minutes, secs, frames]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatHours(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remaining = safeSeconds % 60;
  return [hours, minutes, remaining]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function ageAssetMap(imagePaths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const imagePath of imagePaths) {
    const fileName = imagePath.split(/[\\/]/).at(-1) ?? imagePath;
    const match = fileName.match(/(?:^|[^0-9])(0|6|12|16|18)\+(?:[^0-9]|$)/i);
    if (match?.[1] && !result.has(`${match[1]}+`)) {
      result.set(`${match[1]}+`, imagePath);
    }
  }
  return result;
}

function shortPath(value: string): string {
  if (!value) return "";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `…/${parts.slice(-2).join("/")}`;
}
