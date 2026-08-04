import type { PlayoutEndpoint, StartPlayoutRequest } from "@gruber/contracts";

export interface TsdDuckCommandOptions {
  cueFilePath: string | null;
  cueCount: number;
  inputPort: number;
  monitorPrefix?: string;
  request: StartPlayoutRequest;
}

export interface TsdDuckCommand {
  args: string[];
  endpointLabel: string;
}

export function buildTsdDuckCommand({
  cueFilePath,
  cueCount,
  inputPort,
  monitorPrefix = "GRUBER_SCTE35:",
  request,
}: TsdDuckCommandOptions): TsdDuckCommand {
  const pid = request.scte35.pid;
  const args = [
    "-I",
    "ip",
    "--local-address",
    "127.0.0.1",
    String(inputPort),
  ];

  if (request.scte35.enabled) {
    args.push(
      "-P",
      "pmt",
      "--service",
      "1",
      "--add-registration",
      "0x43554549",
      "--add-pid",
      `${pid}/0x86`,
      "--set-cue-type",
      `${pid}/0x01`,
    );
  }

  if (request.scte35.enabled && cueFilePath && cueCount > 0) {
    args.push(
      "-P",
      "spliceinject",
      "--service",
      "1",
      "--pid",
      String(pid),
      "--files",
      cueFilePath,
      "--wait-first-batch",
      "--queue-size",
      String(Math.max(100, cueCount * 3)),
      "--start-delay",
      String(request.scte35.preRollMs),
      "--inject-count",
      "2",
      "--inject-interval",
      String(Math.min(800, Math.max(100, Math.floor(request.scte35.preRollMs / 3)))),
    );
  }

  if (request.scte35.enabled) {
    args.push(
      "-P",
      "splicemonitor",
      "--splice-pid",
      String(pid),
      "--all-commands",
      `--json-line=${monitorPrefix}`,
    );
  }
  args.push(...buildOutput(request.endpoint, request));

  return {
    args,
    endpointLabel: endpointLabel(request.endpoint),
  };
}

function buildOutput(
  endpoint: PlayoutEndpoint,
  request: StartPlayoutRequest,
): string[] {
  if (endpoint.protocol === "udp") {
    const packetBurst = Math.max(1, Math.min(128, Math.floor(endpoint.packetSize / 188)));
    const args = [
      "-O",
      "ip",
      "--packet-burst",
      String(packetBurst),
      "--ttl",
      String(endpoint.ttl),
    ];
    if (endpoint.localAddress && isMulticast(endpoint.host)) {
      args.push("--local-address", endpoint.localAddress);
    }
    args.push(`${formatHost(endpoint.host)}:${endpoint.port}`);
    return args;
  }

  if (endpoint.protocol === "srt") {
    const address = `${formatHost(endpoint.host)}:${endpoint.port}`;
    const args = ["-O", "srt", "--transtype", "live", "--latency", String(endpoint.latencyMs)];
    if (endpoint.mode === "caller") {
      args.push("--caller", address);
    } else if (endpoint.mode === "listener") {
      args.push("--listener", address);
    } else {
      args.push("--listener", `0.0.0.0:${endpoint.port}`, "--caller", address);
    }
    if (endpoint.passphrase) {
      args.push("--passphrase", endpoint.passphrase, "--pbkeylen", "16");
    }
    if (endpoint.streamId) {
      args.push("--streamid", endpoint.streamId);
    }
    args.push(
      "--payload-size",
      "1316",
      "--packet-burst",
      "7",
      "--max-bw",
      "0",
      "--input-bw",
      String(calculateTransportMuxRate(request)),
    );
    return args;
  }

  throw new Error("SCTE-35 injection is supported only for UDP and SRT MPEG-TS outputs");
}

export function calculateTransportMuxRate(request: StartPlayoutRequest): number {
  const videoRate = request.video.rateControl === "crf"
    ? request.video.targetBitrateKbps * 2
    : Math.max(request.video.targetBitrateKbps, request.video.maxBitrateKbps);
  const payloadKbps = videoRate + request.audio.bitrateKbps;
  return Math.ceil(Math.max(1_000, payloadKbps * 1.18 + 256) / 100) * 100_000;
}

function endpointLabel(endpoint: PlayoutEndpoint): string {
  if (endpoint.protocol === "udp") return `UDP ${endpoint.host}:${endpoint.port}`;
  if (endpoint.protocol === "srt") {
    return `SRT ${endpoint.mode} ${endpoint.host}:${endpoint.port}`;
  }
  return "RTMP (unsupported for SCTE-35)";
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isMulticast(host: string): boolean {
  const first = Number.parseInt(host.split(".")[0] ?? "", 10);
  return Number.isInteger(first) && first >= 224 && first <= 239;
}
