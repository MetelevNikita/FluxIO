import { useCallback, useEffect, useMemo, useState } from "react";
import {
  serviceHealthSchema,
  type FfmpegCapabilities,
  type MediaProbe,
  type NetworkInterfaceInfo,
  type PlayoutStatus,
  type ServiceHealth,
  type StartPlayoutRequest,
  type SystemMetrics,
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
  mediaThumbnailUrl,
  probeMediaPaths,
  scanMediaDirectory,
  startPlayout as startPlayoutSession,
  stopPlayout as stopPlayoutSession,
} from "./media-api";
import type {
  AppView,
  BroadcastSettings,
  MediaAsset,
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

  const selectedAsset = useMemo(
    () =>
      playlist.find((asset) => asset.id === selectedAssetId) ?? playlist[0],
    [playlist, selectedAssetId],
  );

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

  async function analyzePaths(paths: string[]) {
    setMediaBusy(true);
    setOperationError(null);
    const pathSet = new Set(paths);
    const pending = paths.map(pendingAssetFromPath);
    setAssets((current) => mergeAssets(current, pending));
    setPlaylist((current) => mergeAssets(current, pending));
    try {
      addProbes(await probeMediaPaths(paths));
    } catch (error) {
      setOperationError(errorMessage(error));
      const markFailed = (items: MediaAsset[]) => items.map((item) =>
        pathSet.has(item.filePath)
          ? { ...item, progress: undefined, status: "error" as const }
          : item
      );
      setAssets(markFailed);
      setPlaylist(markFailed);
    } finally {
      setMediaBusy(false);
    }
  }

  function addProbes(probes: MediaProbe[]) {
    const imported = probes.map(probeToAsset);
    setAssets((current) => mergeAssets(current, imported));
    setPlaylist((current) => mergeAssets(current, imported));
    setSelectedAssetId((current) => current || imported[0]?.id || "");
  }

  function movePlaylistItem(sourceId: string, targetId: string) {
    setPlaylist((current) => {
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
    const removedIndex = playlist.findIndex((asset) => asset.id === assetId);
    if (removedIndex < 0) return;
    const next = playlist.filter((asset) => asset.id !== assetId);
    setPlaylist(next);
    if (selectedAssetId === assetId) {
      setSelectedAssetId(next[removedIndex]?.id ?? next[removedIndex - 1]?.id ?? "");
    }
  }

  function addScte35Marker(assetId: string, marker: Scte35Marker) {
    setPlaylist((current) => current.map((asset) =>
      asset.id === assetId
        ? { ...asset, scte35Markers: [...(asset.scte35Markers ?? []), marker] }
        : asset
    ));
  }

  function removeScte35Marker(assetId: string, markerId: string) {
    setPlaylist((current) => current.map((asset) =>
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
    setSelectedAssetId("");
  }

  async function startPlayout() {
    setOperationError(null);
    try {
      const request = buildStartRequest(playlist, settings);
      setPlayoutStatus(await startPlayoutSession(request));
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
          onProceed={() => setView("playlist")}
          operationError={operationError}
        />
      ) : null}

      {view === "playlist" ? (
        selectedAsset ? (
          <PlaylistPreviewScreen
            playlist={playlist}
            selectedAsset={selectedAsset}
            onAddFiles={addFiles}
            onAddScte35Marker={addScte35Marker}
            onMoveItem={movePlaylistItem}
            onRemoveItem={removePlaylistItem}
            onRemoveScte35Marker={removeScte35Marker}
            onSelectAsset={setSelectedAssetId}
            scte35Defaults={settings}
          />
        ) : (
          <EmptyPlaylist onOpenLibrary={() => setView("import")} />
        )
      ) : null}

      {view === "broadcast" ? (
        <BroadcastSettingsScreen
          settings={settings}
          networkInterfaces={networkInterfaces}
          capabilities={capabilities}
          onSettingsChange={setSettings}
          onStart={() => void startPlayout()}
          onStop={() => void stopPlayout()}
          operationError={operationError}
          playlistLength={playlist.length}
          scte35MarkerCount={playlist.reduce(
            (total, asset) => total + (asset.scte35Markers?.length ?? 0),
            0,
          )}
          playoutStatus={playoutStatus}
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

function EmptyPlaylist({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <main className="empty-playlist screen-body">
      <div>
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

function mergeAssets(current: MediaAsset[], incoming: MediaAsset[]): MediaAsset[] {
  const incomingByPath = new Map(incoming.map((asset) => [asset.filePath, asset]));
  const merged = current.map((asset) => incomingByPath.get(asset.filePath) ?? asset);
  const currentPaths = new Set(current.map((asset) => asset.filePath));
  return [...merged, ...incoming.filter((asset) => !currentPaths.has(asset.filePath))];
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
      trimOutSeconds: null,
      scte35Markers: asset.scte35Markers ?? [],
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
