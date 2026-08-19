import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  graphicEffectAssetSchema,
  serviceHealthSchema,
  type BroadcastEffectKind,
  type FfmpegCapabilities,
  type GraphicEffectAsset,
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
} from "./demo-data";
import { initialBroadcastSettings } from "./default-broadcast-settings";
import {
  applyEncodingSettingsProfile,
  createEncodingSettingsProfile,
  parseEncodingSettingsProfile,
  serializeEncodingSettingsProfile,
} from "./encoding-settings-profile";
import { BroadcastSettingsScreen } from "./screens/BroadcastSettingsScreen";
import { ImportAnalyzeScreen } from "./screens/ImportAnalyzeScreen";
import { PlaylistPreviewScreen } from "./screens/PlaylistPreviewScreen";
import { EffectsScreen } from "./screens/EffectsScreen";
import { matchingNamedAssetPath } from "./graphic-title-matching";
import { MissingGraphicsDialog } from "./components/MissingGraphicsDialog";
import { airDurationSeconds } from "./clip-duration";
import { useStableCallback } from "./stable-callback";
import {
  applyGraphicReplacements,
  collectMissingGraphics,
  dropMissingGraphics,
  graphicPathsOf,
  type MissingGraphic,
} from "./missing-graphics";
import {
  applyBroadcastPlan,
  planBroadcastEffect,
  removeBroadcastEffect,
  type BroadcastTargetClip,
  type BroadcastTaskEntry,
} from "./broadcast-effects";
import {
  broadcastEffectTitle,
  type BroadcastTaskSummary,
} from "./screens/BroadcastEffectInspector";
import {
  appendLottieEffectInstances,
  assignEffectToAssets,
  lottieTextValues,
} from "./effect-assignment";
import { buildAudioProgram } from "./audio-program";
import type { AudioTrackLibrary } from "./types";
import { mediaPath } from "./runtime";
import {
  getFfmpegCapabilities,
  analyzeGraphicEffectPaths,
  getNetworkInterfaces,
  getPlayoutStatus,
  getSystemMetrics,
  getWorkspaceSession,
  mediaThumbnailUrl,
  parseScheduleFile,
  probeMediaPaths,
  renderLottieEffect,
  scanMediaDirectory,
  scanAudioTracks,
  readBroadcastTaskFile,
  readTickerFeed,
  readTickerSourceFile,
  verifyGraphicEffectPaths,
  scanGraphicEffectDirectory,
  serializeScheduleFile,
  saveWorkspaceSession as persistWorkspaceSession,
  deleteWorkspaceSession as deletePersistedWorkspaceSession,
  startCompositeClipPreview as startCompositeClipPreviewSession,
  startPlayout as startPlayoutSession,
  stopPlayout as stopPlayoutSession,
  takePlayout as takePlayoutSession,
  updateCurrentPlayoutPlaylist,
  updateNextPlayoutPlaylist,
} from "./media-api";
import type {
  AppView,
  BroadcastSettings,
  MediaAsset,
  ScheduleMetadata,
  ScheduleOverlayLibrary,
  ScheduleSlot,
  Scte35Marker,
  SubtitleLibrary,
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
  const [effectLibrary, setEffectLibrary] = useState<GraphicEffectAsset[]>([]);
  const [subtitleLibrary, setSubtitleLibrary] = useState<SubtitleLibrary | null>(null);
  const [audioTrackLibrary, setAudioTrackLibrary] = useState<AudioTrackLibrary | null>(null);
  const [effectsBusy, setEffectsBusy] = useState(false);
  // Записи файлов заданий держим в памяти: сам путь живёт в настройках эффекта
  // и переживает перезапуск, а содержимое перечитывается по кнопке.
  const [broadcastTaskEntries, setBroadcastTaskEntries] =
    useState<Record<string, BroadcastTaskEntry[]>>({});
  const [broadcastTaskSummaries, setBroadcastTaskSummaries] =
    useState<Record<string, BroadcastTaskSummary>>({});
  const [missingGraphics, setMissingGraphics] = useState<MissingGraphic[]>([]);
  const [missingGraphicsResolved, setMissingGraphicsResolved] =
    useState<Record<string, string>>({});

  const stableAddEffectToClip = useStableCallback((...args: [string, string]) =>
    addEffectToClip(...args));
  const stableAddEffectToProject = useStableCallback((id: string) => addEffectToProject(id));
  const stableClearTitleDirectory = useStableCallback((id: string) => clearEffectTitleDirectory(id));
  const stableRemoveEffect = useStableCallback((id: string) => removeEffect(id));
  const stableRenderProjectLottie = useStableCallback((effect: GraphicEffectAsset) =>
    renderProjectLottie(effect));
  const stableSelectEffectDirectory = useStableCallback(() => selectEffectDirectory());
  const stableSelectEffectFiles = useStableCallback(() => selectEffectFiles());
  const stableSelectTitleDirectory = useStableCallback((id: string) =>
    selectEffectTitleDirectory(id));
  const stableChangeBroadcastEffect = useStableCallback((effect: GraphicEffectAsset) =>
    changeBroadcastEffect(effect));
  const stableCreateBroadcastEffect = useStableCallback((kind: BroadcastEffectKind) =>
    createBroadcastEffect(kind));
  const stableSelectBroadcastTaskFile = useStableCallback((id: string) =>
    selectBroadcastTaskFile(id));
  const stableSelectStingerFile = useStableCallback((id: string) => selectStingerFile(id));
  const stableSelectTickerSourceFile = useStableCallback((id: string) =>
    selectTickerSourceFile(id));
  const stableLoadTickerFeed = useStableCallback((id: string) => loadTickerFeed(id));
  const stableApplyBroadcastChanges = useStableCallback((id: string) => applyBroadcastChanges(id));
  const stableImportBroadcastPreset = useStableCallback((id: string) => importBroadcastPreset(id));

  const playoutActive = Boolean(
    playoutStatus && ["starting", "running", "stopping"].includes(playoutStatus.state),
  );
  /**
   * Сколько роликов несёт каждый эффект. Именно значение, а не функция: экран
   * эффектов обёрнут в `memo`, и стабильная функция не заставила бы его
   * пересчитаться после назначения — кнопка Save осталась бы неактивной.
   */
  const staleServiceVersion = connection.kind === "ready" &&
    connection.health.version !== applicationVersion
    ? connection.health.version
    : null;

  const assignedClipCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of [...playlist, ...futurePlaylist]) {
      const ids = new Set([
        ...(asset.effects ?? []).map((layer) => layer.effectId),
        ...(asset.textOverlays ?? []).map((overlay) => overlay.effectId),
      ]);
      for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [playlist, futurePlaylist]);

  // Стабильная ссылка: во время эфира статус опрашивается каждые 750 мс, и
  // заново собранный здесь массив перерисовывал бы всю вкладку Effects.
  const effectTargetClips = useMemo(() => [
    ...playlist.map((asset) => ({ id: asset.id, name: asset.name, schedule: "Current" as const })),
    ...futurePlaylist.map((asset) => ({ id: asset.id, name: asset.name, schedule: "Future" as const })),
  ], [playlist, futurePlaylist]);
  const [effectsMessage, setEffectsMessage] = useState<string | null>(null);
  const [scheduleActionMessage, setScheduleActionMessage] = useState<string | null>(null);
  const [savedWorkspaceSession, setSavedWorkspaceSession] = useState<SavedWorkspaceSession | null>(null);
  const [recoveryCheckpoint, setRecoveryCheckpoint] = useState<WorkspaceSessionCheckpoint | null>(null);
  const [scheduleStartMarker, setScheduleStartMarker] = useState<ScheduleStartMarker | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceAutosaveReady, setWorkspaceAutosaveReady] = useState(false);
  const [takeBusy, setTakeBusy] = useState(false);
  const [settingsProfileBusy, setSettingsProfileBusy] = useState(false);
  const [settingsProfileMessage, setSettingsProfileMessage] = useState<string | null>(null);
  const workspaceRestoreStarted = useRef(false);
  const workspaceAutosaveChain = useRef<Promise<void>>(Promise.resolve());
  const currentPlaylistSyncChain = useRef<Promise<void>>(Promise.resolve());
  const schedulePromotionHandled = useRef("");
  const currentPlaylistSync = useRef({ sessionId: "", snapshot: "" });

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    async function loadHealth() {
      if (requestInFlight) return;
      requestInFlight = true;
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
      } finally {
        requestInFlight = false;
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
    let pollInFlight = false;

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

    pollInFlight = true;
    void refresh().finally(() => {
      pollInFlight = false;
    });
    const timer = window.setInterval(() => {
      if (pollInFlight) return;
      pollInFlight = true;
      void Promise.all([getPlayoutStatus(), getSystemMetrics()])
        .then(([status, metrics]) => {
          if (!cancelled) {
            setPlayoutStatus(status);
            setSystemMetrics(metrics);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          pollInFlight = false;
        });
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
      })
      .finally(() => {
        if (!cancelled) setWorkspaceAutosaveReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connection.kind, connection.kind === "ready" ? connection.health.status : null]);

  useEffect(() => {
    if (
      !workspaceAutosaveReady ||
      demoDataEnabled ||
      (playlist.length === 0 && futurePlaylist.length === 0)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const request = buildWorkspaceSaveRequest();
      workspaceAutosaveChain.current = workspaceAutosaveChain.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await persistWorkspaceSession(request);
          setSavedWorkspaceSession(saved);
          setRecoveryCheckpoint(saved.checkpoint?.interrupted ? saved.checkpoint : null);
        })
        .catch((error) => {
          setOperationError(`Workspace autosave failed: ${errorMessage(error)}`);
        });
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [
    workspaceAutosaveReady,
    assets,
    playlist,
    futurePlaylist,
    activeSchedule,
    selectedAssetId,
    currentScheduleMetadata,
    futureScheduleMetadata,
    scheduleLogoPath,
    scheduleLogoSource,
    ageLibrary,
    effectLibrary,
    subtitleLibrary,
    scheduleStartMarker,
    settings,
  ]);

  useEffect(() => {
    if (
      !workspaceAutosaveReady ||
      !playoutStatus?.sessionId ||
      playoutStatus.schedulePhase !== "future" ||
      playoutStatus.scheduleTransitionCount < 1
    ) {
      return;
    }
    const transitionKey = `${playoutStatus.sessionId}:${playoutStatus.scheduleTransitionCount}`;
    if (schedulePromotionHandled.current === transitionKey) return;
    schedulePromotionHandled.current = transitionKey;
    if (futurePlaylist.length === 0) return;

    const promoted = futurePlaylist;
    setPlaylist(promoted);
    setFuturePlaylist([]);
    setCurrentScheduleMetadata(futureScheduleMetadata);
    setFutureScheduleMetadata(null);
    setActiveSchedule("current");
    setSelectedAssetId(promoted[0]?.id ?? "");
    setScheduleStartMarker(null);
    setRecoveryCheckpoint(null);
    setScheduleActionMessage(
      `Future schedule promoted to Current automatically; Future is ready for the next 168-hour schedule.`,
    );
  }, [
    workspaceAutosaveReady,
    playoutStatus?.sessionId,
    playoutStatus?.schedulePhase,
    playoutStatus?.scheduleTransitionCount,
    futurePlaylist,
    futureScheduleMetadata,
  ]);

  useEffect(() => {
    if (
      !playoutStatus?.sessionId ||
      playoutStatus.schedulePhase !== "current" ||
      !["starting", "running"].includes(playoutStatus.state)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void updateNextPlayoutPlaylist(buildPlayoutItems(futurePlaylist))
        .then(setPlayoutStatus)
        .catch((error) => setOperationError(
          `Future schedule sync failed: ${errorMessage(error)}`,
        ));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    futurePlaylist,
    playoutStatus?.sessionId,
    playoutStatus?.schedulePhase,
    playoutStatus?.state,
  ]);

  useEffect(() => {
    if (
      !playoutStatus?.sessionId ||
      playoutStatus.schedulePhase !== "current" ||
      !["starting", "running"].includes(playoutStatus.state)
    ) {
      return;
    }
    const snapshot = JSON.stringify(buildPlayoutItems(playlist));
    if (currentPlaylistSync.current.sessionId !== playoutStatus.sessionId) {
      currentPlaylistSync.current = { sessionId: playoutStatus.sessionId, snapshot };
      return;
    }
    if (currentPlaylistSync.current.snapshot === snapshot) return;
    const timer = window.setTimeout(() => {
      const sessionId = playoutStatus.sessionId!;
      const nextPlaylist = buildPlayoutItems(playlist);
      currentPlaylistSyncChain.current = currentPlaylistSyncChain.current
        .catch(() => undefined)
        .then(async () => {
          if (currentPlaylistSync.current.sessionId !== sessionId) return;
          const status = await updateCurrentPlayoutPlaylist(nextPlaylist);
          currentPlaylistSync.current = { sessionId: status.sessionId ?? "", snapshot };
          setPlayoutStatus(status);
          setOperationError(null);
          setScheduleActionMessage(
            `HOT CHANGE applied: upcoming clips will use the latest LOGO, AGE, FX and SRT settings.`,
          );
        })
        .catch((error) => setOperationError(
          `On-air schedule sync failed: ${errorMessage(error)}`,
        ));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    playlist,
    playoutStatus?.sessionId,
    playoutStatus?.schedulePhase,
    playoutStatus?.state,
  ]);

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
    const restoredSettings = {
      ...initialBroadcastSettings,
      ...snapshot.settings,
    } as BroadcastSettings;
    // Before 6.0.10 the saved default used a 1400 ms legacy compensation.
    // v6.0.12 aligns FFmpeg and GStreamer on one MPEG-TS clock, so carrying
    // that old value would add an unwanted constant subtitle delay.
    if (snapshot.settings.subtitlePtsOffsetMs === 1_400) {
      restoredSettings.subtitlePtsOffsetMs = 0;
    }
    const hasPlaylistLogoAssignments = [...snapshot.currentPlaylist, ...snapshot.futurePlaylist]
      .some((asset) => Boolean(asset.itemLogo));
    const restoredAgeAssets = mapAgeAssetPaths(snapshot.ageLibrary?.imagePaths ?? []);
    const restoreLegacyLogo = (items: MediaAsset[]) => (
      !hasPlaylistLogoAssignments && restoredSettings.logoEnabled && restoredSettings.logoPath
        ? assignChannelLogo(items, restoredSettings.logoPath, restoredSettings)
        : items
    );
    const restoredCurrentPlaylist = restoreLegacyLogo(assignAgeAssets(
      snapshot.currentPlaylist,
      restoredAgeAssets,
      restoredSettings.ageTitleDurationSeconds,
    ));
    const restoredFuturePlaylist = restoreLegacyLogo(assignAgeAssets(
      snapshot.futurePlaylist,
      restoredAgeAssets,
      restoredSettings.ageTitleDurationSeconds,
    ));
    const restoredAssets = snapshot.assets.length > 0
      ? snapshot.assets
      : mergeAssets([], [...restoredCurrentPlaylist, ...restoredFuturePlaylist]);
    const checkpointSelection = session.checkpoint && (
      session.checkpoint.interrupted ||
      ["starting", "running", "stopping"].includes(session.checkpoint.state)
    )
      ? recoveryPointForPlaylist(restoredCurrentPlaylist, session.checkpoint)
      : null;
    setAssets(restoredAssets);
    setPlaylist(restoredCurrentPlaylist);
    setFuturePlaylist(restoredFuturePlaylist);
    setCurrentScheduleMetadata(snapshot.currentScheduleMetadata);
    setFutureScheduleMetadata(snapshot.futureScheduleMetadata);
    setScheduleLogoPath(
      snapshot.scheduleLogoPath || (restoredSettings.logoEnabled ? restoredSettings.logoPath : ""),
    );
    setScheduleLogoSource(
      snapshot.scheduleLogoSource || (restoredSettings.logoEnabled ? restoredSettings.logoPath : ""),
    );
    setAgeLibrary(snapshot.ageLibrary);
    setEffectLibrary(snapshot.effectLibrary);
    setSubtitleLibrary(snapshot.subtitleLibrary);
    setScheduleStartMarker(
      snapshot.startMarker && restoredCurrentPlaylist.some(
        (asset) => asset.id === snapshot.startMarker?.assetId,
      )
        ? snapshot.startMarker
        : null,
    );
    setSettings(restoredSettings);
    setActiveSchedule(checkpointSelection ? "current" : snapshot.activeSchedule);
    setSelectedAssetId(
      checkpointSelection?.asset.id ??
      snapshot.selectedAssetId ??
      restoredCurrentPlaylist[0]?.id ??
      restoredFuturePlaylist[0]?.id ??
      "",
    );
    setSavedWorkspaceSession(session);
    setRecoveryCheckpoint(session.checkpoint?.interrupted ? session.checkpoint : null);
    void restoreLottieEffectCache(snapshot.effectLibrary);
    void checkMissingGraphics(
      [restoredCurrentPlaylist, restoredFuturePlaylist],
      snapshot.effectLibrary,
    );
    setScheduleActionMessage(
      session.checkpoint?.interrupted
        ? `Interrupted session restored at ${formatClock(session.checkpoint.outTimeSeconds)}.`
        : checkpointSelection && session.checkpoint
          ? `Active playout reattached at ${formatClock(session.checkpoint.outTimeSeconds)}.`
          : `Session restored from ${new Date(session.updatedAt).toLocaleString()}.`,
    );
    if (restoredCurrentPlaylist.length > 0 || restoredFuturePlaylist.length > 0) {
      setView("playlist");
    }
  }

  const addFiles = useCallback((files: File[], slot: ScheduleSlot = "current") => {
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
        void analyzePaths(paths, slot);
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
    if (slot === "current") setPlaylist((current) => [...current, ...imported]);
    else setFuturePlaylist((current) => [...current, ...imported]);
  }, []);

  async function addNativeFiles(slot: ScheduleSlot = "current") {
    const paths = await window.gruberDesktop?.selectMediaFiles();
    if (paths?.length) {
      await analyzePaths(paths, slot);
    }
  }

  async function addNativeDirectory(slot: ScheduleSlot = "current") {
    const directoryPath = await window.gruberDesktop?.selectMediaDirectory();
    if (!directoryPath) {
      return;
    }
    setMediaBusy(true);
    setOperationError(null);
    try {
      addProbes(await scanMediaDirectory(directoryPath), slot);
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
                durationSeconds: clampAgeDuration(
                  item.ageTitleDurationSeconds ?? settings.ageTitleDurationSeconds,
                ),
                enabled: true,
                filePath: ageAssets.get(ageText) ?? null,
                text: ageText,
              }
            : undefined,
          itemLogo: logoPath
            ? {
                enabled: true,
                filePath: logoPath,
                margin: settings.logoMargin,
                opacity: settings.logoOpacity,
                position: normalizeLogoPosition(settings.logoPosition),
                widthPercent: settings.logoWidthPercent,
              }
            : undefined,
          effects: item.graphicElements.map((element, effectIndex) => {
            const filePath = element.backgroundPath ?? element.titlePath ?? "";
            const libraryEffect = effectLibrary.find((effect) =>
              normalizeComparablePath(effect.filePath) === normalizeComparablePath(filePath) ||
              effect.name.toLocaleLowerCase() === element.name.toLocaleLowerCase()
            );
            const startSeconds = Math.min(
              element.startOnSeconds,
              Math.max(0, item.declaredDurationSeconds - 0.01),
            );
            const endSeconds = Math.min(
              item.declaredDurationSeconds,
              startSeconds + element.durationSeconds,
            );
            return {
              backgroundPath: element.backgroundPath,
              blendMode: "alpha" as const,
              lumaThreshold: 0.08,
              sourceInSeconds: 0,
              tier: 3 as const,
              effectId: libraryEffect?.id ?? `schedule-fx-${hashString(filePath || element.name)}`,
              endSeconds: Math.max(startSeconds + 0.01, endSeconds),
              filePath,
              id: `schedule-fx-${index}-${effectIndex}-${hashString(filePath || element.name)}`,
              kind: libraryEffect?.kind ?? inferGraphicKind(filePath),
              name: element.name,
              sourceDurationSeconds: libraryEffect?.durationSeconds ?? element.durationSeconds,
              startSeconds,
              titlePath: element.titlePath,
              titlePaths: element.titlePaths,
            };
          }),
          subtitles: item.srtPath
            ? { enabled: true, filePath: item.srtPath }
            : undefined,
        } satisfies MediaAsset;
      });
      const metadata = scheduleMetadata(parsed, slot);
      const importedEffects = scheduledAssets.flatMap((asset) =>
        (asset.effects ?? []).map((layer) => ({
          durationSeconds: layer.kind === "video" ? layer.sourceDurationSeconds : 0,
          filePath: layer.filePath,
          height: 0,
          id: layer.effectId,
          kind: layer.kind,
          name: layer.name,
          titleDirectoryPath: layer.titlePath ? parentDirectory(layer.titlePath) : null,
          titlePaths: layer.titlePath ? [layer.titlePath] : [],
          width: 0,
          lottie: null,
          broadcast: null,
        } satisfies GraphicEffectAsset))
      );
      setAssets((current) => mergeAssets(current, scheduledAssets));
      setEffectLibrary((current) => mergeEffectAssets(current, importedEffects));
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
      // Чужое расписание почти всегда приносит пути с другой машины: сразу
      // показываем, какой графики здесь нет, вместо отказа на Start.
      void checkMissingGraphics(
        [scheduledAssets],
        mergeEffectAssets(effectLibrary, importedEffects),
      );
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
    const ageAssigned = assignAgeAssets(
      probes.map(probeToAsset),
      mapAgeAssetPaths(ageLibrary?.imagePaths ?? []),
      settings.ageTitleDurationSeconds,
    );
    const imported = settings.logoEnabled && settings.logoPath
      ? assignChannelLogo(ageAssigned, settings.logoPath, settings)
      : ageAssigned;
    setAssets((current) => mergeAssets(current, imported));
    if (slot === "current") setPlaylist((current) => mergeAssets(current, imported));
    else setFuturePlaylist((current) => mergeAssets(current, imported));
    setSelectedAssetId((current) => current || imported[0]?.id || "");
  }

  function movePlaylistItems(sourceIds: string[], targetId: string) {
    updateActivePlaylist((current) => {
      const sourceSet = new Set(sourceIds);
      if (sourceSet.has(targetId)) return current;
      const moving = current.filter((item) => sourceSet.has(item.id));
      if (moving.length === 0) return current;
      const remaining = current.filter((item) => !sourceSet.has(item.id));
      const targetIndex = remaining.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return current;
      remaining.splice(targetIndex, 0, ...moving);
      return remaining;
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
    setSettings((current) => ({ ...current, logoEnabled: false, logoPath: "" }));
    setAgeLibrary(null);
    setEffectLibrary([]);
    setSubtitleLibrary(null);
    setEffectsMessage(null);
    setScheduleStartMarker(null);
    setScheduleActionMessage(null);
    setSelectedAssetId("");
  }

  function clearActiveImport() {
    const retainedPlaylist = activeSchedule === "current" ? futurePlaylist : playlist;
    const retainedPaths = new Set(retainedPlaylist.map((asset) => asset.filePath));
    setAssets((current) => current.filter((asset) => retainedPaths.has(asset.filePath)));
    if (activeSchedule === "current") {
      setPlaylist([]);
      setCurrentScheduleMetadata(null);
      setScheduleStartMarker(null);
    } else {
      setFuturePlaylist([]);
      setFutureScheduleMetadata(null);
    }
    setSelectedAssetId(retainedPlaylist[0]?.id ?? "");
    setScheduleActionMessage(
      `${activeSchedule === "current" ? "Current" : "Future"} import cleared.`,
    );
  }

  async function saveSessionList() {
    if (playlist.length === 0 && futurePlaylist.length === 0) {
      setOperationError("Add media to Current or Future before saving a session list.");
      return;
    }
    setWorkspaceBusy(true);
    setOperationError(null);
    try {
      const saved = await persistWorkspaceSession(buildWorkspaceSaveRequest());
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

  function buildWorkspaceSaveRequest(): WorkspaceSessionSaveRequest {
    return {
      snapshot: {
        version: 2,
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
        effectLibrary,
        subtitleLibrary,
        startMarker: scheduleStartMarker,
        settings: primitiveSettings(settings),
      },
    };
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
    addFiles(files, activeSchedule);
  }

  async function addNativeFilesToActiveSchedule() {
    const paths = await window.gruberDesktop?.selectMediaFiles();
    if (paths?.length) await analyzePaths(paths, activeSchedule);
  }

  async function selectEffectFiles() {
    const paths = await window.gruberDesktop?.selectEffectFiles();
    if (!paths?.length) return;
    await importEffects(() => analyzeGraphicEffectPaths(paths));
  }

  async function selectEffectDirectory() {
    const directoryPath = await window.gruberDesktop?.selectEffectDirectory();
    if (!directoryPath) return;
    await importEffects(() => scanGraphicEffectDirectory(directoryPath));
  }

  async function selectEffectTitleDirectory(effectId: string) {
    const selection = await window.gruberDesktop?.selectEffectTitleDirectory();
    if (!selection) return;
    setEffectLibrary((current) => current.map((effect) =>
      effect.id === effectId
        ? {
            ...effect,
            titleDirectoryPath: selection.directoryPath,
            titlePaths: selection.filePaths,
          }
        : effect
    ));
    setPlaylist((current) => assignEffectTitles(current, effectId, selection.filePaths));
    setFuturePlaylist((current) => assignEffectTitles(current, effectId, selection.filePaths));
    setEffectsMessage(
      `Title folder assigned: ${selection.filePaths.length} alpha file(s), matched by exact clip basename.`,
    );
  }

  function clearEffectTitleDirectory(effectId: string) {
    setEffectLibrary((current) => current.map((effect) =>
      effect.id === effectId
        ? { ...effect, titleDirectoryPath: null, titlePaths: [] }
        : effect
    ));
    setPlaylist((current) => assignEffectTitles(current, effectId, []));
    setFuturePlaylist((current) => assignEffectTitles(current, effectId, []));
    setEffectsMessage("Per-clip title folder cleared; the shared BG remains assigned.");
  }

  async function importEffects(load: () => Promise<GraphicEffectAsset[]>) {
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const imported = await load();
      setEffectLibrary((current) => appendLottieEffectInstances(
        mergeEffectAssets(current, imported.filter((effect) => !effect.lottie)),
        imported.filter((effect) => Boolean(effect.lottie)),
      ));
      setEffectsMessage(`${imported.length} effect(s) analyzed and added to this project.`);
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setEffectsBusy(false);
    }
  }

  async function renderProjectLottie(effect: GraphicEffectAsset): Promise<GraphicEffectAsset> {
    if (!effect.lottie) throw new Error("The selected effect is not a Lottie project.");
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const rendered = await renderLottieEffect(effect);
      setEffectLibrary((current) => mergeEffectAssets(current, [rendered]));
      const updateAssignments = (items: MediaAsset[]) => items.map((asset) => ({
        ...asset,
        effects: asset.effects?.map((layer) => layer.effectId === rendered.id
          ? {
              ...layer,
              backgroundPath: rendered.filePath,
              filePath: rendered.filePath,
              kind: rendered.kind,
              sourceDurationSeconds: rendered.durationSeconds,
              titlePaths: lottieTextValues(rendered),
            }
          : layer),
      }));
      setPlaylist(updateAssignments);
      setFuturePlaylist(updateAssignments);
      setEffectsMessage(
        `${rendered.name} rendered with ${rendered.lottie?.properties.filter((property) => property.overridden).length ?? 0} operator override(s).`,
      );
      return rendered;
    } catch (error) {
      setOperationError(errorMessage(error));
      throw error;
    } finally {
      setEffectsBusy(false);
    }
  }

  async function restoreLottieEffectCache(effects: GraphicEffectAsset[]) {
    const lottieEffects = effects.filter((effect) => Boolean(effect.lottie));
    if (lottieEffects.length === 0) return;
    setEffectsBusy(true);
    try {
      const renderedEffects: GraphicEffectAsset[] = [];
      for (const effect of lottieEffects) {
        renderedEffects.push(await renderLottieEffect(effect));
      }
      const renderedById = new Map(renderedEffects.map((effect) => [effect.id, effect]));
      setEffectLibrary((current) => mergeEffectAssets(current, renderedEffects));
      const refreshLayers = (items: MediaAsset[]) => items.map((asset) => ({
        ...asset,
        effects: asset.effects?.map((layer) => {
          const rendered = renderedById.get(layer.effectId);
          return rendered
            ? {
                ...layer,
                backgroundPath: rendered.filePath,
                filePath: rendered.filePath,
                kind: rendered.kind,
                sourceDurationSeconds: rendered.durationSeconds,
                titlePaths: lottieTextValues(rendered),
              }
            : layer;
        }),
      }));
      setPlaylist(refreshLayers);
      setFuturePlaylist(refreshLayers);
      setEffectsMessage(`${renderedEffects.length} Lottie render cache item(s) restored.`);
    } catch (error) {
      setOperationError(`Lottie cache recovery failed: ${errorMessage(error)}`);
    } finally {
      setEffectsBusy(false);
    }
  }

  function addEffectToProject(effectId: string) {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    if (!effect) return;
    if (effect.broadcast) {
      void applyBroadcastEffect(effect, null);
      return;
    }
    const currentResult = assignEffectToAssets(playlist, effect);
    const futureResult = assignEffectToAssets(futurePlaylist, effect);
    setPlaylist(currentResult.items);
    setFuturePlaylist(futureResult.items);
    const count = currentResult.added + futureResult.added;
    setEffectsMessage(
      `${effect.name}: a new FX instance was added to ${count} clip(s). ` +
        "Set each instance IN/OUT in Playlist → Timeline Trimming.",
    );
  }

  function addEffectToClip(effectId: string, clipId: string) {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    if (!effect) return;
    if (effect.broadcast) {
      void applyBroadcastEffect(effect, new Set([clipId]));
      return;
    }
    const targetIds = new Set([clipId]);
    const currentResult = assignEffectToAssets(playlist, effect, targetIds);
    const futureResult = assignEffectToAssets(futurePlaylist, effect, targetIds);
    setPlaylist(currentResult.items);
    setFuturePlaylist(futureResult.items);
    const count = currentResult.added + futureResult.added;
    setEffectsMessage(
      count > 0
        ? `${effect.name}: a new independent FX instance was added to the selected clip. ` +
          "Set its IN/OUT in Playlist → Timeline Trimming."
        : "The selected clip is no longer available.",
    );
  }

  /* ------------------------------------------------------------------ *
   * Эфирные эффекты второго уровня
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * Потерянная графика расписания
   * ------------------------------------------------------------------ */

  /**
   * Расписание хранит абсолютные пути, а не сами файлы. После перезапуска или
   * переноса проекта на другую машину графика может исчезнуть — тогда эфир
   * падает уже на старте. Проверяем сразу после загрузки и показываем список.
   */
  async function checkMissingGraphics(
    playlists: MediaAsset[][],
    library: GraphicEffectAsset[],
  ) {
    const paths = graphicPathsOf(playlists);
    if (paths.length === 0) return;
    try {
      const missingPaths = new Set(await verifyGraphicEffectPaths(paths));
      const missing = collectMissingGraphics(playlists, library, missingPaths);
      if (missing.length === 0) return;
      setMissingGraphics(missing);
      setMissingGraphicsResolved({});
    } catch (error) {
      setOperationError(`Не удалось проверить графику расписания: ${errorMessage(error)}`);
    }
  }

  /** Оператор указал файл замены: анализируем его и подставляем во все ролики. */
  async function locateMissingGraphic(filePath: string) {
    const paths = await window.gruberDesktop?.selectEffectFiles();
    const selected = paths?.[0];
    if (!selected) return;
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const [replacement] = await analyzeGraphicEffectPaths([selected]);
      if (!replacement) throw new Error("Файл не удалось разобрать как эффект");
      const map = new Map([[filePath, replacement]]);
      setEffectLibrary((current) => mergeEffectAssets(current, [replacement]));
      setPlaylist((current) => applyGraphicReplacements(current, map).items);
      setFuturePlaylist((current) => applyGraphicReplacements(current, map).items);
      setMissingGraphicsResolved((current) => ({ ...current, [filePath]: replacement.filePath }));
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setEffectsBusy(false);
    }
  }

  /** Замены не нашлось — снимаем такие слои с роликов, чтобы эфир мог стартовать. */
  function dropUnresolvedGraphics() {
    const unresolved = new Set(
      missingGraphics
        .filter((item) => !missingGraphicsResolved[item.filePath])
        .map((item) => item.filePath),
    );
    if (unresolved.size === 0) return;
    setPlaylist((current) => dropMissingGraphics(current, unresolved));
    setFuturePlaylist((current) => dropMissingGraphics(current, unresolved));
    setMissingGraphics([]);
    setMissingGraphicsResolved({});
    setScheduleActionMessage(
      `${unresolved.size} потерянных элемент(ов) графики сняты с роликов.`,
    );
  }

  function createBroadcastEffect(kind: BroadcastEffectKind) {
    const title = broadcastEffectTitle(kind);
    const existing = effectLibrary.filter((effect) => effect.broadcast?.kind === kind).length;
    const effect = graphicEffectAssetSchema.parse({
      broadcast: { kind },
      durationSeconds: 0,
      filePath: `broadcast://${kind}`,
      height: 0,
      id: `fx2-${kind}-${window.crypto.randomUUID()}`,
      kind: "video",
      name: existing === 0 ? title : `${title} (${existing + 1})`,
      width: 0,
    });
    setEffectLibrary((current) => [...current, effect]);
    setEffectsMessage(
      `${effect.name}: эффект второго уровня создан. Выберите пресет и настройки, ` +
        "затем примените его к проекту или ролику.",
    );
  }

  function changeBroadcastEffect(effect: GraphicEffectAsset) {
    setEffectLibrary((current) => current.map((entry) =>
      entry.id === effect.id ? effect : entry));
  }

  function updateBroadcastSettings(
    effectId: string,
    update: (effect: GraphicEffectAsset) => GraphicEffectAsset,
  ) {
    setEffectLibrary((current) => current.map((entry) =>
      entry.id === effectId && entry.broadcast ? update(entry) : entry));
  }

  async function selectBroadcastTaskFile(effectId: string) {
    const filePath = await window.gruberDesktop?.selectBroadcastTaskFile();
    if (!filePath) return;
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const content = await readBroadcastTaskFile(filePath);
      setBroadcastTaskEntries((current) => ({ ...current, [effectId]: content.entries }));
      setBroadcastTaskSummaries((current) => ({
        ...current,
        [effectId]: {
          entryCount: content.entries.length,
          filePath: content.filePath,
          warnings: content.warnings,
        },
      }));
      updateBroadcastSettings(effectId, (effect) => ({
        ...effect,
        broadcast: effect.broadcast && {
          ...effect.broadcast,
          settings: {
            ...effect.broadcast.settings,
            animationInOut: {
              ...effect.broadcast.settings.animationInOut,
              taskFilePath: content.filePath,
            },
            nextProgram: {
              ...effect.broadcast.settings.nextProgram,
              taskFilePath: content.filePath,
            },
          },
        },
      }));
      setEffectsMessage(
        `Файл задания прочитан: ${content.entries.length} записей` +
          (content.warnings.length > 0 ? `, предупреждений — ${content.warnings.length}.` : "."),
      );
    } catch (reason) {
      setOperationError(errorMessage(reason));
    } finally {
      setEffectsBusy(false);
    }
  }

  /**
   * Перенос правок в уже назначенные ролики.
   *
   * Настройки эффекта правятся уже после того, как он разложен по плейлисту, и
   * сами по себе разложенные слои не меняются. Пересобираем их ровно для тех
   * роликов, которые эффект уже несут: область назначения при этом сохраняется,
   * а прежние слои снимаются, чтобы не копились дубли.
   */
  async function applyBroadcastChanges(effectId: string) {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    if (!effect?.broadcast) return;
    const assignedIds = new Set(
      [...playlist, ...futurePlaylist]
        .filter((asset) =>
          asset.effects?.some((layer) => layer.effectId === effectId) ||
          asset.textOverlays?.some((overlay) => overlay.effectId === effectId))
        .map((asset) => asset.id),
    );
    if (assignedIds.size === 0) {
      setEffectsMessage(`${effect.name}: эффект ещё не назначен ни одному ролику.`);
      return;
    }
    // Стингер лежит парой: хвост на выбранном ролике и голова на следующем.
    // Пересобирать надо от выбранных, иначе область назначения расползётся.
    const targetIds = effect.broadcast.kind === "stinger-transition"
      ? new Set([...assignedIds].filter((id) =>
          [...playlist, ...futurePlaylist].some((asset) =>
            asset.id === id &&
            asset.effects?.some((layer) =>
              layer.effectId === effectId && layer.sourceInSeconds === 0))))
      : assignedIds;
    // Снятие и повторную раскладку делаем одним проходом: состояние React
    // обновляется асинхронно, и раскладка по ещё не очищенному плейлисту
    // добавила бы вторую копию слоёв поверх старых.
    await applyBroadcastEffect(effect, targetIds, {
      base: {
        current: removeBroadcastEffect(playlist, effectId),
        future: removeBroadcastEffect(futurePlaylist, effectId),
      },
      silent: true,
    });
    setEffectsMessage(
      `${effect.name}: настройки перенесены в ${assignedIds.size} ролик(ов).`,
    );
  }

  /**
   * Подгрузка Lottie прямо из настроек эффекта второго уровня: файл
   * анализируется, попадает в библиотеку как эффект уровня 3 и сразу
   * назначается пресетом — без похода в общий импорт и обратно.
   */
  async function importBroadcastPreset(effectId: string) {
    const paths = await window.gruberDesktop?.selectEffectFiles();
    const selected = paths?.[0];
    if (!selected) return;
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const [preset] = await analyzeGraphicEffectPaths([selected]);
      if (!preset) throw new Error("Файл не удалось разобрать как эффект");
      setEffectLibrary((current) => {
        const merged = mergeEffectAssets(current, [preset]);
        return merged.map((entry) => entry.id === effectId && entry.broadcast
          ? { ...entry, broadcast: { ...entry.broadcast, presetEffectId: preset.id } }
          : entry);
      });
      setEffectsMessage(
        `${preset.name}: пресет подгружен и назначен эффекту.` +
          (preset.lottie
            ? ` Текстовых полей — ${preset.lottie.properties.filter((p) => p.type === "text").length}.`
            : " Текстовых полей нет: это обычное alpha-медиа."),
      );
    } catch (reason) {
      setOperationError(errorMessage(reason));
    } finally {
      setEffectsBusy(false);
    }
  }

  /** Заголовки новостной ленты. Качает media-service: у окна Electron строгий CSP. */
  async function loadTickerFeed(effectId: string) {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    const url = effect?.broadcast?.settings.tickerCrawl.feedUrl;
    if (!url) return;
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const content = await readTickerFeed(url);
      updateBroadcastSettings(effectId, (entry) => ({
        ...entry,
        broadcast: entry.broadcast && {
          ...entry.broadcast,
          settings: {
            ...entry.broadcast.settings,
            tickerCrawl: {
              ...entry.broadcast.settings.tickerCrawl,
              items: content.items,
              source: "feed",
            },
          },
        },
      }));
      setEffectsMessage(
        `Лента прочитана: ${content.items.length} заголовков. ` +
          "Примените эффект заново, чтобы новости ушли в эфир.",
      );
    } catch (reason) {
      setOperationError(errorMessage(reason));
    } finally {
      setEffectsBusy(false);
    }
  }

  async function selectTickerSourceFile(effectId: string) {
    const filePath = await window.gruberDesktop?.selectTickerSourceFile();
    if (!filePath) return;
    setEffectsBusy(true);
    setOperationError(null);
    try {
      const content = await readTickerSourceFile(filePath);
      updateBroadcastSettings(effectId, (effect) => ({
        ...effect,
        broadcast: effect.broadcast && {
          ...effect.broadcast,
          settings: {
            ...effect.broadcast.settings,
            tickerCrawl: {
              ...effect.broadcast.settings.tickerCrawl,
              filePath: content.filePath,
              items: content.items,
              source: "file",
            },
          },
        },
      }));
      setEffectsMessage(`Бегущая строка: загружено ${content.items.length} сообщений.`);
    } catch (reason) {
      setOperationError(errorMessage(reason));
    } finally {
      setEffectsBusy(false);
    }
  }

  async function selectStingerFile(effectId: string) {
    const filePath = await window.gruberDesktop?.selectStingerFile();
    if (!filePath) return;
    updateBroadcastSettings(effectId, (effect) => ({
      ...effect,
      broadcast: effect.broadcast && {
        ...effect.broadcast,
        settings: {
          ...effect.broadcast.settings,
          stingerTransition: { ...effect.broadcast.settings.stingerTransition, assetPath: filePath },
        },
      },
    }));
    setEffectsMessage("Файл перехода выбран. Проверьте Duration и Cut point по кадровой сетке.");
  }

  /**
   * Считает план эффекта, заказывает нужные Lottie-рендеры и кладёт результат в
   * оба плейлиста. Рендер идёт по одному разу на уникальный набор значений:
   * недельная сетка иначе заказала бы сотни одинаковых файлов.
   */
  async function applyBroadcastEffect(
    effect: GraphicEffectAsset,
    targetIds: Set<string> | null,
    options: { base?: { current: MediaAsset[]; future: MediaAsset[] }; silent?: boolean } = {},
  ) {
    const preset = effect.broadcast?.presetEffectId
      ? effectLibrary.find((entry) => entry.id === effect.broadcast?.presetEffectId) ?? null
      : null;
    const taskEntries = broadcastTaskEntries[effect.id] ?? [];
    setEffectsBusy(true);
    setOperationError(null);
    try {
      // Пустое расписание пропускается целиком: «в Future нет роликов» — это не
      // ошибка привязки, и в счётчике ошибок оператору она только мешает.
      const plans = (["current", "future"] as const).flatMap((slot) => {
        const assets = slot === "current"
          ? options.base?.current ?? playlist
          : options.base?.future ?? futurePlaylist;
        if (assets.length === 0) return [];
        return {
          assets,
          plan: planBroadcastEffect({
            clips: assets.map(broadcastTargetClip),
            effect,
            frameRate: Number(settings.frameRate) || 25,
            preset,
            targetIds,
            taskEntries,
          }),
          slot,
        };
      });
      const errors = [...new Set(plans.flatMap((entry) => entry.plan.errors))];
      const warnings = [...new Set(plans.flatMap((entry) => entry.plan.warnings))];
      // Ошибка привязки в обоих расписаниях сразу — эффекту просто некуда лечь.
      if (plans.every((entry) => entry.plan.layers.length === 0 &&
        entry.plan.textOverlays.length === 0)) {
        setOperationError(errors[0] ?? `${effect.name}: эффекту не к чему применяться.`);
        return;
      }
      const renderedPathByKey = await renderBroadcastVariants(plans.flatMap((entry) =>
        entry.plan.renders), preset);
      let touched = 0;
      for (const entry of plans) {
        const applied = applyBroadcastPlan(entry.assets, entry.plan, renderedPathByKey);
        touched += applied.touched;
        if (entry.slot === "current") setPlaylist(applied.items);
        else setFuturePlaylist(applied.items);
      }
      if (!options.silent) {
        setEffectsMessage(
          `${effect.name}: применён к ${touched} ролику(ам).` +
            (warnings.length > 0 ? ` Предупреждений: ${warnings.length} — ${warnings[0]}` : "") +
            (errors.length > 0 ? ` Ошибок привязки: ${errors.length} — ${errors[0]}` : ""),
        );
      }
    } catch (reason) {
      setOperationError(errorMessage(reason));
    } finally {
      setEffectsBusy(false);
    }
  }

  async function renderBroadcastVariants(
    renders: { key: string; overrides: Record<string, string> }[],
    preset: GraphicEffectAsset | null,
  ): Promise<Map<string, string>> {
    const rendered = new Map<string, string>();
    if (!preset?.lottie) return rendered;
    const unique = new Map(renders.map((render) => [render.key, render]));
    for (const render of unique.values()) {
      const variant = await renderLottieEffect({
        ...preset,
        lottie: {
          ...preset.lottie,
          properties: preset.lottie.properties.map((property) =>
            render.overrides[property.id] != null
              ? { ...property, overridden: true, value: render.overrides[property.id]! }
              : property),
        },
      });
      rendered.set(render.key, variant.filePath);
    }
    return rendered;
  }

  function removeEffect(effectId: string) {
    const effect = effectLibrary.find((entry) => entry.id === effectId);
    if (!effect) return;
    const assigned = [...playlist, ...futurePlaylist].some((asset) =>
      asset.effects?.some((layer) => layer.effectId === effectId) ||
      asset.textOverlays?.some((overlay) => overlay.effectId === effectId));
    if (assigned && !window.confirm(`Remove ${effect.name} and every assignment from the playlists?`)) {
      return;
    }
    setEffectLibrary((current) => current.filter((entry) => entry.id !== effectId));
    setBroadcastTaskEntries((current) => {
      const { [effectId]: removed, ...rest } = current;
      return rest;
    });
    setBroadcastTaskSummaries((current) => {
      const { [effectId]: removed, ...rest } = current;
      return rest;
    });
    // Эффект второго уровня оставляет ещё надписи и звуковые вставки — их
    // снимает removeBroadcastEffect, чтобы в плейлисте не остался сирота.
    const removeAssignments = (items: MediaAsset[]) => removeBroadcastEffect(items, effectId);
    setPlaylist(removeAssignments);
    setFuturePlaylist(removeAssignments);
  }

  async function selectSubtitleDirectory() {
    const selected = await window.gruberDesktop?.selectSubtitleDirectory();
    if (!selected) return;
    setSubtitleLibrary(selected);
    setPlaylist((items) => reconcileSubtitleAssignments(items, selected.filePaths));
    setFuturePlaylist((items) => reconcileSubtitleAssignments(items, selected.filePaths));
    setScheduleActionMessage(`SRT folder loaded: ${selected.filePaths.length} subtitle file(s).`);
  }

  async function selectAudioTrackDirectory() {
    const selected = await window.gruberDesktop?.selectAudioTrackDirectory();
    if (!selected) return;
    setSettings((current) => ({ ...current, audioTrackDirectory: selected.directoryPath }));
    await refreshAudioTracks(selected.directoryPath);
  }

  /** Пересобирает дорожки для обоих плейлистов и включает многоязычный звук. */
  async function refreshAudioTracks(directoryPath: string | null) {
    const mediaPaths = [...playlist, ...futurePlaylist]
      .map((asset) => asset.filePath)
      .filter(Boolean);
    if (mediaPaths.length === 0) {
      setAudioTrackLibrary(null);
      return;
    }

    try {
      const scan = await scanAudioTracks(directoryPath, mediaPaths);
      const byPath = new Map(scan.items.map((item) => [item.mediaFilePath, item.tracks]));
      const attach = (items: MediaAsset[]) => items.map((asset) => ({
        ...asset,
        audioTracks: byPath.get(asset.filePath) ?? [],
      }));
      setPlaylist(attach);
      setFuturePlaylist(attach);
      setAudioTrackLibrary({ directoryPath: directoryPath ?? "", languages: scan.languages });
      if (scan.languages.length > 0) {
        setSettings((current) => ({ ...current, audioTracksEnabled: true }));
      }
      setScheduleActionMessage(
        scan.languages.length > 0
          ? `Audio tracks: ${scan.languages.map((l) => `{${l.label}}`).join(" ")}`
          : "Audio tracks: nothing matched the media file names.",
      );
    } catch (error) {
      setOperationError(errorMessage(error));
    }
  }

  function updatePlaylistItem(assetId: string, patch: Partial<MediaAsset>) {
    updateActivePlaylist((current) => current.map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset
    ));
  }

  function updatePlaylistItems(
    assetIds: string[],
    updater: (asset: MediaAsset) => Partial<MediaAsset>,
  ) {
    const selected = new Set(assetIds);
    updateActivePlaylist((current) => current.map((asset) =>
      selected.has(asset.id) ? { ...asset, ...updater(asset) } : asset
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
          durationSeconds: clampAgeDuration(
            asset.ageTitle?.durationSeconds ?? settings.ageTitleDurationSeconds,
          ),
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
          margin: asset.itemLogo?.margin ?? settings.logoMargin,
          opacity: asset.itemLogo?.opacity ?? settings.logoOpacity,
          position: asset.itemLogo?.position ?? normalizeLogoPosition(settings.logoPosition),
          widthPercent: asset.itemLogo?.widthPercent ?? settings.logoWidthPercent,
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

  function openPlaylistSchedule(slot: ScheduleSlot) {
    setScheduleTab(slot);
    const target = slot === "current" ? playlist : futurePlaylist;
    if (target.length === 0) setView("import");
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
    setSettings((current) => ({
      ...current,
      logoEnabled: true,
      logoPath: filePath,
    }));
    updateActivePlaylist((items) => items.map((asset) => ({
      ...asset,
      itemLogo: {
        enabled: asset.itemLogo?.enabled ?? true,
        filePath,
        margin: asset.itemLogo?.margin ?? settings.logoMargin,
        opacity: asset.itemLogo?.opacity ?? settings.logoOpacity,
        position: asset.itemLogo?.position ?? normalizeLogoPosition(settings.logoPosition),
        widthPercent: asset.itemLogo?.widthPercent ?? settings.logoWidthPercent,
      },
    })));
    setScheduleActionMessage(`Channel logo assigned to ${activeSchedule} schedule.`);
  }

  function updateAgeDuration(value: number) {
    const durationSeconds = clampAgeDuration(value);
    setSettings((current) => ({ ...current, ageTitleDurationSeconds: durationSeconds }));
    const update = (items: MediaAsset[]) => items.map((asset) => asset.ageTitle
      ? { ...asset, ageTitle: { ...asset.ageTitle, durationSeconds } }
      : asset);
    setPlaylist(update);
    setFuturePlaylist(update);
    setScheduleActionMessage(
      `AGE duration set to ${durationSeconds}s for Current and Future schedules.`,
    );
  }

  function updateScheduleLogoSettings(
    patch: Partial<Pick<
      BroadcastSettings,
      "logoPosition" | "logoWidthPercent" | "logoMargin" | "logoOpacity"
    >>,
  ) {
    const next = {
      logoPosition: patch.logoPosition ?? settings.logoPosition,
      logoWidthPercent: clampNumber(
        patch.logoWidthPercent ?? settings.logoWidthPercent,
        1,
        50,
      ),
      logoMargin: Math.round(clampNumber(patch.logoMargin ?? settings.logoMargin, 0, 500)),
      logoOpacity: clampNumber(patch.logoOpacity ?? settings.logoOpacity, 0.05, 1),
    };
    setSettings((current) => ({ ...current, ...next }));
    const update = (items: MediaAsset[]) => items.map((asset) => asset.itemLogo
      ? {
          ...asset,
          itemLogo: {
            ...asset.itemLogo,
            margin: next.logoMargin,
            opacity: next.logoOpacity,
            position: normalizeLogoPosition(next.logoPosition),
            widthPercent: next.logoWidthPercent,
          },
        }
      : asset);
    setPlaylist(update);
    setFuturePlaylist(update);
    setScheduleActionMessage("Channel logo appearance updated for Current and Future schedules.");
  }

  async function selectAgeDirectory() {
    const selection = await window.gruberDesktop?.selectAgeDirectory();
    if (!selection) return;
    const ageAssets = mapAgeAssetPaths(selection.imagePaths);
    setAgeLibrary(selection);
    setPlaylist((items) => assignAgeAssets(
      items,
      ageAssets,
      settings.ageTitleDurationSeconds,
    ));
    setFuturePlaylist((items) => assignAgeAssets(
      items,
      ageAssets,
      settings.ageTitleDurationSeconds,
    ));
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
            ? {
                durationSeconds: clampAgeDuration(asset.ageTitle.durationSeconds),
                enabled: asset.ageTitle.enabled,
                text: asset.ageTitle.text,
              }
            : null,
          logoPath: asset.itemLogo?.enabled ? asset.itemLogo.filePath : null,
          graphicElements: (asset.effects ?? []).map((effect) => ({
            backgroundPath: effect.backgroundPath ?? effect.filePath,
            durationSeconds: effect.endSeconds - effect.startSeconds,
            endOnSeconds: effect.endSeconds,
            name: effect.name,
            startOnSeconds: effect.startSeconds,
            titlePath: effect.titlePath ?? null,
            titlePaths: effect.titlePaths,
          })),
          srtPath: asset.subtitles?.filePath ?? null,
          srtEnabled: Boolean(asset.subtitles?.enabled),
          audioTracks: (asset.audioTracks ?? []).map((track) => ({
            language: track.label,
            filePath: track.filePath,
          })),
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

  async function saveEncodingSettingsProfile() {
    setSettingsProfileBusy(true);
    setOperationError(null);
    setSettingsProfileMessage(null);
    try {
      const profile = createEncodingSettingsProfile(
        settings,
        connection.kind === "ready" ? connection.health.version : applicationVersion,
      );
      const content = serializeEncodingSettingsProfile(profile);
      const timestamp = profile.exportedAt.replace(/[:.]/g, "-");
      const defaultName = `FluxIO-encoding-settings-${timestamp}.txt`;
      let outputPath: string | null = null;
      if (window.gruberDesktop) {
        outputPath = await window.gruberDesktop.saveEncodingSettingsFile({
          content,
          defaultName,
        });
      } else {
        downloadSchedule(content, defaultName);
        outputPath = defaultName;
      }
      if (outputPath) {
        setSettingsProfileMessage(`Settings saved: ${outputPath}`);
      }
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setSettingsProfileBusy(false);
    }
  }

  async function importEncodingSettingsProfile(browserFile?: File) {
    setSettingsProfileBusy(true);
    setOperationError(null);
    setSettingsProfileMessage(null);
    try {
      let content: string;
      let sourceName: string;
      if (browserFile) {
        if (!browserFile.name.toLowerCase().endsWith(".txt")) {
          throw new Error("Encoding settings must be imported from a .txt file");
        }
        if (browserFile.size === 0 || browserFile.size > 1024 * 1024) {
          throw new Error("Encoding settings file must be between 1 byte and 1 MB");
        }
        content = await browserFile.text();
        sourceName = browserFile.name;
      } else {
        const selection = await window.gruberDesktop?.selectEncodingSettingsFile();
        if (!selection) return;
        content = selection.content;
        sourceName = selection.filePath;
      }
      const profile = parseEncodingSettingsProfile(content);
      const importedSettings = applyEncodingSettingsProfile(profile, initialBroadcastSettings);
      setSettings(importedSettings);
      if (importedSettings.logoEnabled && importedSettings.logoPath) {
        setScheduleLogoPath(importedSettings.logoPath);
        setScheduleLogoSource(importedSettings.logoPath);
        const applyImportedLogo = (items: MediaAsset[]) => assignChannelLogo(
          items,
          importedSettings.logoPath,
          importedSettings,
        );
        setPlaylist(applyImportedLogo);
        setFuturePlaylist(applyImportedLogo);
      }
      setSettingsProfileMessage(
        `Settings imported from ${sourceName}. SRT/RTMP secrets must be entered again.`,
      );
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setSettingsProfileBusy(false);
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
        buildStartRequest(playlist, settings, futurePlaylist),
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

  async function startCompositePreview(asset: MediaAsset, startSeconds: number) {
    return startCompositeClipPreviewSession(
      buildStartRequest([asset], settings, []),
      startSeconds,
    );
  }

  async function startPlayout(mode: "default" | "resume" | "beginning" = "default") {
    setOperationError(null);
    try {
      const baseRequest = buildStartRequest(playlist, settings, futurePlaylist);
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

      {/* Расхождение версий тихо ломает данные: старый media-service не знает
          новых полей, и Zod срезает их при сохранении сессии — эфирные эффекты
          второго уровня после перезапуска превращаются в пустые записи. */}
      {staleServiceVersion ? (
        <div className="service-version-warning" role="alert">
          <strong>media-service версии {staleServiceVersion}</strong>
          <span>
            Интерфейс собран под {applicationVersion}. Старый сервис не знает часть полей и
            вырезает их при сохранении сессии — настройки эфирных эффектов будут теряться.
            Перезапустите media-service обновлённой сборкой.
          </span>
        </div>
      ) : null}

      {view === "import" ? (
        <ImportAnalyzeScreen
          activeSchedule={activeSchedule}
          assets={visiblePlaylist}
          currentCount={playlist.length}
          futureCount={futurePlaylist.length}
          onAddFiles={addFilesToActiveSchedule}
          busy={mediaBusy}
          onClear={clearActiveImport}
          onScheduleChange={setScheduleTab}
          onSelectDirectory={window.gruberDesktop
            ? () => addNativeDirectory(activeSchedule)
            : undefined}
          onSelectFiles={window.gruberDesktop
            ? () => addNativeFiles(activeSchedule)
            : undefined}
          onSelectSchedule={window.gruberDesktop ? importNativeSchedule : undefined}
          onProceed={() => setView("playlist")}
          operationError={operationError}
        />
      ) : null}

      {view === "effects" ? (
        <EffectsScreen
          busy={effectsBusy}
          clips={effectTargetClips}
          effects={effectLibrary}
          message={effectsMessage}
          onAddToClip={stableAddEffectToClip}
          onAddToEntireProject={stableAddEffectToProject}
          onClearTitleDirectory={stableClearTitleDirectory}
          onRemove={stableRemoveEffect}
          onRenderLottie={stableRenderProjectLottie}
          onSelectDirectory={window.gruberDesktop ? stableSelectEffectDirectory : undefined}
          onSelectFiles={window.gruberDesktop ? stableSelectEffectFiles : undefined}
          onSelectTitleDirectory={window.gruberDesktop ? stableSelectTitleDirectory : undefined}
          broadcastTaskSummaries={broadcastTaskSummaries}
          onChangeBroadcastEffect={stableChangeBroadcastEffect}
          onCreateBroadcastEffect={stableCreateBroadcastEffect}
          onSelectBroadcastTaskFile={stableSelectBroadcastTaskFile}
          onSelectStingerFile={stableSelectStingerFile}
          onSelectTickerSourceFile={stableSelectTickerSourceFile}
          onLoadTickerFeed={stableLoadTickerFeed}
          onApplyBroadcastChanges={stableApplyBroadcastChanges}
          onImportBroadcastPreset={stableImportBroadcastPreset}
          assignedClipCounts={assignedClipCounts}
          playoutActive={playoutActive}
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
            onAddNativeFiles={window.gruberDesktop ? addNativeFilesToActiveSchedule : undefined}
            onAddScte35Marker={addScte35Marker}
            onMoveItems={movePlaylistItems}
            onBulkAgeChange={updateBulkAge}
            onBulkLogoChange={updateBulkLogo}
            onRemoveItem={removePlaylistItem}
            onRemoveScte35Marker={removeScte35Marker}
            onSelectAsset={setSelectedAssetId}
            onScheduleChange={openPlaylistSchedule}
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
            onUpdateItems={updatePlaylistItems}
            effectLibrary={effectLibrary}
            subtitleLibrary={subtitleLibrary}
            onSelectSubtitleDirectory={window.gruberDesktop ? selectSubtitleDirectory : undefined}
            audioTracksEnabled={settings.audioTracksEnabled}
            audioTrackDirectory={settings.audioTrackDirectory}
            audioOriginalLanguage={settings.audioOriginalLanguage}
            audioProgramLanguages={(audioTrackLibrary?.languages ?? []).map((l) => l.label)}
            onSelectAudioTrackDirectory={
              window.gruberDesktop ? selectAudioTrackDirectory : undefined
            }
            onAudioTrackSettingsChange={(patch) =>
              setSettings((current) => ({ ...current, ...patch }))}
            ageDurationSeconds={settings.ageTitleDurationSeconds}
            ageLibrary={ageLibrary}
            scheduleActionMessage={scheduleActionMessage}
            scheduleBusy={mediaBusy}
            workspaceBusy={workspaceBusy}
            takeBusy={takeBusy}
            savedSessionUpdatedAt={savedWorkspaceSession?.updatedAt ?? null}
            recoveryCheckpoint={recoveryCheckpoint}
            recoveryAssetId={recoverySelection?.asset.id ?? null}
            scheduleStartMarker={scheduleStartMarker}
            playoutActive={Boolean(playoutStatus && ["starting", "running", "stopping"].includes(playoutStatus.state))}
            playoutStatus={playoutStatus}
            initialPreviewTimeSeconds={
              recoverySelection?.asset.id === selectedAsset.id
                ? recoverySelection.itemOffsetSeconds
                : null
            }
            scheduleLogoSource={scheduleLogoSource || scheduleLogoPath}
            scheduleLogoPath={scheduleLogoPath}
            logoSettings={settings}
            scte35Defaults={settings}
            onAgeDurationChange={updateAgeDuration}
            onLogoSettingsChange={updateScheduleLogoSettings}
            onClearStartMarker={clearStartMarker}
            onStartFromItem={startFromPlaylistItem}
            onStartCompositePreview={startCompositePreview}
          />
        ) : (
          <EmptyPlaylist
            activeSchedule={activeSchedule}
            currentCount={playlist.length}
            futureCount={futurePlaylist.length}
            onOpenLibrary={() => setView("import")}
            onScheduleChange={openPlaylistSchedule}
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
          settingsProfileBusy={settingsProfileBusy}
          settingsProfileMessage={settingsProfileMessage}
          onImportSettings={importEncodingSettingsProfile}
          onSaveSettings={saveEncodingSettingsProfile}
          scheduleStartMarker={scheduleStartMarker}
          scheduleStartItemName={playlist.find(
            (asset) => asset.id === scheduleStartMarker?.assetId,
          )?.name ?? null}
        />
      ) : null}

      {missingGraphics.length > 0 ? (
        <MissingGraphicsDialog
          busy={effectsBusy}
          items={missingGraphics}
          onClose={() => {
            setMissingGraphics([]);
            setMissingGraphicsResolved({});
          }}
          onDropAll={dropUnresolvedGraphics}
          onLocate={(filePath) => void locateMissingGraphic(filePath)}
          resolved={missingGraphicsResolved}
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
  const response = await fetch("/api/health", { signal: AbortSignal.timeout(1_500) });

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
    hasAudio: probe.hasAudio,
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

function scheduleMetadata(schedule: ParsedSchedule, slot: ScheduleSlot): ScheduleMetadata {
  return {
    anchorDate: scheduleAnchorDate(slot),
    delaySeconds: schedule.delaySeconds,
    encoding: schedule.encoding,
    sourceFilePath: schedule.sourceFilePath,
    sourceName: schedule.sourceFilePath.split(/[\\/]/).at(-1) ?? schedule.sourceFilePath,
    startTime: schedule.startTime,
    targetDurationSeconds: schedule.targetDurationSeconds,
    warnings: schedule.warnings,
  };
}

function scheduleAnchorDate(slot: ScheduleSlot): string {
  const anchor = new Date();
  anchor.setHours(0, 0, 0, 0);
  const daysSinceMonday = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - daysSinceMonday + (slot === "future" ? 7 : 0));
  return [
    anchor.getFullYear(),
    String(anchor.getMonth() + 1).padStart(2, "0"),
    String(anchor.getDate()).padStart(2, "0"),
  ].join("-");
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
  nextPlaylist: MediaAsset[] = [],
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
    playlist: buildPlayoutItems(playlist),
    nextPlaylist: buildPlayoutItems(nextPlaylist),
    audioProgram: buildAudioProgram([...playlist, ...nextPlaylist], {
      basePid: settings.udpAudioPid,
      directoryPath: settings.audioTrackDirectory || null,
      enabled: settings.audioTracksEnabled,
      originalLabel: settings.audioOriginalLabel,
      originalLanguageCode: settings.audioOriginalLanguage,
    }),
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
      loudnessNormalization: {
        enabled: settings.loudnessNormalizationEnabled,
        targetLufs: settings.loudnessTargetLufs,
        truePeakDbtp: -1,
        loudnessRangeLufs: 7,
      },
    },
    logo: null,
    endpoint,
    subtitleOutput: {
      mode: settings.subtitleOutputMode === "DVB Subtitles" ? "dvb" : "burn-in",
      pid: Math.min(8_190, Math.max(32, Math.trunc(settings.subtitlePid))),
      language: /^[A-Za-z]{3}$/.test(settings.subtitleLanguage)
        ? settings.subtitleLanguage.toLowerCase()
        : "rus",
      type: settings.subtitleType === "Hearing impaired" ? "hearing-impaired" : "normal",
      fontFamily: settings.subtitleFontFamily.trim() || "Sans",
      fontSize: Math.min(160, Math.max(12, Math.trunc(settings.subtitleFontSize))),
      bottomMargin: Math.min(1_000, Math.max(0, Math.trunc(settings.subtitleBottomMargin))),
      outline: settings.subtitleOutline,
      maxColours: settings.subtitleMaxColours,
      bitrateKbps: Math.min(2_000, Math.max(32, Math.trunc(settings.subtitleBitrateKbps))),
      ptsOffsetMs: Math.min(10_000, Math.max(0, Math.trunc(settings.subtitlePtsOffsetMs))),
    },
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

function buildPlayoutItems(playlist: MediaAsset[]): StartPlayoutRequest["playlist"] {
  return playlist.map((asset) => ({
    id: asset.id,
    name: asset.name,
    filePath: asset.filePath,
    sourceDurationSeconds: asset.durationSeconds > 0 ? asset.durationSeconds : undefined,
    hasAudio: asset.hasAudio ?? !/^no audio stream$/i.test(asset.audio.trim()),
    trimInSeconds: 0,
    trimOutSeconds: asset.declaredDurationSeconds ?? null,
    scte35Markers: asset.scte35Markers ?? [],
    scheduleType: asset.scheduleType ?? null,
    declaredDurationSeconds: asset.declaredDurationSeconds ?? null,
    audioTracks: asset.audioTracks ?? [],
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
    effects: asset.effects ?? [],
    textOverlays: asset.textOverlays ?? [],
    audioOverlays: asset.audioOverlays ?? [],
    subtitles: asset.subtitles?.enabled && asset.subtitles.filePath
      ? { enabled: true, filePath: asset.subtitles.filePath }
      : null,
  }));
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
  const checkpointItemIndex = checkpoint.currentItemId
    ? playlist.findIndex((asset) => asset.id === checkpoint.currentItemId)
    : -1;
  let itemIndex = checkpointItemIndex >= 0
    ? checkpointItemIndex
    : Math.min(checkpoint.currentItemIndex, playlist.length - 1);
  let elapsedBeforeItem = playlist
    .slice(0, itemIndex)
    .reduce((total, asset) => total + effectiveAssetDuration(asset), 0);
  let itemOffsetSeconds = checkpointItemIndex >= 0
    ? checkpoint.currentItemElapsedSeconds
    : Math.max(0, checkpoint.outTimeSeconds - elapsedBeforeItem);
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
    effects: (first.effects ?? [])
      .filter((layer) => layer.endSeconds > point.itemOffsetSeconds)
      .map((layer) => ({
        ...layer,
        startSeconds: Math.max(0, layer.startSeconds - point.itemOffsetSeconds),
        endSeconds: layer.endSeconds - point.itemOffsetSeconds,
      })),
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

/** Ролик как цель эффекта второго уровня: длительность — эфирная, а не файла. */
function broadcastTargetClip(asset: MediaAsset): BroadcastTargetClip {
  return {
    durationSeconds: Math.max(0.04, effectiveAssetDuration(asset)),
    id: asset.id,
    name: asset.name,
    scheduleType: asset.scheduleType ?? null,
  };
}

/** Версия интерфейса. Сверяется с версией media-service при подключении. */
const applicationVersion = "7.0.6";

function effectiveAssetDuration(asset: MediaAsset): number {
  return airDurationSeconds(asset);
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

function mergeEffectAssets(
  current: GraphicEffectAsset[],
  incoming: GraphicEffectAsset[],
): GraphicEffectAsset[] {
  const byId = new Map(current.map((effect) => [effect.id, effect]));
  for (const effect of incoming) {
    const existing = byId.get(effect.id);
    byId.set(effect.id, existing
      ? {
          ...existing,
          ...effect,
          titleDirectoryPath: effect.titleDirectoryPath ?? existing.titleDirectoryPath,
          titlePaths: [...new Set([...existing.titlePaths, ...effect.titlePaths])],
        }
      : effect);
  }
  return [...byId.values()];
}

function assignEffectTitles(
  items: MediaAsset[],
  effectId: string,
  titlePaths: string[],
): MediaAsset[] {
  return items.map((asset) => ({
    ...asset,
    effects: asset.effects?.map((layer) => layer.effectId === effectId
      ? {
          ...layer,
          backgroundPath: layer.backgroundPath ?? layer.filePath,
          filePath: layer.backgroundPath ?? layer.filePath,
          titlePath: matchingNamedAssetPath(asset.name, titlePaths),
        }
      : layer),
  }));
}

function normalizeComparablePath(value: string): string {
  return value.replaceAll("\\", "/").toLocaleLowerCase();
}

function inferGraphicKind(filePath: string): "static" | "video" {
  return /\.(?:png|webp)$/i.test(filePath) ? "static" : "video";
}

function reconcileSubtitleAssignments(
  items: MediaAsset[],
  subtitlePaths: string[],
): MediaAsset[] {
  return items.map((asset) => {
    if (!asset.subtitles?.enabled) return asset;
    const filePath = matchingSubtitlePath(asset.name, subtitlePaths);
    return { ...asset, subtitles: { enabled: Boolean(filePath), filePath } };
  });
}

function matchingSubtitlePath(mediaName: string, subtitlePaths: string[]): string | null {
  return matchingNamedAssetPath(mediaName, subtitlePaths);
}

function parentDirectory(value: string): string {
  const separator = value.includes("\\") ? "\\" : "/";
  const index = value.lastIndexOf(separator);
  return index > 0 ? value.slice(0, index) : value;
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
    if (!/\.(?:png|webp)$/i.test(fileName)) continue;
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
  defaultDurationSeconds = 10,
): MediaAsset[] {
  return playlist.map((asset) => {
    const text = asset.ageTitle?.text ?? ageRatingFromFileName(asset.name);
    if (!text) return asset;
    return {
      ...asset,
      ageTitle: {
        durationSeconds: clampAgeDuration(
          asset.ageTitle?.durationSeconds ?? defaultDurationSeconds,
        ),
        enabled: asset.ageTitle?.enabled ?? true,
        filePath: ageAssets.get(text) ?? asset.ageTitle?.filePath ?? null,
        text,
      },
    };
  });
}

function clampAgeDuration(value: number): number {
  return Math.round(clampNumber(value, 10, 60));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function preferredLogoPath(imagePaths: string[]): string | null {
  return imagePaths.find((imagePath) => {
    const fileName = imagePath.split(/[\\/]/).at(-1) ?? imagePath;
    return /^(?:logo|channel|brand)(?:[-_. ].*)?\.(?:png|webp|jpe?g)$/i.test(fileName);
  }) ?? imagePaths[0] ?? null;
}

function assignChannelLogo(
  playlist: MediaAsset[],
  filePath: string,
  settings: Pick<
    BroadcastSettings,
    "logoPosition" | "logoWidthPercent" | "logoMargin" | "logoOpacity"
  >,
): MediaAsset[] {
  return playlist.map((asset) => ({
    ...asset,
    itemLogo: {
      enabled: asset.itemLogo?.enabled ?? true,
      filePath,
      margin: settings.logoMargin,
      opacity: settings.logoOpacity,
      position: normalizeLogoPosition(settings.logoPosition),
      widthPercent: settings.logoWidthPercent,
    },
  }));
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
