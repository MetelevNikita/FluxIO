import type { PlayoutEndpoint, StartPlayoutRequest } from "@gruber/contracts";
import { endpointMpegTsSettings } from "@gruber/contracts";

export interface SubtitleTransport {
  inputPort: number;
  pmtPatchFilePath: string;
  tspPath: string;
}

export interface TsdDuckCommandOptions {
  cueFilePath: string | null;
  cueCount: number;
  inputPort: number;
  previewPort?: number | null;
  monitorPrefix?: string;
  request: StartPlayoutRequest;
  subtitles?: SubtitleTransport | null;
  /**
   * Локальные порты зеркал. С них выходы берут готовый мультиплекс программы:
   * общая обработка — PSI, метки, субтитры, PCR — делается один раз здесь.
   * Зеркала объявляются на всю сессию, даже если выход сейчас не в эфире, —
   * иначе включение второго выхода требовало бы пересборки этой стадии, то
   * есть обрыва первого.
   */
  mirrorPorts?: readonly number[];
  /** Стадия программы сама в эфир не отдаёт: этим заняты выходы. */
  silentOutput?: boolean;
}

export interface TsdDuckCommand {
  args: string[];
  endpointLabel: string;
}

const udpSocketBufferSizeBytes = 4 * 1_024 * 1_024;
const subtitleMergeQueuePackets = 256;

export function buildTsdDuckCommand({
  cueFilePath,
  cueCount,
  inputPort,
  monitorPrefix = "GRUBER_SCTE35:",
  mirrorPorts = [],
  previewPort = null,
  request,
  silentOutput = false,
  subtitles = null,
}: TsdDuckCommandOptions): TsdDuckCommand {
  const pid = request.scte35.pid;
  const transportMuxRate = calculateTransportMuxRate(request);
  // SRT несёт тот же MPEG-TS, что и UDP: служба, PID и интервал PCR берутся
  // из настроек выхода, а не подменяются умолчаниями.
  const mpegTs = endpointMpegTsSettings(request.endpoint);
  const serviceId = mpegTs.serviceId;
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
    const videoPid = mpegTs.videoPid;
    // merge обязан идти ДО обеих стадий pmt: TSDuck считает PID, уже объявленный
    // в PMT основного потока, конфликтующим и молча выбрасывает его из merged TS
    // (--ignore-conflicts на этот случай не действует). Объявляем subtitle PID
    // только после того, как его пакеты влиты в поток.
    args.push(
      "-P",
      "merge",
      "--bitrate",
      String(request.subtitleOutput.bitrateKbps * 1_000),
      "--no-psi-merge",
      "--no-pcr-restamp",
      // Очередь merge должна набраться, прежде чем начнётся вставка. Subtitle PID
      // отдаёт всего ~60 kbps, поэтому 4096 пакетов копятся около полутора минут —
      // за это время короткий ролик успевает закончиться, и в эфир не уходит ни
      // одного subtitle-пакета. 256 набирается за секунды и сохраняет запас на всплеск.
      "--max-queue",
      String(subtitleMergeQueuePackets),
      buildSubtitleMergeCommand(request, subtitles.inputPort, subtitles.tspPath),
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
      "filter",
      "--pid",
      String(request.subtitleOutput.pid),
      "--set-label",
      "31",
      "-P",
      "craft",
      "--only-label",
      "31",
      "--no-pcr",
      "-P",
      "pcrextract",
      "--pid",
      String(videoPid),
      "--pid",
      String(request.subtitleOutput.pid),
      "--pts",
      "--log",
    );
  }

  if (request.scte35.enabled && cueFilePath && cueCount > 0) {
    // Без --wait-first-batch. Этот флаг держит всю цепочку tsp, пока файл меток
    // не загрузится, а файл, который не загрузился (нет на диске, путь не
    // открылся, разбор отверг значение), держит её вечно и молча: выдача и
    // зеркало предпросмотра стоят, а FFmpeg продолжает рапортовать кадры. Без
    // флага эфир идёт, а отказ уходит в журнал. Чтобы первая метка не опоздала,
    // файл читается на первом же опросе: он дописан до запуска TSDuck, и ждать
    // его «устойчивости» незачем.
    args.push(
      "-P",
      "spliceinject",
      "--service",
      String(serviceId),
      "--pid",
      String(pid),
      "--files",
      cueFilePath,
      "--poll-interval",
      "100",
      "--min-stable-delay",
      "0",
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

  // Стадия транспорта поднимается только для MPEG-TS выходов, поэтому
  // интервал PCR выравнивается и на UDP, и на SRT.
  args.push(
    "-P",
    "pcradjust",
    "--bitrate",
    String(transportMuxRate),
    "--pid",
    String(mpegTs.videoPid),
    "--min-ms-interval",
    String(pcrInsertionThresholdMs(mpegTs.pcrPeriodMs)),
  );

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
  const monitoredPids = [mpegTs.videoPid, mpegTs.audioPid];
  if (request.subtitleOutput.mode === "dvb" && subtitles) {
    monitoredPids.push(request.subtitleOutput.pid);
  }
  if (monitoredPids.length > 0) {
    args.push("-P", "continuity", "--fix");
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
  if (previewPort != null) {
    args.push(
      "-P",
      "ip",
      "--buffer-size",
      String(udpSocketBufferSizeBytes),
      "--packet-burst",
      "7",
      `127.0.0.1:${previewPort}`,
    );
  }
  for (const port of mirrorPorts) {
    args.push(
      "-P",
      "ip",
      "--buffer-size",
      String(udpSocketBufferSizeBytes),
      "--packet-burst",
      "7",
      `127.0.0.1:${port}`,
    );
  }
  if (silentOutput) {
    args.push("-O", "drop");
  } else {
    args.push(...buildOutput(request.endpoint, transportMuxRate));
  }

  return {
    args,
    endpointLabel: silentOutput
      ? `Programme multiplex mirrored to ${mirrorPorts.length} output(s)`
      : endpointLabel(request.endpoint),
  };
}

/**
 * Транспортная стадия одного выхода.
 *
 * Берёт готовый мультиплекс с зеркала программы и только отдаёт его на свой
 * адрес. Общая обработка — PSI, метки SCTE-35, субтитры, выравнивание PCR —
 * уже сделана стадией программы: повторять её на каждом выходе значит и
 * платить трижды, и получить три разных мультиплекса из одной программы.
 *
 * Выравнивание скорости (`regulate`) остаётся у выхода: у SRT и UDP свои
 * всплески, и общий регулятор на зеркале их бы не сгладил.
 */
export function buildTsdDuckRelayCommand({
  bitrateBps,
  endpoint,
  inputPort,
}: {
  bitrateBps: number;
  endpoint: PlayoutEndpoint;
  inputPort: number;
}): TsdDuckCommand {
  const args = [
    "--bitrate",
    String(bitrateBps),
    "-I",
    "ip",
    "--buffer-size",
    String(udpSocketBufferSizeBytes),
    "--local-address",
    "127.0.0.1",
    String(inputPort),
    "-P",
    "regulate",
    "--bitrate",
    String(bitrateBps),
    "--packet-burst",
    String(transportPacketBurst(endpoint)),
    ...buildOutput(endpoint, bitrateBps),
  ];
  return { args, endpointLabel: endpointLabel(endpoint) };
}

export function pcrInsertionThresholdMs(requestedPeriodMs: number): number {
  // pcradjust inserts a PCR into the next available null packet only after the
  // threshold has elapsed. Keep a small margin so a configured 40 ms maximum
  // cannot become 40+ ms because of TS packet-grid quantization.
  return Math.max(1, Math.floor(requestedPeriodMs) - 2);
}

function buildOutput(
  endpoint: PlayoutEndpoint,
  transportMuxRateBps: number,
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
      String(transportMuxRateBps),
    );
    return args;
  }

  throw new Error("SCTE-35 injection is supported only for UDP and SRT MPEG-TS outputs");
}

export function calculateTransportMuxRate(request: StartPlayoutRequest): number {
  // У RTMP помощник отдаёт умолчания с нулём, поэтому ручная скорость
  // транспорта здесь недостижима — FLV мультиплекса и не имеет.
  const transportBitrateKbps = endpointMpegTsSettings(request.endpoint).transportBitrateKbps;
  if (transportBitrateKbps > 0) {
    return transportBitrateKbps * 1_000;
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
