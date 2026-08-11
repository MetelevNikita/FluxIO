import type { PlayoutEndpoint, StartPlayoutRequest } from "@gruber/contracts";

export interface TsdDuckCommandOptions {
  cueFilePath: string | null;
  cueCount: number;
  inputPort: number;
  monitorPrefix?: string;
  request: StartPlayoutRequest;
  subtitles?: {
    inputPort: number;
    pmtPatchFilePath: string;
    tspPath: string;
  } | null;
}

export interface TsdDuckCommand {
  args: string[];
  endpointLabel: string;
}

const udpSocketBufferSizeBytes = 4 * 1_024 * 1_024;

export function buildTsdDuckCommand({
  cueFilePath,
  cueCount,
  inputPort,
  monitorPrefix = "GRUBER_SCTE35:",
  request,
  subtitles = null,
}: TsdDuckCommandOptions): TsdDuckCommand {
  const pid = request.scte35.pid;
  const transportMuxRate = calculateTransportMuxRate(request);
  const serviceId = request.endpoint.protocol === "udp"
    ? request.endpoint.mpegTs.serviceId
    : 1;
  const args = [
    "--bitrate",
    String(transportMuxRate),
    "-I",
    "ip",
    "--buffer-size",
    String(udpSocketBufferSizeBytes),
    "--local-address",
    "127.0.0.1",
    String(inputPort),
  ];

  if (request.scte35.enabled) {
    args.push(
      "-P",
      "pmt",
      "--service",
      String(serviceId),
      "--add-registration",
      "0x43554549",
      "--add-pid",
      `${pid}/0x86`,
      "--set-cue-type",
      `${pid}/0x01`,
    );
  }

  if (request.subtitleOutput.mode === "dvb" && subtitles) {
    args.push(
      "-P",
      "pmt",
      "--service",
      String(serviceId),
      "--add-pid",
      `${request.subtitleOutput.pid}/0x06`,
      "--increment-version",
      "-P",
      "pmt",
      "--service",
      String(serviceId),
      "--patch-xml",
      subtitles.pmtPatchFilePath,
      "--increment-version",
      "-P",
      "merge",
      "--bitrate",
      String(request.subtitleOutput.bitrateKbps * 1_000),
      "--no-psi-merge",
      "--no-pcr-restamp",
      "--max-queue",
      "4096",
      buildSubtitleMergeCommand(request, subtitles.inputPort, subtitles.tspPath),
      "-P",
      "pcrextract",
      "--pid",
      String(request.subtitleOutput.pid),
      "--pts",
      "--log",
    );
  }

  if (request.scte35.enabled && cueFilePath && cueCount > 0) {
    args.push(
      "-P",
      "spliceinject",
      "--service",
      String(serviceId),
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

  if (request.endpoint.protocol === "udp") {
    const requestedPcrPeriodMs = request.endpoint.mpegTs.pcrPeriodMs;
    args.push(
      "-P",
      "pcradjust",
      "--bitrate",
      String(transportMuxRate),
      "--pid",
      String(request.endpoint.mpegTs.videoPid),
      "--min-ms-interval",
      String(pcrInsertionThresholdMs(requestedPcrPeriodMs)),
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
  const monitoredPids = request.endpoint.protocol === "udp"
    ? [request.endpoint.mpegTs.videoPid, request.endpoint.mpegTs.audioPid]
    : [];
  if (request.subtitleOutput.mode === "dvb" && subtitles) {
    monitoredPids.push(request.subtitleOutput.pid);
  }
  if (monitoredPids.length > 0) {
    args.push("-P", "continuity");
    for (const monitoredPid of monitoredPids) {
      args.push("--pid", String(monitoredPid));
    }
    args.push("--tag", "FluxIO-output");
  }
  args.push(
    "-P",
    "regulate",
    "--bitrate",
    String(transportMuxRate),
    "--packet-burst",
    String(transportPacketBurst(request.endpoint)),
  );
  args.push(...buildOutput(request.endpoint, request));

  return {
    args,
    endpointLabel: endpointLabel(request.endpoint),
  };
}

export function pcrInsertionThresholdMs(requestedPeriodMs: number): number {
  // pcradjust inserts a PCR into the next available null packet only after the
  // threshold has elapsed. Keep a small margin so a configured 40 ms maximum
  // cannot become 40+ ms because of TS packet-grid quantization.
  return Math.max(1, Math.floor(requestedPeriodMs) - 2);
}

function buildOutput(
  endpoint: PlayoutEndpoint,
  request: StartPlayoutRequest,
): string[] {
  if (endpoint.protocol === "udp") {
    const packetBurst = transportPacketBurst(endpoint);
    const args = [
      "-O",
      "ip",
      "--buffer-size",
      String(udpSocketBufferSizeBytes),
      "--enforce-burst",
      "--packet-burst",
      String(packetBurst),
      "--ttl",
      String(endpoint.ttl),
    ];
    if (endpoint.localAddress) {
      args.push("--local-address", endpoint.localAddress);
      if (isMulticast(endpoint.host)) {
        args.push("--force-local-multicast-outgoing");
      }
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
  if (
    request.endpoint.protocol === "udp" &&
    request.endpoint.mpegTs.transportBitrateKbps > 0
  ) {
    return request.endpoint.mpegTs.transportBitrateKbps * 1_000;
  }
  const videoRate = videoPeakBitrateKbps(request);
  const payloadKbps = videoRate + request.audio.bitrateKbps + subtitlePayloadKbps(request);
  return Math.ceil(Math.max(1_000, payloadKbps * 1.18 + 256) / 100) * 100_000;
}

export function calculateMinimumTransportMuxRate(request: StartPlayoutRequest): number {
  const payloadKbps = videoPeakBitrateKbps(request) + request.audio.bitrateKbps +
    subtitlePayloadKbps(request);
  return Math.ceil(Math.max(1_000, payloadKbps * 1.08 + 128) / 100) * 100_000;
}

export function buildDvbSubtitlePmtPatch(request: StartPlayoutRequest): string {
  if (request.subtitleOutput.mode !== "dvb") {
    throw new Error("DVB subtitle PMT patch requested while burn-in mode is selected");
  }
  const subtitlingType = request.subtitleOutput.type === "hearing-impaired"
    ? "0x24"
    : "0x14";
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<tsduck>\n` +
    `  <PMT>\n` +
    `    <component elementary_PID="${request.subtitleOutput.pid}">\n` +
    `      <subtitling_descriptor x-node="add">\n` +
    `        <subtitling language_code="${request.subtitleOutput.language}" ` +
    `subtitling_type="${subtitlingType}" composition_page_id="1" ancillary_page_id="1"/>\n` +
    `      </subtitling_descriptor>\n` +
    `    </component>\n` +
    `  </PMT>\n` +
    `</tsduck>\n`;
}

function subtitlePayloadKbps(request: StartPlayoutRequest): number {
  return request.subtitleOutput.mode === "dvb" ? request.subtitleOutput.bitrateKbps : 0;
}

function buildSubtitleMergeCommand(
  request: StartPlayoutRequest,
  inputPort: number,
  tspPath: string,
): string {
  const command = [
    tspPath,
    "--bitrate",
    String(request.subtitleOutput.bitrateKbps * 1_000),
    "-I",
    "ip",
    "--buffer-size",
    String(udpSocketBufferSizeBytes),
    "--local-address",
    "127.0.0.1",
    String(inputPort),
    "-P",
    "filter",
    "--pid",
    String(request.subtitleOutput.pid),
    "--stuffing",
    "-O",
    "file",
    "-",
  ];
  return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  if (process.platform === "win32") {
    return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`;
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function videoPeakBitrateKbps(request: StartPlayoutRequest): number {
  if (request.video.rateControl === "cbr") return request.video.targetBitrateKbps;
  if (request.video.rateControl === "vbr") return request.video.maxBitrateKbps;
  return request.video.targetBitrateKbps * 2;
}

function transportPacketBurst(endpoint: PlayoutEndpoint): number {
  return endpoint.protocol === "udp"
    ? Math.max(1, Math.min(128, Math.floor(endpoint.packetSize / 188)))
    : 7;
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
  const firstOctet = Number.parseInt(host.split(".")[0] ?? "", 10);
  return Number.isInteger(firstOctet) && firstOctet >= 224 && firstOctet <= 239;
}
