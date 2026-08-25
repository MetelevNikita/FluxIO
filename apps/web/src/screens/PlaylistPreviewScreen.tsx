import {
  AlertTriangle,
  Captions,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  FlagTriangleRight,
  FilePlus2,
  FolderOpen,
  Image,
  Maximize2,
  LoaderCircle,
  Layers3,
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
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { airDurationSeconds } from "../clip-duration";
import { attachHlsVideo } from "../hls-video";
import { mediaPath } from "../runtime";
import { mediaThumbnailUrl, stopClipPreview } from "../media-api";
import { mediaApiUrl } from "../runtime";
import { buildScheduleTimeline } from "../schedule-timeline";
import { assetAudioLanes, assetLanguageLabels, type AudioTrackLane } from "../audio-program";
import { matchingNamedAssetPath } from "../graphic-title-matching";
import { lottieTextValues } from "../effect-assignment";
import { moveEffectLayerWindow, removeEffectLayerById } from "../effect-timeline-math";
import type {
  BroadcastSettings,
  MediaAsset,
  ScheduleMetadata,
  ScheduleOverlayLibrary,
  SubtitleLibrary,
  ScheduleSlot,
  Scte35Marker,
  Scte35MarkerKind,
} from "../types";
import type {
  BroadcastTextOverlay,
  ClipPreviewSession,
  ScheduleExportExtension,
  ScheduleStartMarker,
  WorkspaceSessionCheckpoint,
  GraphicEffectAsset,
  GraphicEffectLayer,
} from "@gruber/contracts";

interface PlaylistPreviewScreenProps {
  playlist: MediaAsset[];
  selectedAsset: MediaAsset;
  activeSchedule: ScheduleSlot;
  currentCount: number;
  futureCount: number;
  scheduleMetadata: ScheduleMetadata | null;
  ageDurationSeconds: number;
  ageLibrary: ScheduleOverlayLibrary | null;
  scheduleLogoSource: string;
  scheduleLogoPath: string;
  logoSettings: Pick<
    BroadcastSettings,
    "logoPosition" | "logoWidthPercent" | "logoMargin" | "logoOpacity" | "logoLoop"
  >;
  audioTracksEnabled: boolean;
  audioTrackDirectory: string;
  audioOriginalLanguage: string;
  audioProgramLanguages: string[];
  onSelectAudioTrackDirectory?: () => Promise<void>;
  onAudioTrackSettingsChange: (patch: {
    audioTracksEnabled?: boolean;
    audioOriginalLanguage?: string;
  }) => void;
  scheduleActionMessage: string | null;
  scheduleBusy: boolean;
  workspaceBusy: boolean;
  takeBusy: boolean;
  savedSessionUpdatedAt: string | null;
  recoveryCheckpoint: WorkspaceSessionCheckpoint | null;
  scheduleStartMarker: ScheduleStartMarker | null;
  playoutActive: boolean;
  /**
   * Что сейчас в эфире — россыпью простых значений, а не снимком статуса.
   * Статус опрашивается раз в секунду и приходит новым объектом, поэтому
   * `memo` на нём не работал бы вовсе: экран перерисовывался бы секунда за
   * секундой вместе со всем списком роликов.
   */
  onAirItemId: string | null;
  onAirElapsedSeconds: number;
  onAirProgressPercent: number;
  recoveryAssetId: string | null;
  initialPreviewTimeSeconds: number | null;
  onAddFiles: (files: File[]) => void;
  onAddNativeFiles?: () => Promise<void>;
  onAddScte35Marker: (assetId: string, marker: Scte35Marker) => void;
  onMoveItems: (sourceIds: string[], targetId: string) => void;
  onBulkAgeChange: (assetIds: string[], rating: string | null) => void;
  onBulkLogoChange: (assetIds: string[], enabled: boolean) => void;
  onAgeDurationChange: (durationSeconds: number) => void;
  onLogoSettingsChange: (patch: Partial<Pick<
    BroadcastSettings,
    "logoPosition" | "logoWidthPercent" | "logoMargin" | "logoOpacity" | "logoLoop"
  >>) => void;
  onRemoveItem: (assetId: string) => void;
  onRemoveScte35Marker: (assetId: string, markerId: string) => void;
  onSelectAsset: (assetId: string) => void;
  onScheduleChange: (slot: ScheduleSlot) => void;
  onSaveSchedule: (extension: ScheduleExportExtension) => Promise<void>;
  onSaveSessionList: () => Promise<void>;
  onNewPlaylist: () => Promise<void>;
  onClearStartMarker: () => void;
  onStartFromItem: (assetId: string) => Promise<void>;
  onStartCompositePreview: (asset: MediaAsset, startSeconds: number) => Promise<ClipPreviewSession>;
  onSelectAgeDirectory?: () => Promise<void>;
  onSelectScheduleLogoDirectory?: () => Promise<void>;
  onSelectScheduleLogoFile?: () => Promise<void>;
  onUpdateItem: (assetId: string, patch: Partial<MediaAsset>) => void;
  onUpdateItems: (
    assetIds: string[],
    updater: (asset: MediaAsset) => Partial<MediaAsset>,
  ) => void;
  effectLibrary: GraphicEffectAsset[];
  subtitleLibrary: SubtitleLibrary | null;
  onSelectSubtitleDirectory?: () => Promise<void>;
  scte35Defaults: BroadcastSettings;
}

const AGE_RATINGS = ["0+", "6+", "12+", "16+", "18+"] as const;

/**
 * Экран обёрнут в `memo`: статус эфира опрашивается раз в секунду, и без этого
 * весь список роликов перерисовывался бы секунда за секундой — у оператора
 * «залипают» кнопки и поля ввода. Любой новый проп обязан быть стабильным,
 * иначе memo молча перестаёт работать.
 */
export const PlaylistPreviewScreen = memo(function PlaylistPreviewScreen({
  playlist,
  selectedAsset,
  activeSchedule,
  currentCount,
  futureCount,
  scheduleMetadata,
  ageDurationSeconds,
  ageLibrary,
  scheduleLogoSource,
  scheduleLogoPath,
  logoSettings,
  audioTracksEnabled,
  audioTrackDirectory,
  audioOriginalLanguage,
  audioProgramLanguages,
  onSelectAudioTrackDirectory,
  onAudioTrackSettingsChange,
  scheduleActionMessage,
  scheduleBusy,
  workspaceBusy,
  takeBusy,
  savedSessionUpdatedAt,
  recoveryCheckpoint,
  scheduleStartMarker,
  playoutActive,
  onAirItemId,
  onAirElapsedSeconds,
  onAirProgressPercent,
  recoveryAssetId,
  initialPreviewTimeSeconds,
  onAddFiles,
  onAddNativeFiles,
  onAddScte35Marker,
  onMoveItems,
  onBulkAgeChange,
  onBulkLogoChange,
  onAgeDurationChange,
  onLogoSettingsChange,
  onRemoveItem,
  onRemoveScte35Marker,
  onSelectAsset,
  onScheduleChange,
  onSaveSchedule,
  onSaveSessionList,
  onNewPlaylist,
  onClearStartMarker,
  onStartFromItem,
  onStartCompositePreview,
  onSelectAgeDirectory,
  onSelectScheduleLogoDirectory,
  onSelectScheduleLogoFile,
  onUpdateItem,
  onUpdateItems,
  effectLibrary,
  subtitleLibrary,
  onSelectSubtitleDirectory,
  scte35Defaults,
}: PlaylistPreviewScreenProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const previewContainer = useRef<HTMLDivElement>(null);
  const previewRequest = useRef(0);
  const previewSession = useRef<string | null>(null);
  const playlistRows = useRef<HTMLDivElement>(null);
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
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [markerEventId, setMarkerEventId] = useState(scte35Defaults.scte35DefaultEventId);
  const [markerKind, setMarkerKind] = useState<Scte35MarkerKind>("break-start");
  const [markerDuration, setMarkerDuration] = useState(
    scte35Defaults.scte35DefaultBreakDuration,
  );
  const [markerUpid, setMarkerUpid] = useState(scte35Defaults.scte35DefaultUpid);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set([selectedAsset.id]));
  const selectionAnchorId = useRef<string | null>(selectedAsset.id);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
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

  // Кадр под курсором перемотки. Пока плеер стоит, на экране висел постер, и
  // перемотка выглядела мёртвой: картинка не двигалась. Позиция берётся с
  // задержкой — при протяжке ползунка иначе полетела бы сотня запросов подряд.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (playing || !realMediaPreview) {
      setScrubSeconds(null);
      return;
    }
    const timer = window.setTimeout(() => setScrubSeconds(currentTime), 120);
    return () => window.clearTimeout(timer);
  }, [currentTime, playing, realMediaPreview]);

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
  const timelineEntries = useMemo(
    () => buildScheduleTimeline(playlist, scheduleMetadata, activeSchedule),
    [activeSchedule, playlist, scheduleMetadata],
  );
  const onAirAssetId = activeSchedule === "current" && playoutActive ? onAirItemId : null;
  const stoppedHereAssetId = activeSchedule === "current" ? recoveryAssetId : null;
  const collapsedCount = playlist.reduce(
    (count, asset) => count + (collapsedIds.has(asset.id) ? 1 : 0),
    0,
  );
  const allCollapsed = playlist.length > 0 && collapsedCount === playlist.length;

  useEffect(() => {
    const targetId = onAirAssetId ?? stoppedHereAssetId;
    if (!targetId || !playlistRows.current) return;
    const target = [...playlistRows.current.querySelectorAll<HTMLElement>("[data-asset-id]")]
      .find((element) => element.dataset.assetId === targetId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [onAirAssetId, stoppedHereAssetId]);

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
      const session = await onStartCompositePreview(selectedAsset, position);
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

  /**
   * Перемотка.
   *
   * Предпросмотр копится целиком, поэтому назад и на уже посчитанный участок
   * плеер прыгает сам — перезапускать FFmpeg ради этого незачем. Перезапуск
   * остаётся только там, где нужного куска ещё не существует: рендер идёт в
   * реальном времени и вперёд забежать не может.
   */
  function seekPreview(target: number): void {
    if (!playing) return;
    const video = videoRef.current;
    const relative = target - previewOffset;
    if (video && previewUrl && relative >= 0 && isBuffered(video, relative)) {
      video.currentTime = relative;
      void video.play().catch(() => undefined);
      return;
    }
    void startPreview(target);
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

  function togglePlaylistItemCollapsed(assetId: string): void {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function setAllPlaylistItemsCollapsed(collapsed: boolean): void {
    setCollapsedIds((current) => {
      const next = new Set(current);
      for (const asset of playlist) {
        if (collapsed) next.add(asset.id);
        else next.delete(asset.id);
      }
      return next;
    });
  }

  function selectPlaylistAsset(
    asset: MediaAsset,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ): void {
    if (event.shiftKey) {
      const anchorIndex = playlist.findIndex((item) => item.id === selectionAnchorId.current);
      const targetIndex = playlist.findIndex((item) => item.id === asset.id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        setSelectedIds(new Set(playlist.slice(start, end + 1).map((item) => item.id)));
      }
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.add(asset.id);
        return next;
      });
      selectionAnchorId.current = asset.id;
    } else {
      setSelectedIds(new Set([asset.id]));
      selectionAnchorId.current = asset.id;
    }
    onSelectAsset(asset.id);
  }

  function controlTargetIds(assetId: string): string[] {
    return selectedIds.has(assetId) && selectedIds.size > 1
      ? [...selectedIds]
      : [assetId];
  }

  function addEffectToItems(assetId: string, effectId: string): void {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    if (!effect) return;
    const targetIds = controlTargetIds(assetId);
    onUpdateItems(targetIds, (asset) => {
      const clipDuration = effectiveClipDuration(asset);
      const endSeconds = Math.max(
        0.04,
        Math.min(clipDuration, effect.kind === "static" || effect.durationSeconds <= 0
          ? clipDuration
          : effect.durationSeconds),
      );
      const layer: GraphicEffectLayer = {
        backgroundPath: effect.filePath,
        blendMode: "alpha",
        lumaThreshold: 0.08,
        sequenceFrameRate: null,
        sequenceStartNumber: null,
        // Сдвиг задаётся эффектом второго уровня; уровень 3 ложится как есть.
        offsetXPercent: 0,
        offsetYPercent: 0,
        sourceInSeconds: 0,
        tier: 3,
        id: `layer-${asset.id}-${effect.id}-${window.crypto.randomUUID()}`,
        effectId: effect.id,
        name: effect.name,
        filePath: effect.filePath,
        kind: effect.kind,
        sourceDurationSeconds: effect.durationSeconds,
        startSeconds: 0,
        endSeconds,
        titlePath: findMatchingEffectTitle(asset.name, effect),
        titlePaths: lottieTextValues(effect),
      };
      return { effects: [...(asset.effects ?? []), layer] };
    });
  }

  function toggleSubtitlesForItems(assetId: string): void {
    const targetIds = controlTargetIds(assetId);
    onUpdateItems(targetIds, (asset) => {
      const currentEnabled = asset.subtitles?.enabled ?? false;
      if (currentEnabled) return { subtitles: { enabled: false, filePath: null } };
      const filePath = findMatchingSubtitle(asset.name, subtitleLibrary?.filePaths ?? []);
      return { subtitles: { enabled: Boolean(filePath), filePath } };
    });
  }

  function updateEffectLayer(layerId: string, patch: Partial<GraphicEffectLayer>): void {
    onUpdateItem(selectedAsset.id, {
      effects: (selectedAsset.effects ?? []).map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer
      ),
    });
  }

  function removeEffectLayer(layerId: string): void {
    onUpdateItem(selectedAsset.id, {
      effects: removeEffectLayerById(selectedAsset.effects ?? [], layerId),
    });
  }

  function removeEffectLayerFromItem(assetId: string, layerId: string): void {
    onUpdateItems([assetId], (asset) => ({
      effects: removeEffectLayerById(asset.effects ?? [], layerId),
    }));
  }

  // Динамическая надпись — такой же слой ролика, как FX: её тоже нужно двигать
  // и снимать прямо из плейлиста. Изменения уходят в эфир на лету через
  // PUT /api/playout/playlist, как и остальная графика будущих роликов.
  function updateTextOverlay(overlayId: string, patch: Partial<BroadcastTextOverlay>): void {
    onUpdateItem(selectedAsset.id, {
      textOverlays: (selectedAsset.textOverlays ?? []).map((overlay) =>
        overlay.id === overlayId ? { ...overlay, ...patch } : overlay
      ),
    });
  }

  function removeTextOverlay(overlayId: string): void {
    onUpdateItem(selectedAsset.id, {
      textOverlays: removeEffectLayerById(selectedAsset.textOverlays ?? [], overlayId),
    });
  }

  /**
   * Эффект второго уровня лежит на ролике двумя сущностями — плашкой-файлом и
   * живой надписью, — поэтому снимается целиком по своему id. Снять что-то одно
   * значило бы оставить на ролике половину эффекта.
   */
  function removeBroadcastFromItem(assetId: string, effectId: string): void {
    onUpdateItems([assetId], (asset) => ({
      effects: (asset.effects ?? []).filter((layer) => layer.effectId !== effectId),
      textOverlays: (asset.textOverlays ?? []).filter((overlay) => overlay.effectId !== effectId),
    }));
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
        <div className="schedule-resource-control logo-source-control">
          <span>Channel logo</span>
          <strong title={scheduleLogoSource || undefined}>
            {shortPath(scheduleLogoSource) || "Not selected"}
          </strong>
          <div className="schedule-source-actions">
            <button disabled={!onSelectScheduleLogoFile || scheduleBusy} onClick={() => void onSelectScheduleLogoFile?.()} type="button">
              <Image size={13} /> File
            </button>
            <button disabled={!onSelectScheduleLogoDirectory || scheduleBusy} onClick={() => void onSelectScheduleLogoDirectory?.()} type="button">
              <FolderOpen size={13} /> Folder
            </button>
            {/* Анимированный логотип (mov, webm, gif, Lottie) либо крутится до
                конца ролика, либо играет один раз и остаётся последним кадром.
                У картинки кнопка ничего не меняет, поэтому и не показывается. */}
            {animatedLogo(scheduleLogoPath) ? (
              <button
                aria-pressed={logoSettings.logoLoop}
                className={`logo-loop-toggle${logoSettings.logoLoop ? " on" : ""}`}
                disabled={scheduleBusy}
                onClick={() => onLogoSettingsChange({ logoLoop: !logoSettings.logoLoop })}
                title={logoSettings.logoLoop
                  ? "Анимация повторяется до конца ролика"
                  : "Анимация играет один раз и замирает на последнем кадре"}
                type="button"
              >
                <Repeat2 size={13} /> Loop
              </button>
            ) : null}
          </div>
          <div className="logo-appearance-controls">
            <label>
              <span>Position</span>
              <select
                aria-label="Channel logo position"
                onChange={(event) => onLogoSettingsChange({ logoPosition: event.target.value })}
                value={logoSettings.logoPosition}
              >
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
                <option value="center">Center</option>
              </select>
            </label>
            <label>
              <span>Width <b>{logoSettings.logoWidthPercent}%</b></span>
              <input
                aria-label="Channel logo width percent"
                max={50}
                min={1}
                onChange={(event) => onLogoSettingsChange({
                  logoWidthPercent: Number(event.target.value),
                })}
                type="range"
                value={logoSettings.logoWidthPercent}
              />
            </label>
            <label>
              <span>Margin</span>
              <input
                aria-label="Channel logo margin pixels"
                defaultValue={logoSettings.logoMargin}
                key={`logo-margin-${logoSettings.logoMargin}`}
                max={500}
                min={0}
                onBlur={(event) => onLogoSettingsChange({ logoMargin: Number(event.target.value) })}
                type="number"
              />
            </label>
            <label>
              <span>Opacity <b>{Math.round(logoSettings.logoOpacity * 100)}%</b></span>
              <input
                aria-label="Channel logo opacity percent"
                max={100}
                min={5}
                onChange={(event) => onLogoSettingsChange({
                  logoOpacity: Number(event.target.value) / 100,
                })}
                type="range"
                value={Math.round(logoSettings.logoOpacity * 100)}
              />
            </label>
          </div>
        </div>
        <div className="schedule-resource-control age-source-control">
          <span>AGE full-frame folder</span>
          <strong title={ageLibrary?.directoryPath}>
            {ageLibrary
              ? `${shortPath(ageLibrary.directoryPath)} · ${ageAssetPaths.size} matched`
              : "Not selected"}
          </strong>
          <button disabled={!onSelectAgeDirectory || scheduleBusy} onClick={() => void onSelectAgeDirectory?.()} type="button">
            <FolderOpen size={13} /> Select folder
          </button>
          <small>1920×1080 or 3840×2160 PNG/WebP with alpha</small>
          <label className="age-duration-control">
            <span>Duration, sec</span>
            <input
              aria-label="AGE overlay duration seconds"
              defaultValue={ageDurationSeconds}
              key={`age-duration-${ageDurationSeconds}`}
              max={60}
              min={10}
              onBlur={(event) => onAgeDurationChange(Number(event.target.value))}
              type="number"
            />
          </label>
        </div>
        <div className="schedule-resource-control subtitle-source-control">
          <span>SRT subtitles folder</span>
          <strong title={subtitleLibrary?.directoryPath}>
            {subtitleLibrary
              ? `${shortPath(subtitleLibrary.directoryPath)} · ${subtitleLibrary.filePaths.length} files`
              : "Not selected"}
          </strong>
          <button disabled={!onSelectSubtitleDirectory || scheduleBusy} onClick={() => void onSelectSubtitleDirectory?.()} type="button">
            <Captions size={13} /> Select folder
          </button>
          <small>Exact video/SRT basename match; missing files stay OFF</small>
        </div>
        <div className="schedule-resource-control audio-track-control">
          <span>Audio tracks</span>
          <strong title={audioTrackDirectory || undefined}>
            {shortPath(audioTrackDirectory) || "Same folder as media"}
          </strong>
          <div className="schedule-source-actions">
            <button
              disabled={!onSelectAudioTrackDirectory || scheduleBusy}
              onClick={() => void onSelectAudioTrackDirectory?.()}
              type="button"
            >
              <FolderOpen size={13} /> Folder
            </button>
          </div>
          <div className="audio-track-appearance">
            <label className="audio-track-toggle">
              <input
                checked={audioTracksEnabled}
                onChange={(event) =>
                  onAudioTrackSettingsChange({ audioTracksEnabled: event.target.checked })}
                type="checkbox"
              />
              <span>Separate PID per language</span>
            </label>
            <label>
              <span>Original language</span>
              <input
                aria-label="Original audio language"
                maxLength={3}
                onChange={(event) =>
                  onAudioTrackSettingsChange({
                    audioOriginalLanguage: event.target.value.toLowerCase(),
                  })}
                value={audioOriginalLanguage}
              />
            </label>
            <span className="audio-program-languages">
              {audioProgramLanguages.length > 0
                ? audioProgramLanguages.join(" · ")
                : "No additional tracks found"}
            </span>
          </div>
        </div>
        <div className="schedule-save-control">
          <span>Export edited schedule</span>
          <div>
            <button disabled={scheduleBusy || playlist.length === 0} onClick={() => void onSaveSchedule("txt")} type="button">
              <Save size={14} /> Save .TXT
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
        <div className="playlist-view-actions">
          <span>
            Item view
            <b>{collapsedCount} collapsed</b>
          </span>
          <div>
            <button
              disabled={playlist.length === 0 || collapsedCount === 0}
              onClick={() => setAllPlaylistItemsCollapsed(false)}
              type="button"
            >
              <ChevronsDown size={13} /> Expand all
            </button>
            <button
              disabled={playlist.length === 0 || allCollapsed}
              onClick={() => setAllPlaylistItemsCollapsed(true)}
              type="button"
            >
              <ChevronsUp size={13} /> Collapse all
            </button>
          </div>
        </div>
        <div className="playlist-table-header">
          <span>Time</span>
          <span>Prev</span>
          <span>Clip name</span>
          <span>Codec</span>
        </div>
        <div className="playlist-rows" ref={playlistRows}>
          {timelineEntries.map((entry) => {
            const { asset } = entry;
            const onAir = onAirAssetId === asset.id;
            const stoppedHere = stoppedHereAssetId === asset.id;
            const collapsed = collapsedIds.has(asset.id);
            const onAirRemainingSeconds = onAir
              ? Math.max(
                  0,
                  effectiveClipDuration(asset) - onAirElapsedSeconds,
                )
              : null;
            return (
            <div className="playlist-timeline-entry" key={asset.id}>
              {entry.startsNewDay ? (
                <div className="schedule-day-divider">
                  <strong>{entry.dayLabel}</strong>
                  <span>{entry.dateLabel}</span>
                </div>
              ) : null}
            <div
              className={`playlist-row ${collapsed ? "collapsed" : "expanded"} ${fxDensityClass(asset)} ${selectedAsset.id === asset.id ? "selected" : ""} ${selectedIds.has(asset.id) ? "bulk-selected" : ""} ${scheduleStartMarker?.assetId === asset.id ? "schedule-start-row" : ""} ${onAir ? "on-air-row" : ""} ${stoppedHere ? "recovery-stop-row" : ""} status-${asset.status} schedule-type-${asset.scheduleType ?? "manual"}`}
              data-asset-id={asset.id}
              draggable
              onDragEnd={() => setDraggingIds([])}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => {
                const ids = selectedIds.has(asset.id) && selectedIds.size > 1
                  ? playlist.filter((item) => selectedIds.has(item.id)).map((item) => item.id)
                  : [asset.id];
                if (!selectedIds.has(asset.id)) {
                  setSelectedIds(new Set([asset.id]));
                  selectionAnchorId.current = asset.id;
                }
                setDraggingIds(ids);
              }}
              onDrop={() => {
                if (draggingIds.length > 0) {
                  onMoveItems(draggingIds, asset.id);
                }
                setDraggingIds([]);
              }}
            >
              <span className="playlist-status-stripe" />
              <button
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${asset.name}`}
                className="playlist-row-toggle"
                onClick={() => togglePlaylistItemCollapsed(asset.id)}
                title={collapsed ? "Expand item controls" : "Collapse item controls"}
                type="button"
              >
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <div
                className="playlist-row-select"
                onClick={(event) => selectPlaylistAsset(asset, event)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  selectPlaylistAsset(asset, event);
                }}
                role="button"
                tabIndex={0}
              >
                {assetLanguageLabels(asset).length > 0 ? (
                  <span className="playlist-language-badges">
                    {assetLanguageLabels(asset).map((language) => (
                      <b
                        key={language}
                        title={`Дополнительная звуковая дорожка: ${language}`}
                      >
                        {language}
                      </b>
                    ))}
                  </span>
                ) : null}
                <span className="playlist-air-time">{entry.startTime}</span>
                {!collapsed ? <img alt="" src={asset.preview} /> : null}
                <span className="playlist-clip-info">
                  <strong title={asset.name}>{asset.name}</strong>
                  {!collapsed ? (
                    <span className="playlist-clip-meta">
                      <span>{asset.duration}</span>
                      <select
                        aria-label={`Schedule type for ${asset.name}`}
                        className="playlist-schedule-type"
                        draggable={false}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const scheduleType = event.target.value as MediaAsset["scheduleType"];
                          onUpdateItems(controlTargetIds(asset.id), () => ({ scheduleType }));
                        }}
                        value={asset.scheduleType ?? "clip"}
                      >
                        <option value="movie">MOVIE</option>
                        <option value="chop">CHOP</option>
                        <option value="clip">CLIP</option>
                      </select>
                      {onAir ? (
                        <b className="playlist-clip-remaining">
                          −{formatHours(onAirRemainingSeconds ?? 0)}
                        </b>
                      ) : null}
                      <i /> <span className="playlist-clip-state">{formatPlaylistStatus(asset)}</span>
                      {scheduleStartMarker?.assetId === asset.id ? " · START" : ""}
                      {(asset.scte35Markers?.length ?? 0) > 0
                        ? ` · SCTE ${asset.scte35Markers?.length}`
                        : ""}
                    </span>
                  ) : null}
                </span>
                {!collapsed ? (
                  <span className="playlist-codec">
                    <span>{asset.codecFamily}</span>
                    <span>{asset.codecProfile}</span>
                  </span>
                ) : null}
              </div>
              {collapsed ? (
                <div className="playlist-collapsed-summary">
                  {onAir ? (
                    <span className="collapsed-state on-air">
                      <RadioTower size={11} /> ON AIR · {formatHours(onAirRemainingSeconds ?? 0)} left
                    </span>
                  ) : null}
                  {stoppedHere ? <span className="collapsed-state stopped"><AlertTriangle size={11} /> STOPPED</span> : null}
                  <span className={`collapsed-overlay age ${asset.ageTitle?.enabled ? "enabled" : ""}`}>
                    AGE {asset.ageTitle?.enabled ? asset.ageTitle.text : "OFF"}
                  </span>
                  <span className={`collapsed-overlay logo ${asset.itemLogo?.enabled ? "enabled" : ""}`}>
                    LOGO {asset.itemLogo?.enabled ? "ON" : "OFF"}
                  </span>
                </div>
              ) : (
              <div className="playlist-item-controls">
                <div className="playlist-item-metadata">
                {onAir ? (
                  <span className="playlist-on-air-chip" title="This clip is currently being sent to air">
                    <RadioTower size={12} /> ON AIR · {onAirProgressPercent}%
                  </span>
                ) : null}
                {stoppedHere ? (
                  <span className="recovery-stop-chip" title="Broadcasting stopped on this clip before session recovery">
                    <AlertTriangle size={12} /> STOPPED HERE
                  </span>
                ) : null}
                {scheduleStartMarker?.assetId === asset.id ? (
                  <span className="schedule-start-chip" title="This clip is the selected schedule start point">
                    <MapPin size={12} /> START
                  </span>
                ) : null}
                <label
                  className={`overlay-chip age age-rating-control ${asset.ageTitle?.enabled ? "enabled" : ""}`}
                  title={asset.ageTitle?.filePath ?? asset.ageTitle?.text ?? "No age title assigned"}
                >
                  <span>AGE</span>
                  <select
                    aria-label={`Age rating for ${asset.name}`}
                    onChange={(event) => {
                      const rating = event.target.value;
                      onUpdateItems(controlTargetIds(asset.id), (target) => ({
                        ageTitle: !rating
                          ? target.ageTitle
                            ? { ...target.ageTitle, enabled: false }
                            : undefined
                          : {
                              durationSeconds: target.ageTitle?.durationSeconds ?? ageDurationSeconds,
                              enabled: true,
                              filePath: ageAssetPaths.get(rating) ?? null,
                              text: rating,
                            },
                      }));
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
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      onUpdateItems(controlTargetIds(asset.id), (target) => ({
                        itemLogo: target.itemLogo ? { ...target.itemLogo, enabled } : undefined,
                      }));
                    }}
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
                  <span>{playoutActive ? "Take on air" : "Start here"}</span>
                </button>
                </div>
                <div className="playlist-secondary-actions">
                <button
                  className={`subtitle-toggle ${asset.subtitles?.enabled ? "enabled" : ""}`}
                  disabled={!findMatchingSubtitle(asset.name, subtitleLibrary?.filePaths ?? []) && !asset.subtitles?.enabled}
                  onClick={() => toggleSubtitlesForItems(asset.id)}
                  title={findMatchingSubtitle(asset.name, subtitleLibrary?.filePaths ?? [])
                    ?? "Matching .srt file was not found"}
                  type="button"
                >
                  <Captions size={11} /> SRT
                </button>
                <label className="fx-selector" title="Add a project effect as the next graphics layer">
                  <Layers3 size={11} />
                  <select
                    aria-label={`Add FX to ${asset.name}`}
                    disabled={effectLibrary.every((effect) => Boolean(effect.broadcast))}
                    onChange={(event) => {
                      if (event.target.value) addEffectToItems(asset.id, event.target.value);
                      event.target.value = "";
                    }}
                    value=""
                  >
                    <option value="">FX</option>
                    {/* Эффект второго уровня сам решает, куда и когда лечь,
                        поэтому вручную одним слоем его не положить. */}
                    {effectLibrary.filter((effect) => !effect.broadcast).map((effect) => (
                      <option key={effect.id} value={effect.id}>{effect.name}</option>
                    ))}
                  </select>
                </label>
                {broadcastChips(asset).length > 0 ? (
                  <span className="fx-layer-chips" title="Эфирные эффекты второго уровня">
                    {broadcastChips(asset).map((chip) => (
                      <span className="fx-layer-chip tier2" key={chip.effectId} title={chip.title}>
                        <i>{shortEffectName(chip.name)} · {chip.badge}</i>
                        <button
                          aria-label={`Remove ${chip.name} from ${asset.name}`}
                          onClick={() => removeBroadcastFromItem(asset.id, chip.effectId)}
                          title={`Снять «${chip.name}» с этого ролика целиком`}
                          type="button"
                        >
                          <Trash2 size={9} />
                        </button>
                      </span>
                    ))}
                  </span>
                ) : null}
                {(asset.effects ?? []).some((layer) => layer.tier !== 2) ? (
                  <span className="fx-layer-chips" title="FX order from lower to upper layer">
                    {asset.effects?.filter((layer) => layer.tier !== 2).map((layer, index) => (
                      (() => {
                        const definition = effectLibrary.find((effect) => effect.id === layer.effectId);
                        const titleMissing = Boolean(definition?.titleDirectoryPath && !layer.titlePath);
                        return (
                          <span
                            className={`fx-layer-chip ${layer.tier === 2 ? "tier2" : titleMissing ? "title-missing" : layer.titlePath ? "title-matched" : ""}`}
                            key={layer.id}
                            title={titleMissing
                              ? `No alpha title matched ${asset.name}`
                              : layer.titlePath ?? layer.backgroundPath ?? layer.filePath}
                          >
                            <i>
                              {index + 1} · {shortEffectName(layer.name)}
                              {layer.tier === 2
                                ? " · L2"
                                : titleMissing ? " · TITLE MISSING" : layer.titlePath ? " · BG+TITLE" : ""}
                            </i>
                            <button
                              aria-label={`Remove ${layer.name} from ${asset.name}`}
                              onClick={() => removeEffectLayerFromItem(asset.id, layer.id)}
                              title={`Remove ${layer.name} from this clip`}
                              type="button"
                            >
                              <Trash2 size={9} />
                            </button>
                          </span>
                        );
                      })()
                    ))}
                  </span>
                ) : null}
                </div>
              </div>
              )}
              {!collapsed ? (
              <button
                aria-label={`Remove ${asset.name} from playlist`}
                className="playlist-remove-button"
                onClick={() => onRemoveItem(asset.id)}
                title="Remove clip from playlist"
                type="button"
              >
                <Trash2 size={14} />
              </button>
              ) : null}
              {onAir ? (
                <span className="playlist-on-air-progress" aria-hidden="true">
                  <i style={{ width: `${onAirProgressPercent}%` }} />
                </span>
              ) : null}
            </div>
            </div>
            );
          })}
        </div>
        <div className="playlist-footer">
          <span>{playlist.length} clips · {formatTimecode(playlistDuration, "25")} total</span>
          <button
            onClick={() => onAddNativeFiles ? void onAddNativeFiles() : fileInput.current?.click()}
            type="button"
          >
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
            <img
              alt={`Preview for ${selectedAsset.name}`}
              src={scrubSeconds != null && scrubSeconds > 0
                ? mediaThumbnailUrl(selectedAsset.filePath, scrubSeconds)
                : previewSource}
            />
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
              onKeyUp={() => seekPreview(currentTime)}
              onPointerDown={() => {
                seeking.current = true;
                videoRef.current?.pause();
              }}
              onPointerUp={() => {
                seeking.current = false;
                seekPreview(currentTime);
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
              {formatTimecode(trimOut, selectedAsset.fps)} &nbsp;&nbsp; FX: {selectedAsset.effects?.length ?? 0}
            </span>
          </div>
          <EffectTimeline
            asset={selectedAsset}
            onRemoveLayer={removeEffectLayer}
            onRemoveTextOverlay={removeTextOverlay}
            onUpdateLayer={updateEffectLayer}
            onUpdateTextOverlay={updateTextOverlay}
          />
          {audioTracksEnabled ? (
            <div className="audio-track-timeline">
              {assetAudioLanes(
                selectedAsset,
                audioProgramLanguages,
                audioOriginalLanguage,
              ).map((lane) => (
                <div
                  className={`audio-track-lane ${lane.kind}`}
                  key={lane.key}
                  title={laneTooltip(lane, selectedAsset.durationSeconds)}
                >
                  {/* Заливка растёт строго от левого края превью вправо; хвост
                      полосы — тишина, которой эфир добивает короткую дорожку. */}
                  <div
                    className="audio-track-lane-fill"
                    style={{ width: `${(lane.fill * 100).toFixed(3)}%` }}
                  />
                  <span className="audio-track-lane-label">
                    {lane.label}
                    {lane.kind === "original" ? " original" : ""}
                    {lane.kind === "silent" ? " · silence" : ""}
                    {lane.kind === "partial"
                      ? ` · short by ${lane.shortfallSeconds.toFixed(1)} s`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
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
});

function EffectTimeline({
  asset,
  onRemoveLayer,
  onRemoveTextOverlay,
  onUpdateLayer,
  onUpdateTextOverlay,
}: {
  asset: MediaAsset;
  onRemoveLayer: (layerId: string) => void;
  onRemoveTextOverlay: (overlayId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<GraphicEffectLayer>) => void;
  onUpdateTextOverlay: (overlayId: string, patch: Partial<BroadcastTextOverlay>) => void;
}) {
  const duration = Math.max(0.04, effectiveClipDuration(asset));
  const layers = asset.effects ?? [];
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const dragState = useRef<{
    end: number;
    layerId: string;
    pointerX: number;
    railWidth: number;
    start: number;
  } | null>(null);

  function startLayerDrag(
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
    start: number,
    end: number,
  ) {
    if (event.button !== 0) return;
    const rail = event.currentTarget.parentElement;
    if (!rail) return;
    dragState.current = {
      end,
      layerId,
      pointerX: event.clientX,
      railWidth: Math.max(1, rail.getBoundingClientRect().width),
      start,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveLayer(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragState.current;
    if (!drag || drag.layerId !== event.currentTarget.dataset.layerId) return;
    const rawDelta = (event.clientX - drag.pointerX) / drag.railWidth * duration;
    const delta = Math.round(rawDelta / 0.04) * 0.04;
    const window = moveEffectLayerWindow({
      deltaSeconds: delta,
      durationSeconds: duration,
      endSeconds: drag.end,
      startSeconds: drag.start,
    });
    // Одна и та же дорожка таскает и FX-слой, и динамическую надпись — они
    // лежат в разных списках ролика, поэтому смотрим, кому принадлежит id.
    if (layers.some((layer) => layer.id === drag.layerId)) onUpdateLayer(drag.layerId, window);
    else onUpdateTextOverlay(drag.layerId, window);
  }

  function finishLayerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragState.current?.layerId !== event.currentTarget.dataset.layerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  return (
    <section className="effect-timeline">
      <div className="effect-ruler">
        <span />
        <div>{ticks.map((ratio) => <i key={ratio}>{formatTimecode(duration * ratio, asset.fps)}</i>)}</div>
      </div>
      <div className="effect-tracks">
        {layers.map((layer, index) => {
          const start = Math.min(duration - 0.04, Math.max(0, layer.startSeconds));
          const end = Math.min(duration, Math.max(start + 0.04, layer.endSeconds));
          return (
            <div
              className={`effect-track ${layer.tier === 2 ? "broadcast-track" : ""}`}
              key={layer.id}
            >
              <span title={layer.titlePath ?? layer.backgroundPath ?? layer.filePath}>
                <b>{layer.tier === 2 ? "L2" : `FX ${index + 1}`}</b>
                {shortEffectName(layer.name)} · {layer.tier === 2
                  ? (layer.sourceInSeconds > 0 ? "HEAD" : "BG")
                  : layer.titlePath ? "BG+TITLE" : "BG"}
              </span>
              <div className="effect-track-rail">
                <i
                  aria-label={`Move FX ${index + 1} on timeline`}
                  data-layer-id={layer.id}
                  onPointerCancel={finishLayerDrag}
                  onPointerDown={(event) => startLayerDrag(event, layer.id, start, end)}
                  onPointerMove={moveLayer}
                  onPointerUp={finishLayerDrag}
                  style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%` }}
                  title={`${formatTimecode(start, asset.fps)} – ${formatTimecode(end, asset.fps)}\n` +
                    "Перетащите, чтобы сдвинуть; края — подрезка"}
                >
                  <em>{formatLayerSeconds(end - start)}</em>
                </i>
                <input
                  aria-label={`FX ${index + 1} start`}
                  className="effect-range effect-range-start"
                  max={duration}
                  min={0}
                  onChange={(event) => onUpdateLayer(layer.id, {
                    startSeconds: Math.min(Number(event.target.value), end - 0.04),
                  })}
                  step={0.04}
                  type="range"
                  value={start}
                />
                <input
                  aria-label={`FX ${index + 1} end`}
                  className="effect-range effect-range-end"
                  max={duration}
                  min={0.04}
                  onChange={(event) => onUpdateLayer(layer.id, {
                    endSeconds: Math.max(Number(event.target.value), start + 0.04),
                  })}
                  step={0.04}
                  type="range"
                  value={end}
                />
              </div>
              <button aria-label={`Remove ${layer.name}`} onClick={() => onRemoveLayer(layer.id)} type="button">
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
        {(asset.textOverlays ?? []).map((overlay) => {
          const start = Math.min(duration - 0.04, Math.max(0, overlay.startSeconds));
          const end = Math.min(duration, Math.max(start + 0.04, overlay.endSeconds));
          return (
            <div className="effect-track broadcast-track" key={overlay.id}>
              <span title={overlay.content || overlay.mode}>
                <b>{overlay.mode.toUpperCase()}</b>{shortEffectName(overlay.name)}
              </span>
              <div className="effect-track-rail">
                <i
                  aria-label={`Move ${overlay.name} on timeline`}
                  data-layer-id={overlay.id}
                  onPointerCancel={finishLayerDrag}
                  onPointerDown={(event) => startLayerDrag(event, overlay.id, start, end)}
                  onPointerMove={moveLayer}
                  onPointerUp={finishLayerDrag}
                  style={{
                    left: `${start / duration * 100}%`,
                    width: `${(end - start) / duration * 100}%`,
                  }}
                  title={`${formatTimecode(start, asset.fps)} – ${formatTimecode(end, asset.fps)}\n` +
                    "Перетащите, чтобы сдвинуть; края — подрезка"}
                >
                  <em>{formatLayerSeconds(end - start)}</em>
                </i>
                <input
                  aria-label={`${overlay.name} start`}
                  className="effect-range effect-range-start"
                  max={duration}
                  min={0}
                  onChange={(event) => onUpdateTextOverlay(overlay.id, {
                    startSeconds: Math.min(Number(event.target.value), end - 0.04),
                  })}
                  step={0.04}
                  type="range"
                  value={start}
                />
                <input
                  aria-label={`${overlay.name} end`}
                  className="effect-range effect-range-end"
                  max={duration}
                  min={0.04}
                  onChange={(event) => onUpdateTextOverlay(overlay.id, {
                    endSeconds: Math.max(Number(event.target.value), start + 0.04),
                  })}
                  step={0.04}
                  type="range"
                  value={end}
                />
              </div>
              <button
                aria-label={`Remove ${overlay.name}`}
                onClick={() => onRemoveTextOverlay(overlay.id)}
                type="button"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
        {asset.subtitles?.enabled ? (
          <div className="effect-track system-track">
            <span><b>SRT</b>Subtitles</span>
            <div className="effect-track-rail"><i style={{ left: 0, width: "100%" }} /></div>
            <span />
          </div>
        ) : null}
        <div className="effect-track video-track">
          <span><b>VIDEO</b>{shortEffectName(asset.name)}</span>
          <div className="effect-track-rail"><i style={{ left: 0, width: "100%" }} /></div>
          <span />
        </div>
      </div>
    </section>
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

function laneTooltip(lane: AudioTrackLane, clipSeconds: number): string {
  const clip = `clip ${clipSeconds.toFixed(1)} s`;
  if (lane.kind === "silent") return `{${lane.label}}: no track for this item, silence (${clip})`;
  if (lane.durationSeconds == null) return `{${lane.label}}: duration unknown (${clip})`;
  const track = `track ${lane.durationSeconds.toFixed(1)} s`;
  return lane.shortfallSeconds > 0
    ? `{${lane.label}}: ${track}, ${clip} — last ` +
      `${lane.shortfallSeconds.toFixed(1)} s go to air as silence`
    : `{${lane.label}}: ${track}, ${clip}`;
}

function shortPath(value: string): string {
  if (!value) return "";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `…/${parts.slice(-2).join("/")}`;
}

/**
 * Подпись внутри блока на таймлайне — только длительность слоя. Полный тайм-код
 * с обеих сторон не помещался в узкий блок и, упираясь в конец ролика, вылезал
 * за панель горизонтальной прокруткой. Точные границы остались в подсказке.
 */
function formatLayerSeconds(seconds: number): string {
  const value = Math.max(0, seconds);
  return value >= 100 ? `${Math.round(value)} с` : `${value.toFixed(1)} с`;
}

/**
 * Плотность чипов графики в строке ролика.
 *
 * Число слоёв у ролика ничем не ограничено, а высота строки расти не должна:
 * чипы уходят в колонки и уменьшаются по мере накопления, оставаясь в пределах
 * той же высоты. Порог считается по всей графике ролика — FX-слои и
 * динамические надписи делят одно и то же место.
 */
/**
 * Чипы эфирных эффектов ролика: один эффект — один чип.
 *
 * На ролик эффект второго уровня кладёт до двух сущностей: плашку из пресета
 * (готовый файл) и живое значение (рисуется покадрово). Показывать их двумя
 * записями значило бы выдавать одно применение за два эффекта.
 */
function broadcastChips(asset: MediaAsset): {
  effectId: string;
  name: string;
  badge: string;
  title: string;
}[] {
  const groups = new Map<string, { name: string; plate: boolean; modes: string[] }>();
  for (const layer of asset.effects ?? []) {
    if (layer.tier !== 2) continue;
    const group = groups.get(layer.effectId) ?? { modes: [], name: layer.name, plate: false };
    group.plate = true;
    groups.set(layer.effectId, group);
  }
  for (const overlay of asset.textOverlays ?? []) {
    const group = groups.get(overlay.effectId) ?? { modes: [], name: overlay.name, plate: false };
    group.name = overlay.name;
    if (!group.modes.includes(overlay.mode)) group.modes.push(overlay.mode);
    groups.set(overlay.effectId, group);
  }
  return [...groups.entries()].map(([effectId, group]) => {
    const parts = [...group.modes.map((mode) => mode.toUpperCase())];
    if (group.plate) parts.push("ПЛАШКА");
    return {
      badge: parts.join("+") || "L2",
      effectId,
      name: group.name,
      title: group.plate && group.modes.length > 0
        ? `${group.name}: плашка из пресета плюс живое значение`
        : group.plate
          ? `${group.name}: плашка из пресета`
          : `${group.name}: живое значение`,
    };
  });
}

function fxDensityClass(asset: MediaAsset): string {
  const total = (asset.effects?.length ?? 0) + (asset.textOverlays?.length ?? 0);
  if (total > 8) return "has-many-fx fx-density-high";
  if (total > 4) return "has-many-fx fx-density-medium";
  if (total > 2) return "has-many-fx";
  return "";
}

function effectiveClipDuration(asset: MediaAsset): number {
  return Math.max(0.04, airDurationSeconds(asset));
}

function shortEffectName(value: string): string {
  const name = value.replace(/\.[^.]+$/, "");
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function findMatchingSubtitle(mediaName: string, subtitlePaths: string[]): string | null {
  return matchingNamedAssetPath(mediaName, subtitlePaths);
}

function findMatchingEffectTitle(
  mediaName: string,
  effect: GraphicEffectAsset,
): string | null {
  if (!effect.titleDirectoryPath) return null;
  return matchingNamedAssetPath(mediaName, effect.titlePaths);
}

/** Есть ли уже посчитанный кусок в этой точке: перемотка по нему проходит без перезапуска. */
function isBuffered(video: HTMLVideoElement, seconds: number): boolean {
  const margin = 0.25;
  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (seconds >= start - margin && seconds <= end - margin) return true;
  }
  return false;
}

/** Анимированный ли логотип: у картинки повтор ничего не меняет. */
function animatedLogo(filePath: string): boolean {
  return /\.(mov|mp4|m4v|webm|mkv|gif|json)$/i.test(filePath.trim());
}
