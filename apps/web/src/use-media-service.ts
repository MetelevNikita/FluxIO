import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  serviceHealthSchema,
  type FfmpegCapabilities,
  type NetworkInterfaceInfo,
  type PlayoutStatus,
  type ServiceHealth,
  type SystemMetrics,
} from "@gruber/contracts";
import {
  getFfmpegCapabilities,
  getNetworkInterfaces,
  getPlayoutStatus,
  getSystemMetrics,
} from "./media-api.js";

export type ConnectionState =
  | { kind: "loading" }
  | { kind: "ready"; health: ServiceHealth }
  | { kind: "error"; message: string };

interface MediaServiceState {
  capabilities: FfmpegCapabilities | null;
  connection: ConnectionState;
  networkInterfaces: NetworkInterfaceInfo[];
  playoutStatus: PlayoutStatus | null;
  pollError: string | null;
  preferredUdpLocalAddress: string | null;
  serverAddress: string;
  setPlayoutStatus: Dispatch<SetStateAction<PlayoutStatus | null>>;
  systemMetrics: SystemMetrics | null;
}

const healthPollIntervalMs = 2_000;
const telemetryPollIntervalMs = 1_000;

export function readyConnection(payload: unknown): ConnectionState {
  return { health: serviceHealthSchema.parse(payload), kind: "ready" };
}

export function failedConnection(error: unknown): ConnectionState {
  return {
    kind: "error",
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

export function preferredUdpLocalAddress(
  interfaces: readonly NetworkInterfaceInfo[],
): string | null {
  return interfaces.find((entry) => entry.family === "IPv4" && !entry.internal)?.address ?? null;
}

export function mediaServerAddress(
  configuredUrl: string | undefined,
  locationHost: string,
): string {
  if (!configuredUrl) return locationHost || "127.0.0.1:4310";
  try {
    const host = new URL(configuredUrl).host;
    if (host) return host;
  } catch {
    // Неполный URL всё равно полезнее пустого адреса в строке состояния.
  }
  return configuredUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function useMediaService(): MediaServiceState {
  const [connection, setConnection] = useState<ConnectionState>({ kind: "loading" });
  const [capabilities, setCapabilities] = useState<FfmpegCapabilities | null>(null);
  const [playoutStatus, setPlayoutStatus] = useState<PlayoutStatus | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    async function loadHealth() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const payload = window.gruberDesktop
          ? await window.gruberDesktop.getServiceHealth()
          : await fetchHealth();
        if (!cancelled) setConnection(readyConnection(payload));
      } catch (error) {
        if (!cancelled) setConnection(failedConnection(error));
      } finally {
        requestInFlight = false;
      }
    }

    void loadHealth();
    const timer = window.setInterval(() => void loadHealth(), healthPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (connection.kind !== "ready") return;
    let cancelled = false;
    let pollInFlight = false;

    async function refreshAll() {
      try {
        const [nextCapabilities, nextStatus, nextMetrics, nextNetworkInterfaces] = await Promise.all([
          getFfmpegCapabilities(),
          getPlayoutStatus(),
          getSystemMetrics(),
          getNetworkInterfaces(),
        ]);
        if (cancelled) return;
        setCapabilities(nextCapabilities);
        setPlayoutStatus(nextStatus);
        setSystemMetrics(nextMetrics);
        setNetworkInterfaces(nextNetworkInterfaces);
        setPollError(null);
      } catch (error) {
        if (!cancelled) setPollError(errorMessage(error));
      }
    }

    pollInFlight = true;
    void refreshAll().finally(() => {
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
    }, telemetryPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection.kind]);

  const serverAddress = useMemo(
    () => mediaServerAddress(window.gruberDesktop?.mediaApiBaseUrl, window.location.host),
    [],
  );

  return {
    capabilities,
    connection,
    networkInterfaces,
    playoutStatus,
    pollError,
    preferredUdpLocalAddress: preferredUdpLocalAddress(networkInterfaces),
    serverAddress,
    setPlayoutStatus,
    systemMetrics,
  };
}

async function fetchHealth(): Promise<unknown> {
  const response = await fetch("/api/health", { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) throw new Error(`Media service returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
