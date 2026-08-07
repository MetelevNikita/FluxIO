import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  serviceHealthSchema,
  type FfmpegCapabilities,
  type MediaProbe,
  type ParsedSchedule,
  type ScheduleExportExtension,
  type SerializeScheduleRequest,
  type NetworkInterfaceInfo,
  type PlayoutStatus,
  type SavedWorkspaceSession,
  type ScheduleStartMarker,
  type ServiceHealth,
  type StartPlayoutRequest,
  type SystemMetrics,
  type WorkspaceSessionCheckpoint,
  type WorkspaceSessionSaveRequest,
} from "@gruber/contracts";
import { AppHeader } from "./components/AppHeader";
import { GlobalStatusBar } from "./components/GlobalStatusBar";
import {
  additionalPlaylistAssets,
  initialAssets,
  initialBroadcastSettings,
} from "./demo-data";
import { BroadcastSettingsScreen } from "./screens/BroadcastSettingsScreen";
import { ImportAnalyzeScreen } from "./screens/ImportAnalyzeScreen";
import { PlaylistPreviewScreen } from "./screens/PlaylistPreviewScreen";
import { mediaPath } from "./runtime";
import {
  getFfmpegCapabilities,
  getNetworkInterfaces,
  getPlayoutStatus,
  getSystemMetrics,
  getWorkspaceSession,
  mediaThumbnailUrl,
  parseScheduleFile,
  probeMediaPaths,
  scanMediaDirectory,
  serializeScheduleFile,
  saveWorkspaceSession as persistWorkspaceSession,
  deleteWorkspaceSession as deletePersistedWorkspaceSession,
  startPlayout as startPlayoutSession,
  stopPlayout as stopPlayoutSession,
  takePlayout as takePlayoutSession,
} from "./media-api";
import type {
  AppView,
  BroadcastSettings,
  MediaAsset,
  ScheduleMetadata,
  ScheduleOverlayLibrary,
  ScheduleSlot,
  Scte35Marker,
} from "./types";

export type ConnectionState =
  | { kind: "loading" }
  | { kind: "ready"; health: ServiceHealth }
  | { kind: "error"; message: string };

const initialPlaylist = [
  initialAssets[2],
  initialAssets[0],
  initialAssets[1],
  initialAssets[3],
  initialAssets[4],
  ...additionalPlaylistAssets,
].filter((asset): asset is MediaAsset => Boolean(asset));

const demoDataEnabled = import.meta.env.VITE_ENABLE_DEMO_DATA === "true";

export function App() {
  const [view, setView] = useState<AppView>("import");
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "loading",
  });
  const [assets, setAssets] = useState<MediaAsset[]>(() =>
    demoDataEnabled ? initialAssets : [],
  );
  const [playlist, setPlaylist] = useState<MediaAsset[]>(() =>
    demoDataEnabled ? initialPlaylist : [],
  );
  const [futurePlaylist, setFuturePlaylist] = useState<MediaAsset[]>([]);
  const [activeSchedule, setActiveSchedule] = useState<ScheduleSlot>("current");
  const [currentScheduleMetadata, setCurrentScheduleMetadata] = useState<ScheduleMetadata | null>(null);
  const [futureScheduleMetadata, setFutureScheduleMetadata] = useState<ScheduleMetadata | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState(() =>
    demoDataEnabled ? "production" : "",
  );
  const [settings, setSettings] = useState<BroadcastSettings>(
    initialBroadcastSettings,
  );
  const [capabilities, setCapabilities] = useState<FfmpegCapabilities | null>(null);
  const [playoutStatus, setPlayoutStatus] = useState<PlayoutStatus | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [scheduleLogoPath, setScheduleLogoPath] = useState("");
  const [scheduleLogoSource, setScheduleLogoSource] = useState("");
  const [ageLibrary, setAgeLibrary] = useState<ScheduleOverlayLibrary | null>(null);
  const [scheduleActionMessage, setScheduleActionMessage] = useState<string | null>(null);
  const [savedWorkspaceSession, setSavedWorkspaceSession] = useState<SavedWorkspaceSession | null>(null);
  const [recoveryCheckpoint, setRecoveryCheckpoint] = useState<WorkspaceSessionCheckpoint | null>(null);
  const [scheduleStartMarker, setScheduleStartMarker] = useState<ScheduleStartMarker | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [takeBusy, setTakeBusy] = useState(false);
  const workspaceRestoreStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const healthPayload = window.gruberDesktop
          ? await window.gruberDesktop.getServiceHealth()
          : await fetchHealth();
        const health = serviceHealthSchema.parse(healthPayload);
        if (!cancelled) {
          setConnection({ kind: "ready", health });
        }
      } catch (error) {
        if (!cancelled) {
          setConnection({
            kind: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    void loadHealth();
    const timer = window.setInterval(() => void loadHealth(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (connection.kind !== "ready") {
      return;
    }
    let cancelled = false;

    async function refresh() {
      try {
        const [nextCapabilities, nextStatus, nextMetrics, nextNetworkInterfaces] = await Promise.all([
          getFfmpegCapabilities(),
          getPlayoutStatus(),
          getSystemMetrics(),
          getNetworkInterfaces(),
        ]);
        if (!cancelled) {
          setCapabilities(nextCapabilities);
          setPlayoutStatus(nextStatus);
          setSystemMetrics(nextMetrics);
          setNetworkInterfaces(nextNetworkInterfaces);
          const preferredInterface = nextNetworkInterfaces.find(
            (entry) => entry.family === "IPv4" && !entry.internal,
          );
          if (preferredInterface) {
            setSettings((current) => current.udpLocalAddress
              ? current
              : { ...current, udpLocalAddress: preferredInterface.address });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setOperationError(errorMessage(error));
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void Promise.all([getPlayoutStatus(), getSystemMetrics()])
        .then(([status, metrics]) => {
          if (!cancelled) {
            setPlayoutStatus(status);
            setSystemMetrics(metrics);
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection.kind]);

  useEffect(() => {
    if (
      connection.kind !== "ready" ||
      connection.health.status !== "ready" ||
      demoDataEnabled ||
      workspaceRestoreStarted.current
    ) {
      return;
    }
    workspaceRestoreStarted.current = true;
    let cancelled = false;
    void getWorkspaceSession()
      .then((session) => {
        if (!cancelled && session) restoreWorkspaceSnapshot(session);
      })
      .catch((error) => {
        if (!cancelled) setOperationError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const visiblePlaylist = activeSchedule === "current" ? playlist : futurePlaylist;
  const selectedAsset = useMemo(
    () =>
      visiblePlaylist.find((asset) => asset.id === selectedAssetId) ?? visiblePlaylist[0],
    [visiblePlaylist, selectedAssetId],
  );
  const recoverySelection = useMemo(
    () => recoveryCheckpoint
      ? recoveryPointForPlaylist(playlist, recoveryCheckpoint)
      : null,
    [playlist, recoveryCheckpoint],
  );

  function restoreWorkspaceSnapshot(session: SavedWorkspaceSession) {
    const snapshot = session.snapshot;
    const restoredAssets = snapshot.assets.length > 0
      ? snapshot.assets
      : mergeAssets([], [...snapshot.currentPlaylist, ...snapshot.futurePlaylist]);
    const checkpointSelection = session.checkpoint && (
      session.checkpoint.interrupted ||
      ["starting", "running", "stopping"].includes(session.checkpoint.state)
    )
      ? recoveryPointForPlaylist(snapshot.currentPlaylist, session.checkpoint)
      : null;
    setAssets(restoredAssets);
    setPlaylist(snapshot.currentPlaylist);
    setFuturePlaylist(snapshot.futurePlaylist);
    setCurrentScheduleMetadata(snapshot.currentScheduleMetadata);
    setFutureScheduleMetadata(snapshot.futureScheduleMetadata);
    setScheduleLogoPath(snapshot.scheduleLogoPath);
    setScheduleLogoSource(snapshot.scheduleLogoSource);
    setAgeLibrary(snapshot.ageLibrary);
    setScheduleStartMarker(
      snapshot.startMarker && snapshot.currentPlaylist.some(
        (asset) => asset.id === snapshot.startMarker?.assetId,
      )
        ? snapshot.startMarker
        : null,
    );
    setSettings({ ...initialBroadcastSettings, ...snapshot.settings } as BroadcastSettings);
    setActiveSchedule(checkpointSelection ? "current" : snapshot.activeSchedule);
    setSelectedAssetId(
      checkpointSelection?.asset.id ??
      snapshot.selectedAssetId ??
      snapshot.currentPlaylist[0]?.id ??
      snapshot.futurePlaylist[0]?.id ??
      "",
    );
    setSavedWorkspaceSession(session);
    setRecoveryCheckpoint(session.checkpoint?.interrupted ? session.checkpoint : null);
    setScheduleActionMessage(
      session.checkpoint?.interrupted
        ? `Interrupted session restored at ${formatClock(session.checkpoint.outTimeSeconds)}.`
        : checkpointSelection && session.checkpoint
          ? `Active playout reattached at ${formatClock(session.checkpoint.outTimeSeconds)}.`
          : `Session restored from ${new Date(session.updatedAt).toLocaleString()}.`,
    );
    if (snapshot.currentPlaylist.length > 0 || snapshot.futurePlaylist.length > 0) {
      setView("playlist");
    }
  }

  const addFiles = useCallback((files: File[]) => {
    const accepted = files.filter(
      (file) =>
        file.type.startsWith("video/") ||
        /\.(mov|mp4|mkv|mxf|avi|m4v|ts)$/i.test(file.name),
    );

    if (window.gruberDesktop) {
      const paths = accepted
        .map((file) => window.gruberDesktop?.getMediaFilePath(file) ?? "")
        .filter(Boolean);
      if (paths.length > 0) {
        void analyzePaths(paths);
        return;
      }
    }

    const imported: MediaAsset[] = accepted.map((file, index) => ({
      id: `local-${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      duration: "Analyzing…",
      durationSeconds: 0,
      codec: "Detecting…",
      codecFamily: "—",
      codecProfile: "—",
      resolution: "—",
      fps: "—",
      bitrate: "—",
      size: formatBytes(file.size),
      status: "pending",
      progress: 0,
      preview: mediaPath("production.png"),
      filePath: file.name,
      colorSpace: "Detecting…",
      audio: "Detecting…",
      sha256: "Waiting for media service",
    }));

    setAssets((current) => [...current, ...imported]);
    setPlaylist((current) => [...current, ...imported]);
  }, []);

  async function addNativeFiles() {
    const paths = await window.gruberDesktop?.selectMediaFiles();
    if (paths?.length) {
      await analyzePaths(paths);
    }
  }

  async function addNativeDirectory() {
    const directoryPath = await window.gruberDesktop?.selectMediaDirectory();
    if (!directoryPath) {
      return;
    }
    setMediaBusy(true);
    setOperationError(null);
    try {
      addProbes(await scanMediaDirectory(directoryPath));
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setMediaBusy(false);
    }
  }

  async function importNativeSchedule(slot: ScheduleSlot) {
    const schedulePath = await window.gruberDesktop?.selectScheduleFile();
    if (!schedulePath) return;
    setMediaBusy(true);
    setOperationError(null);
    try {
      const parsed = await parseScheduleFile(schedulePath);
      const probesByPath = await probeSchedulePaths(parsed);
      const ageAssets = mapAgeAssetPaths(ageLibrary?.imagePaths ?? []);
      const scheduledAssets = parsed.items.map((item, index) => {
        const probe = probesByPath.get(item.filePath);
        const base = probe
          ? probeToAsset(probe)
          : { ...pendingAssetFromPath(item.filePath), status: "error" as const, progress: undefined };
        const ageText = item.ageTitle ?? ageRatingFromFileName(base.name);
        const logoPath = (item.logoPath ?? scheduleLogoPath) || undefined;
        return {
          ...base,
          id: `schedule-${slot}-${hashString(parsed.sourceFilePath)}-${index}`,
          scheduleType: item.type,
          declaredDurationSeconds: item.declaredDurationSeconds,
          scheduleLineNumber: item.lineNumber,
          ageTitle: ageText
            ? {
                durationSeconds: 5,
                enabled: true,
                filePath: ageAssets.get(ageText) ?? null,
                text: ageText,
              }
            : undefined,
          itemLogo: logoPath
            ? {
                enabled: true,
                filePath: logoPath,
                margin: 24,
                opacity: 1,
                position: "top-right" as const,
                widthPercent: 12,
              }
            : undefined,
        } satisfies MediaAsset;
      });
      const metadata = scheduleMetadata(parsed);
      setAssets((current) => mergeAssets(current, scheduledAssets));
      if (slot === "current") {
        setPlaylist(scheduledAssets);
        setCurrentScheduleMetadata(metadata);
        setScheduleStartMarker(null);
      } else {
        setFuturePlaylist(scheduledAssets);
        setFutureScheduleMetadata(metadata);
      }
      setActiveSchedule(slot);
      setSelectedAssetId(scheduledAssets[0]?.id ?? "");
      setScheduleActionMessage(
        `${slot === "current" ? "Current" : "Future"} schedule imported: ${scheduledAssets.length} items.`,
      );
      const failed = scheduledAssets.filter((asset) => asset.status === "error");
      if (failed.length > 0) {
        setOperationError(
          `Schedule imported, but ${failed.length} of ${scheduledAssets.length} media files could not be analyzed.`,
        );
      }
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setMediaBusy(false);
    }
  }

  async function analyzePaths(paths: string[], slot: ScheduleSlot = "current") {
    setMediaBusy(true);
    setOperationError(null);
    const pathSet = new Set(paths);
    const pending = paths.map(pendingAssetFromPath);
    setAssets((current) => mergeAssets(current, pending));
    if (slot === "current") setPlaylist((current) => mergeAssets(current, pending));
    else setFuturePlaylist((current) => mergeAssets(current, pending));
    try {
      addProbes(await probeMediaPaths(paths), slot);
    } catch (error) {
      setOperationError(errorMessage(error));
      const markFailed = (items: MediaAsset[]) => items.map((item) =>
        pathSet.has(item.filePath)
          ? { ...item, progress: undefined, status: "error" as const }
          : item
      );
      setAssets(markFailed);
      if (slot === "current") setPlaylist(markFailed);
      else setFuturePlaylist(markFailed);
    } finally {
      setMediaBusy(false);
    }
  }

  function addProbes(probes: MediaProbe[], slot: ScheduleSlot = "current") {
    const imported = assignAgeAssets(
      probes.map(probeToAsset),
      mapAgeAssetPaths(ageLibrary?.imagePaths ?? []),
    );
    setAssets((current) => mergeAssets(current, imported));
    if (slot === "current") setPlaylist((current) => mergeAssets(current, imported));
    else setFuturePlaylist((current) => mergeAssets(current, imported));
    setSelectedAssetId((current) => current || imported[0]?.id || "");
  }

  function movePlaylistItem(sourceId: string, targetId: string) {
    updateActivePlaylist((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);

      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current;
      }

      const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      if (!source) {
        return current;
      }
      next.splice(targetIndex, 0, source);
      return next;
    });
  }

  function removePlaylistItem(assetId: string) {
    const removedIndex = visiblePlaylist.findIndex((asset) => asset.id === assetId);
    if (removedIndex < 0) return;
    const next = visiblePlaylist.filter((asset) => asset.id !== assetId);
    setActivePlaylist(next);
    if (activeSchedule === "current" && scheduleStartMarker?.assetId === assetId) {
      setScheduleStartMarker(null);
      setScheduleActionMessage("Schedule start marker was removed with its clip.");
    }
    if (selectedAssetId === assetId) {
      setSelectedAssetId(next[removedIndex]?.id ?? next[removedIndex - 1]?.id ?? "");
    }
  }

  function addScte35Marker(assetId: string, marker: Scte35Marker) {
    updateActivePlaylist((current) => current.map((asset) =>
      asset.id === assetId
        ? { ...asset, scte35Markers: [...(asset.scte35Markers ?? []), marker] }
        : asset
    ));
  }

  function removeScte35Marker(assetId: string, markerId: string) {
    updateActivePlaylist((current) => current.map((asset) =>
      asset.id === assetId
        ? {
            ...asset,
            scte35Markers: (asset.scte35Markers ?? []).filter((marker) => marker.id !== markerId),
          }
        : asset
    ));
  }

  function clearMedia() {
    setAssets([]);
    setPlaylist([]);
    setFuturePlaylist([]);
    setCurrentScheduleMetadata(null);
    setFutureScheduleMetadata(null);
    setScheduleLogoPath("");
    setScheduleLogoSource("");
    setAgeLibrary(null);
    setScheduleStartMarker(null);
    setScheduleActionMessage(null);
    setSelectedAssetId("");
  }

  async function saveSessionList() {
    if (playlist.length === 0 && futurePlaylist.length === 0) {
      setOperationError("Add media to Current or Future before saving a session list.");
      return;
    }
    setWorkspaceBusy(true);
    setOperationError(null);
    try {
      const request: WorkspaceSessionSaveRequest = {
        snapshot: {
          version: 1,
          assets,
          currentPlaylist: playlist,
          futurePlaylist,
          activeSchedule,
          selectedAssetId: selectedAssetId || null,
          currentScheduleMetadata,
          futureScheduleMetadata,
          scheduleLogoPath,
          scheduleLogoSource,
          ageLibrary,
          startMarker: scheduleStartMarker,
          settings: primitiveSettings(settings),
        },
      };
      const saved = await persistWorkspaceSession(request);
      setSavedWorkspaceSession(saved);
      setRecoveryCheckpoint(saved.checkpoint?.interrupted ? saved.checkpoint : null);
      setScheduleActionMessage(
        `Session list saved at ${new Date(saved.updatedAt).toLocaleString()}.`,
      );
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function createNewPlaylist() {
    const hasWorkspace = playlist.length > 0 || futurePlaylist.length > 0 || savedWorkspaceSession;
    if (
      hasWorkspace &&
      !window.confirm(
        "Create a new playlist? The saved recovery session and both Current/Future schedules will be cleared.",
      )
    ) {
      return;
    }
    setWorkspaceBusy(true);
    setOperationError(null);
    try {
      if (playoutStatus && ["starting", "running", "stopping"].includes(playoutStatus.state)) {
        await stopPlayoutSession();
      }
      await deletePersistedWorkspaceSession();
      clearMedia();
      setSettings(initialBroadcastSettings);
      setActiveSchedule("current");
      setSavedWorkspaceSession(null);
      setRecoveryCheckpoint(null);
      setView("import");
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function addFilesToActiveSchedule(files: File[]) {
    if (activeSchedule === "current" || !window.gruberDesktop) {
      addFiles(files);
      return;
    }
    const paths = files
      .map((file) => window.gruberDesktop?.getMediaFilePath(file) ?? "")
      .filter(Boolean);
    if (paths.length > 0) void analyzePaths(paths, "future");
  }

  function updatePlaylistItem(assetId: string, patch: Partial<MediaAsset>) {
    updateActivePlaylist((current) => current.map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset
    ));
  }

  function updateBulkAge(assetIds: string[], rating: string | null) {
    const selected = new Set(assetIds);
    const ageAssets = mapAgeAssetPaths(ageLibrary?.imagePaths ?? []);
    updateActivePlaylist((items) => items.map((asset) => {
      if (!selected.has(asset.id)) return asset;
      if (!rating) {
        return asset.ageTitle
          ? { ...asset, ageTitle: { ...asset.ageTitle, enabled: false } }
          : asset;
      }
      return {
        ...asset,
        ageTitle: {
          durationSeconds: asset.ageTitle?.durationSeconds ?? 5,
          enabled: true,
          filePath: ageAssets.get(rating) ?? null,
          text: rating,
        },
      };
    }));
    setScheduleActionMessage(
      rating
        ? `AGE ${rating} assigned to ${assetIds.length} selected item(s).`
        : `AGE disabled for ${assetIds.length} selected item(s).`,
    );
  }

  function updateBulkLogo(assetIds: string[], enabled: boolean) {
    const selected = new Set(assetIds);
    const fallbackPath = scheduleLogoPath
      || visiblePlaylist.find((asset) => selected.has(asset.id) && asset.itemLogo?.filePath)?.itemLogo?.filePath
      || visiblePlaylist.find((asset) => asset.itemLogo?.filePath)?.itemLogo?.filePath
      || "";
    if (enabled && !fallbackPath) {
      setOperationError("Select a channel logo file or folder before enabling LOGO in bulk.");
      return;
    }
    updateActivePlaylist((items) => items.map((asset) => {
      if (!selected.has(asset.id)) return asset;
      if (!enabled) {
        return asset.itemLogo
          ? { ...asset, itemLogo: { ...asset.itemLogo, enabled: false } }
          : asset;
      }
      const filePath = asset.itemLogo?.filePath || fallbackPath;
      if (!filePath) return asset;
      return {
        ...asset,
        itemLogo: {
          enabled: true,
          filePath,
          margin: asset.itemLogo?.margin ?? 24,
          opacity: asset.itemLogo?.opacity ?? 1,
          position: asset.itemLogo?.position ?? "top-right",
          widthPercent: asset.itemLogo?.widthPercent ?? 12,
        },
      };
    }));
    setOperationError(null);
    setScheduleActionMessage(
      `LOGO ${enabled ? "enabled" : "disabled"} for ${assetIds.length} selected item(s).`,
    );
  }

  function setScheduleTab(slot: ScheduleSlot) {
    setActiveSchedule(slot);
    const target = slot === "current" ? playlist : futurePlaylist;
    setSelectedAssetId(target[0]?.id ?? "");
  }

  function setActivePlaylist(next: MediaAsset[]) {
    if (activeSchedule === "current") setPlaylist(next);
    else setFuturePlaylist(next);
  }

  function updateActivePlaylist(updater: (current: MediaAsset[]) => MediaAsset[]) {
    if (activeSchedule === "current") setPlaylist(updater);
    else setFuturePlaylist(updater);
  }

  async function selectScheduleLogoFile() {
    const filePath = await window.gruberDesktop?.selectLogoFile();
    if (filePath) applyScheduleLogo(filePath, filePath);
  }

  async function selectScheduleLogoDirectory() {
    const selection = await window.gruberDesktop?.selectScheduleLogoDirectory();
    if (!selection) return;
    const logoPath = preferredLogoPath(selection.imagePaths);
    if (!logoPath) {
      setOperationError("The selected logo folder contains no PNG, WebP or JPEG images.");
      return;
    }
    applyScheduleLogo(logoPath, selection.directoryPath);
  }

  function applyScheduleLogo(filePath: string, source: string) {
    setOperationError(null);
    setScheduleLogoPath(filePath);
    setScheduleLogoSource(source);
    updateActivePlaylist((items) => items.map((asset) => ({
      ...asset,
      itemLogo: {
        enabled: asset.itemLogo?.enabled ?? true,
        filePath,
        margin: asset.itemLogo?.margin ?? 24,
        opacity: asset.itemLogo?.opacity ?? 1,
        position: asset.itemLogo?.position ?? "top-right",
        widthPercent: asset.itemLogo?.widthPercent ?? 12,
      },
    })));
    setScheduleActionMessage(`Channel logo assigned to ${activeSchedule} schedule.`);
  }

  async function selectAgeDirectory() {
    const selection = await window.gruberDesktop?.selectAgeDirectory();
    if (!selection) return;
    const ageAssets = mapAgeAssetPaths(selection.imagePaths);
    setAgeLibrary(selection);
    setPlaylist((items) => assignAgeAssets(items, ageAssets));
    setFuturePlaylist((items) => assignAgeAssets(items, ageAssets));
    setOperationError(null);
    setScheduleActionMessage(
      `AGE folder loaded: ${ageAssets.size} rating graphic(s), filename markers updated.`,
    );
  }

  async function saveActiveSchedule(extension: ScheduleExportExtension) {
    if (visiblePlaylist.length === 0) return;
    setMediaBusy(true);
    setOperationError(null);
    setScheduleActionMessage(null);
    try {
      const metadata = activeSchedule === "current"
        ? currentScheduleMetadata
        : futureScheduleMetadata;
      const request: SerializeScheduleRequest = {
        delaySeconds: metadata?.delaySeconds ?? 0,
        extension,
        items: visiblePlaylist.map((asset) => ({
          type: asset.scheduleType ?? inferScheduleType(
            asset.declaredDurationSeconds ?? asset.durationSeconds,
          ),
          declaredDurationSeconds: asset.declaredDurationSeconds ?? asset.durationSeconds,
          filePath: asset.filePath,
          ageTitle: asset.ageTitle
            ? { enabled: asset.ageTitle.enabled, text: asset.ageTitle.text }
            : null,
          logoPath: asset.itemLogo?.enabled ? asset.itemLogo.filePath : null,
        })),
        startTime: metadata?.startTime ?? "12:00:00.00",
      };
      const serialized = await serializeScheduleFile(request);
      const sourceBase = (metadata?.sourceName ?? `${activeSchedule}-schedule`)
        .replace(/\.(?:air|txt)$/i, "") || `${activeSchedule}-schedule`;
      const defaultName = `${sourceBase}-edited.${extension}`;
      let outputPath: string | null = null;
      if (window.gruberDesktop) {
        outputPath = await window.gruberDesktop.saveScheduleFile({
          content: serialized.content,
          defaultName,
          extension,
        });
      } else {
        downloadSchedule(serialized.content, defaultName);
        outputPath = defaultName;
      }
      if (outputPath) {
        setScheduleActionMessage(`Schedule saved: ${outputPath}`);
      }
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setMediaBusy(false);
    }
  }

  function setStartMarker(assetId: string) {
    if (activeSchedule !== "current") {
      setOperationError("A schedule start marker can only be set in the Current playlist.");
      return;
    }
    const asset = playlist.find((item) => item.id === assetId);
    if (!asset) return;
    setScheduleStartMarker({ assetId, updatedAt: new Date().toISOString() });
    setOperationError(null);
    setScheduleActionMessage(`Schedule will start from "${asset.name}".`);
  }

  function clearStartMarker() {
    setScheduleStartMarker(null);
    setScheduleActionMessage("Schedule start marker cleared.");
  }

  async function startFromPlaylistItem(assetId: string) {
    if (activeSchedule !== "current") {
      setOperationError("Hot take is only available from the Current playlist.");
      return;
    }
    const asset = playlist.find((item) => item.id === assetId);
    if (!asset) return;
    if (asset.status !== "analyzed") {
      setOperationError("Analyze the selected clip successfully before using it as a start point.");
      return;
    }
    const active = playoutStatus
      ? ["starting", "running", "stopping"].includes(playoutStatus.state)
      : false;
    if (!active) {
      setStartMarker(assetId);
      return;
    }
    if (!window.confirm(
      `Take "${asset.name}" on air now? The current playout process will be restarted.`,
    )) return;

    setStartMarker(assetId);
    setTakeBusy(true);
    setOperationError(null);
    try {
      const request = buildStartRequestFromAsset(
        buildStartRequest(playlist, settings),
        playlist,
        assetId,
      );
      setPlayoutStatus(await takePlayoutSession(request));
      setRecoveryCheckpoint(null);
      setScheduleActionMessage(`Hot take is on air from "${asset.name}".`);
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setTakeBusy(false);
    }
  }

  async function startPlayout(mode: "default" | "resume" | "beginning" = "default") {
    setOperationError(null);
    try {
      const baseRequest = buildStartRequest(playlist, settings);
      const request = mode === "resume" && recoveryCheckpoint
        ? buildRecoveryStartRequest(baseRequest, playlist, recoveryCheckpoint)
        : mode === "default" && scheduleStartMarker
          ? buildStartRequestFromAsset(
              baseRequest,
              playlist,
              scheduleStartMarker.assetId,
            )
          : baseRequest;
      setPlayoutStatus(await startPlayoutSession(request));
      setRecoveryCheckpoint(null);
      setScheduleActionMessage(
        mode === "resume"
          ? `Playout resumed from ${formatClock(recoveryCheckpoint?.outTimeSeconds ?? 0)}.`
          : mode === "default" && scheduleStartMarker
            ? `Playout started from "${playlist.find((asset) => asset.id === scheduleStartMarker.assetId)?.name ?? "marked clip"}".`
            : "Playout started from the beginning.",
      );
    } catch (error) {
      setOperationError(errorMessage(error));
    }
  }

  async function stopPlayout() {
    setOperationError(null);
    try {
      setPlayoutStatus(await stopPlayoutSession());
    } catch (error) {
      setOperationError(errorMessage(error));
    }
  }

  return (
    <div className="console-shell">
      <AppHeader
        activeView={view}
        connection={connection}
        onNavigate={setView}
        systemMetrics={systemMetrics}
      />

      {view === "import" ? (
        <ImportAnalyzeScreen
          assets={assets}
          onAddFiles={addFiles}
          busy={mediaBusy}
          onClear={clearMedia}
          onSelectDirectory={window.gruberDesktop ? addNativeDirectory : undefined}
          onSelectFiles={window.gruberDesktop ? addNativeFiles : undefined}
          onSelectSchedule={window.gruberDesktop ? importNativeSchedule : undefined}
          onProceed={() => setView("playlist")}
          operationError={operationError}
        />
      ) : null}

      {view === "playlist" ? (
        selectedAsset ? (
          <PlaylistPreviewScreen
            playlist={visiblePlaylist}
            selectedAsset={selectedAsset}
            activeSchedule={activeSchedule}
            currentCount={playlist.length}
            futureCount={futurePlaylist.length}
            scheduleMetadata={activeSchedule === "current" ? currentScheduleMetadata : futureScheduleMetadata}
            onAddFiles={addFilesToActiveSchedule}
            onAddScte35Marker={addScte35Marker}
            onMoveItem={movePlaylistItem}
            onBulkAgeChange={updateBulkAge}
            onBulkLogoChange={updateBulkLogo}
            onRemoveItem={removePlaylistItem}
            onRemoveScte35Marker={removeScte35Marker}
            onSelectAsset={setSelectedAssetId}
            onScheduleChange={setScheduleTab}
            onSaveSchedule={saveActiveSchedule}
            onSaveSessionList={saveSessionList}
            onNewPlaylist={createNewPlaylist}
            onSelectAgeDirectory={window.gruberDesktop ? selectAgeDirectory : undefined}
            onSelectScheduleLogoDirectory={window.gruberDesktop
              ? selectScheduleLogoDirectory
              : undefined}
            onSelectScheduleLogoFile={window.gruberDesktop
              ? selectScheduleLogoFile
              : undefined}
            onUpdateItem={updatePlaylistItem}
            ageLibrary={ageLibrary}
            scheduleActionMessage={scheduleActionMessage}
            scheduleBusy={mediaBusy}
            workspaceBusy={workspaceBusy}
            takeBusy={takeBusy}
            savedSessionUpdatedAt={savedWorkspaceSession?.updatedAt ?? null}
            recoveryCheckpoint={recoveryCheckpoint}
            scheduleStartMarker={scheduleStartMarker}
            playoutActive={Boolean(playoutStatus && ["starting", "running", "stopping"].includes(playoutStatus.state))}
            initialPreviewTimeSeconds={
              recoverySelection?.asset.id === selectedAsset.id
                ? recoverySelection.itemOffsetSeconds
                : null
            }
            scheduleLogoSource={scheduleLogoSource || scheduleLogoPath}
            scheduleLogoPath={scheduleLogoPath}
            scte35Defaults={settings}
            onClearStartMarker={clearStartMarker}
            onStartFromItem={startFromPlaylistItem}
          />
        ) : (
          <EmptyPlaylist
            activeSchedule={activeSchedule}
            currentCount={playlist.length}
            futureCount={futurePlaylist.length}
            onOpenLibrary={() => setView("import")}
            onScheduleChange={setScheduleTab}
          />
        )
      ) : null}

      {view === "broadcast" ? (
        <BroadcastSettingsScreen
          settings={settings}
          networkInterfaces={networkInterfaces}
          capabilities={capabilities}
          onSettingsChange={setSettings}
          onStart={() => void startPlayout(recoveryCheckpoint ? "resume" : "default")}
          onStartFresh={() => void startPlayout("beginning")}
          onStop={() => void stopPlayout()}
          operationError={operationError}
          playlistLength={playlist.length}
          scte35MarkerCount={playlist.reduce(
            (total, asset) => total + (asset.scte35Markers?.length ?? 0),
            0,
          )}
          playoutStatus={playoutStatus}
          recoveryCheckpoint={recoveryCheckpoint}
          scheduleStartMarker={scheduleStartMarker}
          scheduleStartItemName={playlist.find(
            (asset) => asset.id === scheduleStartMarker?.assetId,
          )?.name ?? null}
        />
      ) : null}

      <GlobalStatusBar
        connection={connection}
        serverAddress={mediaServerAddress()}
        status={playoutStatus}
      />
    </div>
  );
}

function EmptyPlaylist({
  activeSchedule,
  currentCount,
  futureCount,
  onOpenLibrary,
  onScheduleChange,
}: {
  activeSchedule: ScheduleSlot;
  currentCount: number;
  futureCount: number;
  onOpenLibrary: () => void;
  onScheduleChange: (slot: ScheduleSlot) => void;
}) {
  return (
    <main className="empty-playlist screen-body">
      <div>
        <div className="schedule-tabs empty-schedule-tabs">
          <button
            className={activeSchedule === "current" ? "active" : ""}
            onClick={() => onScheduleChange("current")}
            type="button"
          >Current schedule <span>{currentCount}</span></button>
          <button
            className={activeSchedule === "future" ? "active" : ""}
            onClick={() => onScheduleChange("future")}
            type="button"
          >Future schedule <span>{futureCount}</span></button>
        </div>
        <span className="empty-playlist-mark">00</span>
        <h1>Playlist is empty</h1>
        <p>Add video files in Media Library before building the rundown.</p>
        <button className="primary-button" onClick={onOpenLibrary} type="button">
          Open Media Library
        </button>
      </div>
    </main>
  );
}

async function fetchHealth(): Promise<unknown> {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new Error(`Media service returned ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function mediaServerAddress(): string {
  const configuredUrl = window.gruberDesktop?.mediaApiBaseUrl;
  if (!configuredUrl) {
    return window.location.host || "127.0.0.1:4310";
  }
  try {
    return new URL(configuredUrl).host;
  } catch {
    return configuredUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** power;
  return `${value.toFixed(power > 1 ? 1 : 0)} ${units[power] ?? "B"}`;
}

function probeToAsset(probe: MediaProbe): MediaAsset {
  const fps = probe.frameRate > 0 ? `${probe.frameRate.toFixed(3)} fps` : "—";
  return {
    id: `media-${hashString(probe.filePath)}`,
    name: probe.name,
    duration: formatTimecode(probe.durationSeconds),
    durationSeconds: probe.durationSeconds,
    codec: `${probe.videoCodec}${probe.videoProfile && probe.videoProfile !== "unknown" ? ` (${probe.videoProfile})` : ""}`,
    codecFamily: probe.videoCodec.toUpperCase(),
    codecProfile: probe.videoProfile,
    resolution: `${probe.width}×${probe.height}`,
    fps,
    bitrate: probe.bitrate > 0 ? `${(probe.bitrate / 1_000_000).toFixed(1)} Mbps` : "—",
    size: formatBytes(probe.sizeBytes),
    status: "analyzed",
    progress: 100,
    preview: mediaThumbnailUrl(probe.filePath),
    filePath: probe.filePath,
    colorSpace: probe.colorSpace,
    audio: probe.hasAudio
      ? `${probe.audioCodec ?? "audio"} ${probe.audioSampleRate ?? 0} Hz ${probe.audioChannels ?? 0} ch`
      : "No audio stream",
    sha256: "ffprobe analyzed",
  };
}

async function probeSchedulePaths(
  schedule: ParsedSchedule,
): Promise<Map<string, MediaProbe | null>> {
  const paths = [...new Set(schedule.items.map((item) => item.filePath))];
  const probes = new Map<string, MediaProbe | null>();
  const concurrency = 8;
  for (let offset = 0; offset < paths.length; offset += concurrency) {
    const batch = paths.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (filePath) => {
      try {
        return (await probeMediaPaths([filePath]))[0] ?? null;
      } catch {
        return null;
      }
    }));
    batch.forEach((filePath, index) => probes.set(filePath, results[index] ?? null));
  }
  return probes;
}

function scheduleMetadata(schedule: ParsedSchedule): ScheduleMetadata {
  return {
    delaySeconds: schedule.delaySeconds,
    encoding: schedule.encoding,
    sourceFilePath: schedule.sourceFilePath,
    sourceName: schedule.sourceFilePath.split(/[\\/]/).at(-1) ?? schedule.sourceFilePath,
    startTime: schedule.startTime,
    targetDurationSeconds: schedule.targetDurationSeconds,
    warnings: schedule.warnings,
  };
}

function mergeAssets(current: MediaAsset[], incoming: MediaAsset[]): MediaAsset[] {
  const incomingByPath = new Map(incoming.map((asset) => [asset.filePath, asset]));
  const merged = current.map((asset) => incomingByPath.get(asset.filePath) ?? asset);
  const currentPaths = new Set(current.map((asset) => asset.filePath));
  return [
    ...merged,
    ...[...incomingByPath.values()].filter((asset) => !currentPaths.has(asset.filePath)),
  ];
}

function pendingAssetFromPath(filePath: string): MediaAsset {
  const name = filePath.split(/[\\/]/).at(-1) || filePath;
  return {
    id: `media-${hashString(filePath)}`,
    name,
    duration: "Analyzing…",
    durationSeconds: 0,
    codec: "Detecting…",
    codecFamily: "—",
    codecProfile: "—",
    resolution: "—",
    fps: "—",
    bitrate: "—",
    size: "—",
    status: "pending",
    progress: 0,
    preview: mediaPath("production.png"),
    filePath,
    colorSpace: "Detecting…",
    audio: "Detecting…",
    sha256: "Waiting for ffprobe",
  };
}

function buildStartRequest(
  playlist: MediaAsset[],
  settings: BroadcastSettings,
  requireStreaming = true,
): StartPlayoutRequest {
  if (playlist.length === 0) {
    throw new Error("Playlist is empty");
  }
  if (requireStreaming && !settings.streamingEnabled) {
    throw new Error("Streaming output is disabled");
  }
  const protocol = settings.protocol.toLowerCase();
  const endpoint = protocol === "udp"
    ? {
        protocol: "udp" as const,
        host: settings.udpHost,
        port: settings.udpPort,
        packetSize: settings.udpPacketSize,
        ttl: settings.udpTtl,
        localAddress: settings.udpLocalAddress,
        mpegTs: {
          serviceName: settings.udpServiceName.trim() || "FluxIO",
          serviceId: integerOrDefault(settings.udpServiceId, 1, 1, 65_535),
          providerName: settings.udpProviderName.trim() || "FluxIO",
          videoPid: integerOrDefault(settings.udpVideoPid, 256, 32, 8_190),
          audioPid: integerOrDefault(settings.udpAudioPid, 257, 32, 8_190),
          serviceType: normalizeMpegTsServiceType(settings.udpServiceType),
          pcrPeriodMs: integerOrDefault(settings.udpPcrPeriodMs, 20, 1, 1_000),
          transportBitrateKbps: settings.udpTransportBitrate > 0
            ? Math.round(settings.udpTransportBitrate * 1_000)
            : 0,
        },
      }
    : protocol === "srt"
      ? {
          protocol: "srt" as const,
          host: settings.srtHost,
          port: settings.srtPort,
          mode: normalizeSrtMode(settings.srtMode),
          latencyMs: settings.srtLatencyMs,
          passphrase: settings.srtPassphrase,
          streamId: settings.srtStreamId,
        }
      : {
          protocol: "rtmp" as const,
          serverUrl: settings.rtmpServerUrl,
          streamKey: settings.rtmpStreamKey,
        };

  return {
    playlist: playlist.map((asset) => ({
      id: asset.id,
      name: asset.name,
      filePath: asset.filePath,
      trimInSeconds: 0,
      trimOutSeconds: asset.declaredDurationSeconds ?? null,
      scte35Markers: asset.scte35Markers ?? [],
      scheduleType: asset.scheduleType ?? null,
      declaredDurationSeconds: asset.declaredDurationSeconds ?? null,
      ageTitle: asset.ageTitle?.enabled
        ? {
            durationSeconds: asset.ageTitle.durationSeconds,
            enabled: true,
            filePath: asset.ageTitle.filePath ?? null,
            text: asset.ageTitle.text,
          }
        : null,
      itemLogo: asset.itemLogo?.enabled
        ? { ...asset.itemLogo, enabled: true }
        : null,
    })),
    video: {
      codec: settings.videoCodec === "H.264"
        ? "h264"
        : settings.videoCodec === "MPEG-2 Video"
          ? "mpeg2"
          : "h265",
      width: settings.width,
      height: settings.height,
      frameRate: Number.parseFloat(settings.frameRate) || 25,
      rateControl: settings.rateControl.toLowerCase() === "cbr"
        ? "cbr"
        : settings.rateControl.toLowerCase() === "crf"
          ? "crf"
          : "vbr",
      targetBitrateKbps: Math.round(settings.targetBitrate * 1_000),
      maxBitrateKbps: Math.round(settings.maxBitrate * 1_000),
      bufferSizeKbps: settings.bufferSize,
      crf: settings.crf,
      preset: normalizePreset(settings.preset),
      profile: settings.profile,
      level: settings.level,
      deinterlace: settings.deinterlace,
      fieldOrder: normalizeFieldOrder(settings.fieldOrder),
      gopSize: Math.max(1, Math.min(600, Math.round(settings.gopSize))),
      bFrames: Math.max(0, Math.min(16, Math.round(settings.bFrames))),
      closedGop: settings.closedGop,
    },
    audio: {
      codec: settings.audioCodec === "MP2"
        ? "mp2"
        : settings.audioCodec === "AC-3"
          ? "ac3"
          : "aac",
      sampleRate: Number.parseInt(settings.sampleRate, 10) || 48_000,
      channels: settings.channels === "Mono"
        ? 1
        : settings.channels === "5.1"
          ? 6
          : 2,
      bitrateKbps: settings.audioBitrate,
    },
    logo: settings.logoEnabled && settings.logoPath
      ? {
          filePath: settings.logoPath,
          position: normalizeLogoPosition(settings.logoPosition),
          widthPercent: settings.logoWidthPercent,
          margin: settings.logoMargin,
          opacity: settings.logoOpacity,
        }
      : null,
    endpoint,
    repeatPlaylist: settings.repeatSchedule,
    scte35: {
      enabled: settings.scte35PlanningEnabled,
      command: settings.scte35Command.startsWith("splice_insert")
        ? "splice_insert"
        : "time_signal",
      owner: settings.scte35Owner === "Distributor" ? "distributor" : "provider",
      pid: Math.min(8_190, Math.max(32, Math.trunc(settings.scte35Pid))),
      preRollMs: Math.min(60_000, Math.max(0, Math.trunc(settings.scte35PreRollMs))),
      defaultEventId: Math.min(
        4_294_967_295,
        Math.max(0, Math.trunc(settings.scte35DefaultEventId)),
      ),
      defaultBreakDurationSeconds: Math.min(
        86_400,
        Math.max(1, Math.trunc(settings.scte35DefaultBreakDuration)),
      ),
      upidType: normalizeScte35UpidType(settings.scte35UpidType),
      defaultUpid: settings.scte35DefaultUpid,
      loopEventStrategy: settings.scte35LoopEventStrategy.startsWith("Reuse")
        ? "reuse"
        : "increment",
    },
  };
}

interface RecoveryPoint {
  asset: MediaAsset;
  itemIndex: number;
  itemOffsetSeconds: number;
}

function recoveryPointForPlaylist(
  playlist: MediaAsset[],
  checkpoint: WorkspaceSessionCheckpoint,
): RecoveryPoint | null {
  if (playlist.length === 0) return null;
  let itemIndex = Math.min(checkpoint.currentItemIndex, playlist.length - 1);
  let elapsedBeforeItem = playlist
    .slice(0, itemIndex)
    .reduce((total, asset) => total + effectiveAssetDuration(asset), 0);
  let itemOffsetSeconds = Math.max(0, checkpoint.outTimeSeconds - elapsedBeforeItem);
  let asset = playlist[itemIndex];
  if (!asset) return null;
  const duration = effectiveAssetDuration(asset);
  if (itemOffsetSeconds >= duration - 0.04 && itemIndex < playlist.length - 1) {
    elapsedBeforeItem += duration;
    itemIndex += 1;
    asset = playlist[itemIndex];
    if (!asset) return null;
    itemOffsetSeconds = Math.max(0, checkpoint.outTimeSeconds - elapsedBeforeItem);
  }
  return {
    asset,
    itemIndex,
    itemOffsetSeconds: Math.min(
      Math.max(0, effectiveAssetDuration(asset) - 0.04),
      itemOffsetSeconds,
    ),
  };
}

function buildRecoveryStartRequest(
  request: StartPlayoutRequest,
  playlist: MediaAsset[],
  checkpoint: WorkspaceSessionCheckpoint,
): StartPlayoutRequest {
  const point = recoveryPointForPlaylist(playlist, checkpoint);
  if (!point) throw new Error("Saved recovery checkpoint does not match the current playlist");
  const remaining = request.playlist.slice(point.itemIndex);
  const first = remaining[0];
  if (!first) throw new Error("No media remains after the saved recovery checkpoint");
  const trimInSeconds = first.trimInSeconds + point.itemOffsetSeconds;
  remaining[0] = {
    ...first,
    trimInSeconds,
    ageTitle: point.itemOffsetSeconds > 0 ? null : first.ageTitle,
    scte35Markers: first.scte35Markers.filter(
      (marker) => marker.positionSeconds >= trimInSeconds,
    ),
  };
  return { ...request, playlist: remaining };
}

function buildStartRequestFromAsset(
  request: StartPlayoutRequest,
  playlist: MediaAsset[],
  assetId: string,
): StartPlayoutRequest {
  if (!playlist.some((asset) => asset.id === assetId)) {
    throw new Error("The selected start clip is no longer present in the Current playlist");
  }
  const itemIndex = request.playlist.findIndex((item) => item.id === assetId);
  if (itemIndex < 0) {
    throw new Error("The selected start clip could not be mapped to the playout request");
  }
  const remaining = request.playlist.slice(itemIndex);
  if (remaining.length === 0) throw new Error("No media remains after the selected start clip");
  return { ...request, playlist: remaining };
}

function effectiveAssetDuration(asset: MediaAsset): number {
  return Math.max(
    0,
    Math.min(asset.declaredDurationSeconds ?? asset.durationSeconds, asset.durationSeconds),
  );
}

function primitiveSettings(
  settings: BroadcastSettings,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(settings).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1])
    ),
  );
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remaining = whole % 60;
  return [hours, minutes, remaining]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function integerOrDefault(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value === 0) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function normalizeFieldOrder(
  value: string,
): StartPlayoutRequest["video"]["fieldOrder"] {
  if (value === "upper" || value === "lower") return value;
  return "progressive";
}

function normalizeMpegTsServiceType(
  value: string,
): Extract<StartPlayoutRequest["endpoint"], { protocol: "udp" }>["mpegTs"]["serviceType"] {
  const supported = new Set([
    "digital_tv",
    "digital_radio",
    "teletext",
    "advanced_codec_digital_radio",
    "mpeg2_digital_hdtv",
    "advanced_codec_digital_sdtv",
    "advanced_codec_digital_hdtv",
    "hevc_digital_hdtv",
  ]);
  return supported.has(value)
    ? value as Extract<StartPlayoutRequest["endpoint"], { protocol: "udp" }>["mpegTs"]["serviceType"]
    : "digital_tv";
}

function normalizeScte35UpidType(
  value: string,
): StartPlayoutRequest["scte35"]["upidType"] {
  if (value === "UUID") return "uuid";
  if (value === "URI") return "uri";
  if (value === "None") return "none";
  return "ad-id";
}

function normalizePreset(value: number): StartPlayoutRequest["video"]["preset"] {
  if (value < 12) return "ultrafast";
  if (value < 24) return "veryfast";
  if (value < 40) return "fast";
  if (value < 58) return "medium";
  if (value < 76) return "slow";
  if (value < 90) return "slower";
  return "veryslow";
}

function normalizeSrtMode(value: string): "caller" | "listener" | "rendezvous" {
  const normalized = value.toLowerCase();
  return normalized === "listener" || normalized === "rendezvous"
    ? normalized
    : "caller";
}

function normalizeLogoPosition(
  value: string,
): "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" {
  return ["top-left", "top-right", "bottom-left", "bottom-right", "center"].includes(value)
    ? value as "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
    : "top-right";
}

function formatTimecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remaining = whole % 60;
  return [hours, minutes, remaining, 0]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function ageRatingFromFileName(fileName: string): string | null {
  const match = fileName.match(/\[(0|6|12|16|18)\+\](?=\.[^.]+$|$)/i);
  return match?.[1] ? `${match[1]}+` : null;
}

function mapAgeAssetPaths(imagePaths: string[]): Map<string, string> {
  const assets = new Map<string, string>();
  for (const imagePath of imagePaths) {
    const fileName = imagePath.split(/[\\/]/).at(-1) ?? imagePath;
    const match = fileName.match(/(?:^|[^0-9])(0|6|12|16|18)\+(?:[^0-9]|$)/i);
    if (match?.[1] && !assets.has(`${match[1]}+`)) {
      assets.set(`${match[1]}+`, imagePath);
    }
  }
  return assets;
}

function assignAgeAssets(
  playlist: MediaAsset[],
  ageAssets: Map<string, string>,
): MediaAsset[] {
  return playlist.map((asset) => {
    const text = asset.ageTitle?.text ?? ageRatingFromFileName(asset.name);
    if (!text) return asset;
    return {
      ...asset,
      ageTitle: {
        durationSeconds: asset.ageTitle?.durationSeconds ?? 5,
        enabled: asset.ageTitle?.enabled ?? true,
        filePath: ageAssets.get(text) ?? asset.ageTitle?.filePath ?? null,
        text,
      },
    };
  });
}

function preferredLogoPath(imagePaths: string[]): string | null {
  return imagePaths.find((imagePath) => {
    const fileName = imagePath.split(/[\\/]/).at(-1) ?? imagePath;
    return /^(?:logo|channel|brand)(?:[-_. ].*)?\.(?:png|webp|jpe?g)$/i.test(fileName);
  }) ?? imagePaths[0] ?? null;
}

function inferScheduleType(seconds: number): "movie" | "chop" | "clip" {
  if (seconds < 30) return "chop";
  if (seconds > 300) return "movie";
  return "clip";
}

function downloadSchedule(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
