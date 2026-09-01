import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, type Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
  ClipAudioOverlay,
  FfmpegCapabilities,
  GraphicEffectLayer,
  PlayoutStatus,
  SceneLayoutTarget,
  StartPlayoutRequest,
} from "@gruber/contracts";
import {
  barsPlayoutItem,
  barsSegmentSeconds,
  defaultMpegTsOutputSettings,
  isBarsSource,
  playoutStatusSchema,
  sceneFormatSchema,
} from "@gruber/contracts";
import {
  buildFfmpegClipAudioProducerCommand,
  buildFfmpegClipVideoProducerCommand,
  firstSceneFileDescriptor,
  type PreparedSceneShow,
  buildFfmpegProgramEncoderCommand,
  clipAudioByteCount,
  clipAudioSource,
  isSupportedLogoPath,
  programAudioTracks,
  type ClipAudioSource,
  type FfmpegCommand,
  type FfmpegCommandOptions,
  type PreparedPlayoutItem,
} from "./command-builder.js";
import { FfmpegCapabilitiesService } from "./capabilities.js";
import { endPipeQuietly, guardPipeErrors, isExpectedPipeError } from "./pipe-errors.js";
import { probeMedia } from "./probe.js";
import {
  hardwareSupportsInterlace,
  resolveVideoEncoder,
  type ResolvedVideoEncoder,
} from "./hardware-encoder.js";
import { planSceneShow } from "../scene/producer.js";
import { TsdDuckCapabilitiesService } from "../tsduck/capabilities.js";
import {
  buildScte35CueXml,
  planScte35Cues,
  type PlannedScte35Cue,
} from "../tsduck/cue-builder.js";
import {
  buildTsdDuckCommand,
  buildDvbSubtitlePmtPatch,
  calculateMinimumTransportMuxRate,
  calculateTransportMuxRate,
  type SubtitleTransport,
} from "../tsduck/command-builder.js";
import {
  buildGstreamerDvbSubtitleCommand,
  createGstreamerCapabilities,
  type GstreamerCapabilities,
} from "../subtitles/gstreamer.js";
import {
  buildDvbSubtitleProject,
  buildSubtitleTimeline,
  type SrtCue,
} from "../subtitles/srt-project.js";
import {
  dvbSubtitleClockToleranceMs,
  dvbSubtitlePreRollMs,
  evaluateDvbSubtitleClock,
} from "../transport-clock.js";
import {
  buildTransportPreviewCommand,
  transportPreviewPlaylistName,
} from "./transport-preview.js";

const previewPath = "/api/playout/preview/index.m3u8";
const transportPreviewPath = `/api/playout/preview/${transportPreviewPlaylistName}`;
const injectorStartupSafetyMs = 2_000;
const tsduckMonitorPrefix = "GRUBER_SCTE35:";
const consoleProgressIntervalSeconds = 5;
const playlistPreparationConcurrency = 8;
const clipProducerStartupTimeoutMs = 30_000;
const maximumSubtitleRestartAttempts = 3;
const minimumClipPipeBufferBytes = 1_048_576;
const clipAudioSilenceChunkBytes = 262_144;
const silenceChunk = Buffer.alloc(clipAudioSilenceChunkBytes);

type CloseResult = { code: number | null; signal: NodeJS.Signals | null } | null;

/** Один элементарный аудиопоток ролика: свой FFmpeg, свой pipe в encoder. */
interface ClipAudioRuntime {
  bridge: PassThrough;
  child: ChildProcessWithoutNullStreams;
  closeResult: CloseResult;
  ended: boolean;
  /** Сколько байт сырого PCM дорожка обязана отдать за ролик. */
  expectedBytes: number;
  label: string;
  paddedBytes: number;
  ready: boolean;
  writtenBytes: number;
}

interface ClipProducerRuntime {
  audio: ClipAudioRuntime[];
  child: ChildProcessWithoutNullStreams;
  index: number;
  readyLogged: boolean;
  videoBridge: PassThrough;
  videoCloseResult: CloseResult;
  videoEnded: boolean;
  videoReady: boolean;
}

export class PlayoutConflictError extends Error {}
export class PlayoutPreflightError extends Error {}
/**
 * Как событие уходит наружу.
 *
 * `quiet` — событие идёт в журнал и в статус, но не в консоль. Поток в
 * несколько строк в секунду консоли не по силам: на Windows запись в неё
 * синхронна, и однопоточная служба встаёт вместе с ней — вплоть до полной
 * остановки, если оператор щёлкнул внутри консольного окна. Решает это
 * supervisor, а не разбор текста снаружи: текст событий меняется.
 */
export interface PlayoutEventOptions {
  quiet?: boolean;
}

export type PlayoutEventSink = (entry: string, options?: PlayoutEventOptions) => void;

interface PreparedRequest {
  items: PreparedPlayoutItem[];
  request: StartPlayoutRequest;
}

type PreparationStage = "graphics" | "media";
type PreparationProgress = (
  stage: PreparationStage,
  completed: number,
  total: number,
) => void;

export function usesTsdDuckTransport(request: StartPlayoutRequest): boolean {
  return request.endpoint.protocol === "udp" || request.endpoint.protocol === "srt";
}

export class PlayoutSupervisor {
  readonly previewDirectory: string;
  /**
   * Точка входа графического процесса. Считается от собственного модуля, а не
   * от рабочего каталога: службу запускают и из корня репозитория, и юнитом.
   */
  readonly #sceneEntryPath = fileURLToPath(new URL("../scene/process-entry.js", import.meta.url));
  readonly capabilities: FfmpegCapabilitiesService;
  readonly tsduckCapabilities: TsdDuckCapabilitiesService;
  readonly gstreamerCapabilities: GstreamerCapabilities;
  #child: ChildProcessWithoutNullStreams | null = null;
  #tsduckChild: ChildProcessWithoutNullStreams | null = null;
  #subtitleChild: ChildProcessWithoutNullStreams | null = null;
  #transportPreviewChild: ChildProcessWithoutNullStreams | null = null;
  #producerChild: ChildProcessWithoutNullStreams | null = null;
  #prefetchedProducerChild: ChildProcessWithoutNullStreams | null = null;
  #producerRuntimes = new Map<ChildProcessWithoutNullStreams, ClipProducerRuntime>();
  /** Живые графические процессы: их надо гасить вместе с эфиром. */
  #sceneProducers = new Set<ChildProcessWithoutNullStreams>();

  #producerStartupTimer: NodeJS.Timeout | null = null;
  #expectedTsdDuckStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #expectedSubtitleStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #expectedTransportPreviewStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #expectedProducerStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #killTimer: NodeJS.Timeout | null = null;
  #tsduckKillTimer: NodeJS.Timeout | null = null;
  #subtitleKillTimer: NodeJS.Timeout | null = null;
  #transportPreviewKillTimer: NodeJS.Timeout | null = null;
  #transportPreviewRestartTimer: NodeJS.Timeout | null = null;
  #request: StartPlayoutRequest | null = null;
  #items: PreparedPlayoutItem[] = [];
  /** Кодировщик, выбранный на старте сессии; `null` — эфир ещё не готовился. */
  #videoEncoder: ResolvedVideoEncoder | null = null;
  /**
   * Момент, когда ролик `index` реально ушёл в эфир. От него считается эфирное
   * время всех последующих роликов: их рендереры стартуют заранее, поэтому
   * системные часы рендерера показали бы будущее.
   */
  #airEpochAnchor: { index: number; epochSeconds: number } | null = null;
  #commandArgs: string[] = [];
  #tsduckArgs: string[] = [];
  #subtitleArgs: string[] = [];
  #transportPreviewArgs: string[] = [];
  #subtitleFirstCueStartSeconds: number | null = null;
  #subtitlePreRollMs = 0;
  /** Реплики на программной шкале: из них пересобирается файл при рестарте. */
  #subtitleProgramCues: SrtCue[] = [];
  #subtitleInputPort: number | null = null;
  #subtitleRestartAttempts = 0;
  #subtitleRestartTimer: NodeJS.Timeout | null = null;
  #subtitleResumeCount = 0;
  #gstreamerVersionReported = false;
  #firstSubtitlePtsMs: number | null = null;
  #subtitleClockReport: "aligned" | "mismatch" | null = null;
  #cues: PlannedScte35Cue[] = [];
  #observedCueKeys = new Set<string>();
  #status: PlayoutStatus = idleStatus();
  #progressBuffer = "";
  #logBuffer = "";
  #tsduckLogBuffer = "";
  #subtitleLogBuffer = "";
  #transportPreviewLogBuffer = "";
  #transportPreviewRestartAttempts = 0;
  #lastLoggedFrame = -1;
  #lastConsoleProgressSeconds = Number.NEGATIVE_INFINITY;
  #lastConsoleItemIndex = -1;
  #takeInProgress = false;
  #eventSink: PlayoutEventSink | null;

  constructor(
    capabilities: FfmpegCapabilitiesService,
    previewDirectory: string,
    eventSink: PlayoutEventSink | null = null,
    tsduckCapabilities = new TsdDuckCapabilitiesService(),
    gstreamerCapabilities = createGstreamerCapabilities(),
  ) {
    this.capabilities = capabilities;
    this.previewDirectory = previewDirectory;
    this.#eventSink = eventSink;
    this.tsduckCapabilities = tsduckCapabilities;
    this.gstreamerCapabilities = gstreamerCapabilities;
  }

  getStatus(): PlayoutStatus {
    this.#updateNextCue();
    return playoutStatusSchema.parse({
      ...this.#status,
      scte35: { ...this.#status.scte35 },
      subtitles: { ...this.#status.subtitles },
      logs: [...this.#status.logs],
    });
  }

  getAudioLevelDbfs(): number | null {
    return this.#status.audioLevelDbfs;
  }

  async start(request: StartPlayoutRequest): Promise<PlayoutStatus> {
    if (this.#takeInProgress) {
      throw new PlayoutConflictError("A hot take is already in progress");
    }
    return this.#startPrepared(withBarsFallback(request));
  }

  async take(request: StartPlayoutRequest): Promise<PlayoutStatus> {
    if (this.#takeInProgress) {
      throw new PlayoutConflictError("A hot take is already in progress");
    }
    const active = Boolean(
      this.#child || this.#tsduckChild || this.#subtitleChild || this.#transportPreviewChild,
    ) ||
      ["starting", "running", "stopping"].includes(this.#status.state);
    if (!active) return this.start(request);

    this.#takeInProgress = true;
    try {
      // Validate and probe the replacement before interrupting the on-air process.
      const prepared = await this.#prepareRequest(request);
      this.#appendEvent(`Hot take requested from clip "${request.playlist[0]?.name ?? "unknown"}"`);
      await this.stop();
      await waitForPlayoutStop(() => Boolean(
        this.#child || this.#tsduckChild || this.#subtitleChild || this.#transportPreviewChild,
      ) ||
        ["starting", "running", "stopping"].includes(this.#status.state));
      const status = await this.#startPrepared(request, prepared);
      this.#appendEvent(`Hot take is on air from clip "${request.playlist[0]?.name ?? "unknown"}"`);
      return status;
    } finally {
      this.#takeInProgress = false;
    }
  }

  async #startPrepared(
    request: StartPlayoutRequest,
    prepared?: PreparedRequest,
  ): Promise<PlayoutStatus> {
    if (
      this.#child ||
      this.#tsduckChild ||
      this.#subtitleChild ||
      this.#transportPreviewChild ||
      ["starting", "running", "stopping"].includes(this.#status.state)
    ) {
      throw new PlayoutConflictError("A playout session is already active");
    }

    this.#request = request;
    this.#status = {
      ...idleStatus(),
      state: "starting",
      sessionId: randomUUID(),
      startedAt: new Date().toISOString(),
      totalItems: request.playlist.length,
      currentItemId: request.playlist[0]?.id ?? null,
      currentItemName: request.playlist[0]?.name ?? null,
      transportBitrateBps: request.endpoint.protocol === "udp"
        ? calculateTransportMuxRate(request)
        : null,
      transportBitrateMode: request.endpoint.protocol === "udp"
        ? request.endpoint.mpegTs.transportBitrateKbps > 0 ? "manual" : "auto"
        : null,
      repeatPlaylist: request.repeatPlaylist,
      queuedFutureItems: request.nextPlaylist.length,
      scte35: {
        ...idleStatus().scte35,
        enabled: request.scte35.enabled,
        state: request.scte35.enabled ? "starting" : "disabled",
        pid: request.scte35.enabled ? request.scte35.pid : null,
      },
      subtitles: {
        ...idleStatus().subtitles,
        enabled: request.subtitleOutput.mode === "dvb",
        state: request.subtitleOutput.mode === "dvb" ? "starting" : "disabled",
        pid: request.subtitleOutput.mode === "dvb" ? request.subtitleOutput.pid : null,
        language: request.subtitleOutput.mode === "dvb" ? request.subtitleOutput.language : null,
      },
    };
    const declaredDurationSeconds = request.playlist.reduce(
      (total, item) => total + (item.declaredDurationSeconds ?? item.sourceDurationSeconds ?? 0),
      0,
    );
    this.#appendEvent(
      `Preparing ${request.playlist.length}-clip schedule` +
        (declaredDurationSeconds > 0
          ? ` (${(declaredDurationSeconds / 3_600).toFixed(1)} hours)`
          : "") +
        ` with ${playlistPreparationConcurrency} parallel media checks`,
    );

    try {
      const next = prepared ?? await this.#prepareRequest(request);
      const resolvedRequest = next.request;
      this.#request = resolvedRequest;
      this.#items = next.items;
      await rm(this.previewDirectory, { force: true, recursive: true });
      await mkdir(this.previewDirectory, { recursive: true });
      await this.#prepareLoopCommands();
      this.#appendEvent(`Starting ${request.playlist.length} clip playout`);
      if (resolvedRequest.audio.loudnessNormalization.enabled) {
        const loudness = resolvedRequest.audio.loudnessNormalization;
        this.#appendEvent(
          `Audio normalization active: ${loudness.targetLufs.toFixed(1)} LUFS, ` +
            `${loudness.truePeakDbtp.toFixed(1)} dBTP, LRA ${loudness.loudnessRangeLufs.toFixed(1)} LU`,
        );
      }
      if (resolvedRequest.endpoint.protocol === "udp") {
        const transportRate = calculateTransportMuxRate(resolvedRequest);
        this.#appendEvent(
          `UDP CBR transport ${formatMbps(transportRate)} Mbps with null PID 0x1FFF stuffing; ` +
            `packet ${resolvedRequest.endpoint.packetSize} bytes, ` +
            `${resolvedRequest.endpoint.mpegTs.transportBitrateKbps > 0 ? "manual" : "Auto"} muxrate`,
        );
      }
      if (usesTsdDuckTransport(resolvedRequest)) {
        await this.#spawnTsdDuck();
        await this.#spawnTransportPreview();
      }
      if (this.#subtitleArgs.length > 0) {
        await this.#spawnDvbSubtitles();
      }
      const child = this.#spawnPreparedFfmpeg();
      await waitForSpawn(child);
      return this.getStatus();
    } catch (error) {
      this.#terminateTsdDuck();
      this.#terminateDvbSubtitles();
      this.#terminateTransportPreview();
      this.#terminateFfmpeg();
      this.#status.state = "failed";
      this.#status.stoppedAt = new Date().toISOString();
      this.#status.error = error instanceof Error ? error.message : "Unknown start error";
      if (this.#status.scte35.enabled && this.#status.scte35.state !== "running") {
        this.#status.scte35.state = "failed";
        this.#status.scte35.error = this.#status.error;
      }
      if (this.#status.subtitles.enabled && this.#status.subtitles.state !== "running") {
        this.#status.subtitles.state = "failed";
        this.#status.subtitles.error = this.#status.error;
      }
      this.#appendEvent(`Start failed: ${this.#status.error}`);
      throw error;
    }
  }

  async #prepareRequest(request: StartPlayoutRequest): Promise<PreparedRequest> {
    const capabilities = await this.capabilities.get();
    validateCapabilities(capabilities, request);
    // Кодировщик выбирается один раз на сессию: набор ускорителей за время
    // эфира не меняется, а пересчитывать его на каждую пересборку команды
    // значит дёргать FFmpeg посреди выдачи.
    this.#videoEncoder = resolveVideoEncoder(request.video, capabilities.videoEncoders);
    if (usesTsdDuckTransport(request)) {
      await this.tsduckCapabilities.getVersion();
      if (request.endpoint.protocol === "srt") {
        await this.tsduckCapabilities.assertSrtSupport();
      }
    }
    if (request.subtitleOutput.mode === "dvb") {
      await this.gstreamerCapabilities.assertDvbSubtitlesAvailable();
    }
    const reportProgress: PreparationProgress = (stage, completed, total) => {
      if (completed === total || completed === 1 || completed % 50 === 0) {
        this.#appendEvent(
          `${stage === "graphics" ? "Graphics" : "Media"} preparation: ` +
            `${completed}/${total} clip(s) checked`,
        );
      }
    };
    const resolvedRequest = await resolveGraphics(request, reportProgress);
    const ignoredSubtitles = request.playlist.filter((item, index) =>
      item.subtitles?.enabled && !resolvedRequest.playlist[index]?.subtitles?.enabled
    );
    if (ignoredSubtitles.length > 0) {
      this.#appendEvent(
        `SRT subtitles ignored for ${ignoredSubtitles.length} clip(s): matching files are unavailable`,
      );
    }
    return {
      items: await prepareItems(
        resolvedRequest,
        this.capabilities.ffprobePath,
        reportProgress,
      ),
      request: resolvedRequest,
    };
  }

  async stop(): Promise<PlayoutStatus> {
    const child = this.#child;
    if (!child && !this.#tsduckChild && !this.#subtitleChild && !this.#transportPreviewChild) {
      return this.getStatus();
    }
    if (this.#status.state !== "stopping") {
      this.#status.state = "stopping";
      this.#appendEvent("Graceful stop requested");
      this.#terminateTsdDuck();
      this.#terminateDvbSubtitles();
      this.#terminateTransportPreview();
      this.#terminateClipProducers();
      child?.kill("SIGTERM");
      if (child) {
        this.#killTimer = setTimeout(() => {
          if (this.#child === child) {
            this.#appendEvent("FFmpeg did not stop in time; sending SIGKILL");
            child.kill("SIGKILL");
          }
        }, 5_000);
        this.#killTimer.unref();
      } else {
        this.#status.state = "idle";
        this.#status.stoppedAt = new Date().toISOString();
      }
    }
    return this.getStatus();
  }

  updateNextPlaylist(nextPlaylist: StartPlayoutRequest["nextPlaylist"]): PlayoutStatus {
    if (
      !this.#request ||
      this.#status.schedulePhase !== "current" ||
      !["starting", "running"].includes(this.#status.state)
    ) {
      throw new PlayoutConflictError(
        "Future schedule can only be updated while the Current schedule is on air",
      );
    }
    this.#request = { ...this.#request, nextPlaylist };
    this.#status.queuedFutureItems = nextPlaylist.length;
    this.#appendEvent(`Future schedule updated: ${nextPlaylist.length} clip(s) queued`);
    return this.getStatus();
  }

  async updatePlaylist(playlist: StartPlayoutRequest["playlist"]): Promise<PlayoutStatus> {
    const request = this.#request;
    if (
      !request ||
      this.#status.schedulePhase !== "current" ||
      !["starting", "running"].includes(this.#status.state)
    ) {
      throw new PlayoutConflictError(
        "The Current playlist can only be updated while rolling playout is on air",
      );
    }
    const activeIndexBeforePreparation = this.#status.currentItemIndex;
    const alignedPlaylist = alignHotChangePlaylist(
      request.playlist,
      playlist,
      activeIndexBeforePreparation,
      this.#status.currentItemId,
    );
    assertPlaylistPrefixUnchanged(this.#items, alignedPlaylist, activeIndexBeforePreparation);
    const existingById = new Map(request.playlist.map((item, index) => [item.id, {
      item,
      prepared: this.#items[index],
    }]));
    const preparedTail = await mapWithConcurrency(
      alignedPlaylist.slice(activeIndexBeforePreparation + 1),
      playlistPreparationConcurrency,
      async (item) => {
        const existing = existingById.get(item.id);
        if (existing?.prepared && JSON.stringify(existing.item) === JSON.stringify(item)) {
          return { item, prepared: existing.prepared };
        }
        const resolved = await this.#prepareRequest({
          ...request,
          playlist: [item],
          nextPlaylist: [],
        });
        return { item: resolved.request.playlist[0]!, prepared: resolved.items[0]! };
      },
    );
    const resolvedPlaylist = [
      ...request.playlist.slice(0, activeIndexBeforePreparation + 1),
      ...preparedTail.map((entry) => entry.item),
    ];
    const resolvedItems = [
      ...this.#items.slice(0, activeIndexBeforePreparation + 1),
      ...preparedTail.map((entry) => entry.prepared),
    ];
    if (!["starting", "running"].includes(this.#status.state)) {
      throw new PlayoutConflictError("HOT CHANGE was cancelled because playout stopped");
    }
    const activeIndex = this.#status.currentItemIndex;
    assertPlaylistPrefixUnchanged(this.#items, resolvedPlaylist, activeIndex);
    for (let index = activeIndexBeforePreparation + 1; index <= activeIndex; index += 1) {
      if (JSON.stringify(request.playlist[index]) !== JSON.stringify(resolvedPlaylist[index])) {
        throw new PlayoutConflictError(
          `HOT CHANGE missed clip ${index + 1} because it is already on air`,
        );
      }
    }
    const oldNext = this.#items[activeIndex + 1];
    const newNext = resolvedItems[activeIndex + 1];
    this.#items = [
      ...this.#items.slice(0, activeIndex + 1),
      ...resolvedItems.slice(activeIndex + 1),
    ];
    this.#request = {
      ...request,
      playlist: [
        ...request.playlist.slice(0, activeIndex + 1),
        ...resolvedPlaylist.slice(activeIndex + 1),
      ],
    };
    this.#status.totalItems = this.#items.length;
    this.#status.totalDurationSeconds = this.#items.reduce(
      (total, item) => total + item.durationSeconds,
      0,
    );
    if (JSON.stringify(oldNext) !== JSON.stringify(newNext)) {
      const prefetched = this.#prefetchedProducerChild;
      if (prefetched) {
        this.#terminateClipProducer(prefetched);
      }
      this.#prefetchedProducerChild = newNext
        ? this.#spawnClipProducer(activeIndex + 1)
        : null;
      this.#appendEvent(
        `HOT CHANGE armed for clip ${activeIndex + 2}: ` +
          `"${newNext?.name ?? "end of playlist"}"`,
      );
    }
    return this.getStatus();
  }

  async close(): Promise<void> {
    await this.stop();
  }

  async #prepareLoopCommands(): Promise<void> {
    const request = this.#request;
    if (!request) throw new Error("Playout request is not prepared");

    this.#resetLoopState(request);

    if (!usesTsdDuckTransport(request)) {
      this.#prepareDirectEncoderCommand(request);
      return;
    }

    if (request.scte35.enabled) validateScte35Cues(request, this.#cues);

    const inputPort = await reserveUdpPort();
    const transportPreviewPort = await reserveDistinctUdpPort(inputPort);
    const cueFilePath = await this.#writeScte35CueFile(request);
    const subtitleTransport = await this.#prepareDvbSubtitleTransport(request);

    const internalEndpoint = {
      protocol: "udp" as const,
      host: "127.0.0.1",
      port: inputPort,
      packetSize: 1_316,
      ttl: 1,
      localAddress: "",
      mpegTs: request.endpoint.protocol === "udp"
        ? { ...request.endpoint.mpegTs }
        : { ...defaultMpegTsOutputSettings },
    };
    const command = this.#buildRollingEncoderCommand(request, {
      forceKeyFramesSeconds: request.scte35.enabled
        ? this.#cues.map((cue) => cue.programTimeSeconds)
        : undefined,
      programEndpoint: internalEndpoint,
      transportMuxRateBps: calculateTransportMuxRate(request),
    });
    const tsduck = buildTsdDuckCommand({
      cueCount: this.#cues.length,
      cueFilePath,
      inputPort,
      monitorPrefix: tsduckMonitorPrefix,
      previewPort: transportPreviewPort,
      request,
      subtitles: subtitleTransport,
    });
    this.#commandArgs = command.args;
    this.#tsduckArgs = tsduck.args;
    this.#transportPreviewArgs = buildTransportPreviewCommand({
      inputPort: transportPreviewPort,
      previewDirectory: this.previewDirectory,
    });
    this.#applyCommandStatus(command.totalDurationSeconds, tsduck.endpointLabel);
  }

  /** Сбрасывает SCTE-35 и subtitle-состояние перед подготовкой нового цикла. */
  #resetLoopState(request: StartPlayoutRequest): void {
    this.#cues = request.scte35.enabled
      ? planScte35Cues(request, this.#items, this.#status.loopCount)
      : [];
    this.#observedCueKeys.clear();

    this.#status.scte35.plannedEvents = this.#cues.length;
    this.#status.scte35.observedEvents = 0;
    this.#status.scte35.lastEventId = null;
    this.#status.scte35.error = null;

    this.#status.subtitles.error = null;
    this.#status.subtitles.plannedCues = 0;
    this.#status.subtitles.sourceItems = 0;
    this.#status.subtitles.observedPes = 0;
    this.#status.subtitles.lastPtsMs = null;
    this.#status.subtitles.videoPtsOriginMs = null;
    this.#status.subtitles.clockErrorMs = null;
    this.#status.subtitles.clockSynchronized = null;

    this.#subtitleArgs = [];
    this.#transportPreviewArgs = [];
    this.#transportPreviewRestartAttempts = 0;
    this.#subtitleFirstCueStartSeconds = null;
    this.#subtitlePreRollMs = 0;
    this.#subtitleProgramCues = [];
    this.#subtitleInputPort = null;
    this.#subtitleRestartAttempts = 0;
    this.#subtitleResumeCount = 0;
    this.#gstreamerVersionReported = false;
    this.#firstSubtitlePtsMs = null;
    this.#subtitleClockReport = null;
  }

  /** RTMP(S): encoder отдаёт поток напрямую, без TSDuck transport. */
  #prepareDirectEncoderCommand(request: StartPlayoutRequest): void {
    const command = this.#buildRollingEncoderCommand(request, {
      transportMuxRateBps: request.endpoint.protocol === "udp"
        ? calculateTransportMuxRate(request)
        : undefined,
    });

    this.#commandArgs = command.args;
    this.#tsduckArgs = [];
    this.#applyCommandStatus(command.totalDurationSeconds, command.endpointLabel);
  }

  async #writeScte35CueFile(request: StartPlayoutRequest): Promise<string | null> {
    if (!request.scte35.enabled) return null;
    if (this.#cues.length === 0) return null;

    const cueFilePath = path.join(
      this.previewDirectory,
      `scte35-loop-${this.#status.loopCount}.xml`,
    );
    await writeFile(cueFilePath, buildScte35CueXml(request, this.#cues), "utf8");

    return cueFilePath;
  }

  /**
   * Готовит отдельный DVB subtitle PID: собирает cue всех роликов в общий
   * program timeline и поднимает GStreamer-ветку. null — subtitle PID не нужен.
   */
  async #prepareDvbSubtitleTransport(
    request: StartPlayoutRequest,
  ): Promise<SubtitleTransport | null> {
    if (request.subtitleOutput.mode !== "dvb") return null;

    const project = await buildDvbSubtitleProject(this.#items, dvbSubtitlePreRollMs / 1_000);
    this.#status.subtitles.plannedCues = project.cueCount;
    this.#status.subtitles.sourceItems = project.sourceItems;
    this.#subtitleFirstCueStartSeconds = project.firstCueStartSeconds;
    this.#subtitlePreRollMs = Math.round(project.preRollSeconds * 1_000);
    this.#subtitleProgramCues = project.cues;
    if (project.sanitizedCues > 0) {
      this.#appendEvent(
        `Subtitle markup cleaned up in ${project.sanitizedCues} cue(s) before handing them to GStreamer`,
      );
    }

    if (project.cueCount === 0) {
      this.#status.subtitles.state = "completed";
      this.#appendEvent(
        "DVB subtitles enabled, but the selected playlist contains no valid SRT cues",
      );
      return null;
    }

    const subtitleInputPath = path.join(
      this.previewDirectory,
      `dvb-subtitles-loop-${this.#status.loopCount}.srt`,
    );
    const pmtPatchFilePath = path.join(this.previewDirectory, "dvb-subtitles-pmt.xml");
    const subtitleInputPort = await reserveUdpPort();
    this.#subtitleInputPort = subtitleInputPort;

    await writeFile(subtitleInputPath, project.content, "utf8");
    await writeFile(pmtPatchFilePath, buildDvbSubtitlePmtPatch(request), "utf8");

    this.#subtitleArgs = buildGstreamerDvbSubtitleCommand({
      inputPath: subtitleInputPath,
      outputPort: subtitleInputPort,
      preRollMs: this.#subtitlePreRollMs,
      request,
    });

    return {
      inputPort: subtitleInputPort,
      pmtPatchFilePath,
      tspPath: this.tsduckCapabilities.tspPath,
    };
  }

  #buildRollingEncoderCommand(
    request: StartPlayoutRequest,
    options: FfmpegCommandOptions,
  ): FfmpegCommand {
    options = { ...options, videoEncoder: this.#videoEncoder ?? undefined };
    const firstItem = this.#items[0];
    if (!firstItem) throw new Error("Playlist is empty");
    const totalDurationSeconds = this.#items.reduce(
      (total, item) => total + item.durationSeconds,
      0,
    );
    const command = buildFfmpegProgramEncoderCommand(
      request,
      firstItem,
      this.previewDirectory,
      totalDurationSeconds,
      options,
    );
    this.#appendEvent(
      `Rolling playout prepared: persistent encoder, one active clip and one prefetched clip; ` +
        `${this.#items.length} total clip(s) stay outside the encoder command line`,
    );
    return command;
  }

  #applyCommandStatus(totalDurationSeconds: number, endpointLabel: string): void {
    this.#status.totalDurationSeconds = totalDurationSeconds;
    this.#status.endpointLabel = endpointLabel;
    const previewVersion = new URLSearchParams({
      loop: String(this.#status.loopCount),
      phase: this.#status.schedulePhase,
      session: this.#status.sessionId ?? "starting",
    });
    const selectedPreviewPath = this.#transportPreviewArgs.length > 0
      ? transportPreviewPath
      : previewPath;
    this.#status.previewPath = `${selectedPreviewPath}?${previewVersion}`;
  }

  #readProgress(chunk: Buffer): void {
    this.#progressBuffer += chunk.toString("utf8");
    const lines = this.#progressBuffer.split(/\r?\n/);
    this.#progressBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      this.#applyProgress(line.slice(0, separator), line.slice(separator + 1));
    }
  }

  #applyProgress(key: string, value: string): void {
    if (key === "out_time_us") {
      this.#status.outTimeSeconds = Math.max(0, numberValue(value) / 1_000_000);
      this.#updateDerivedProgress();
    } else if (key === "frame") {
      this.#status.frame = Math.max(0, Math.round(numberValue(value)));
    } else if (key === "fps") {
      this.#status.fps = Math.max(0, numberValue(value));
    } else if (key === "bitrate") {
      this.#status.bitrateKbps = Math.max(0, numberValue(value.replace("kbits/s", "")));
    } else if (key === "speed") {
      this.#status.speed = Math.max(0, numberValue(value.replace("x", "")));
    } else if (key === "progress") {
      this.#appendFrameProgressLog();
    }
  }

  #appendFrameProgressLog(): void {
    if (this.#status.frame === this.#lastLoggedFrame) return;
    this.#lastLoggedFrame = this.#status.frame;
    const progressLog = formatFrameProgressLog({
      bitrateKbps: this.#status.bitrateKbps,
      fps: this.#status.fps,
      frame: this.#status.frame,
      outTimeSeconds: this.#status.outTimeSeconds,
    });
    this.#appendLog(progressLog);
    if (
      this.#eventSink &&
      shouldReportEncodingActivity({
        currentItemIndex: this.#status.currentItemIndex,
        lastItemIndex: this.#lastConsoleItemIndex,
        lastOutTimeSeconds: this.#lastConsoleProgressSeconds,
        outTimeSeconds: this.#status.outTimeSeconds,
      })
    ) {
      this.#lastConsoleProgressSeconds = this.#status.outTimeSeconds;
      this.#lastConsoleItemIndex = this.#status.currentItemIndex;
      this.#eventSink(formatEncodingActivity({
        bitrateKbps: this.#status.bitrateKbps,
        currentItemIndex: this.#status.currentItemIndex,
        currentItemName: this.#status.currentItemName,
        fps: this.#status.fps,
        frame: this.#status.frame,
        outTimeSeconds: this.#status.outTimeSeconds,
        speed: this.#status.speed,
        totalItems: this.#status.totalItems,
      }));
    }
  }

  #updateDerivedProgress(): void {
    const total = this.#status.totalDurationSeconds;
    this.#status.progressPercent = total > 0
      ? Math.min(100, (this.#status.outTimeSeconds / total) * 100)
      : 0;
    let elapsed = 0;
    let currentIndex = Math.max(0, this.#items.length - 1);
    for (let index = 0; index < this.#items.length; index += 1) {
      const duration = this.#items[index]?.durationSeconds ?? 0;
      if (
        this.#status.outTimeSeconds < elapsed + duration ||
        index === this.#items.length - 1
      ) {
        currentIndex = index;
        break;
      }
      elapsed += duration;
    }
    this.#status.currentItemIndex = currentIndex;
    this.#status.currentItemId = this.#items[currentIndex]?.id ?? null;
    this.#status.currentItemName = this.#items[currentIndex]?.name ?? null;
    const currentDuration = this.#items[currentIndex]?.durationSeconds ?? 0;
    this.#status.currentItemDurationSeconds = currentDuration;
    this.#status.currentItemElapsedSeconds = Math.min(
      currentDuration,
      Math.max(0, this.#status.outTimeSeconds - elapsed),
    );
    this.#status.currentItemProgressPercent = currentDuration > 0
      ? Math.min(100, (this.#status.currentItemElapsedSeconds / currentDuration) * 100)
      : 0;
    this.#updateNextCue();
  }

  #updateNextCue(): void {
    if (!this.#status.scte35.enabled) return;
    const next = this.#cues.find(
      (cue) => cue.programTimeSeconds >= this.#status.outTimeSeconds,
    );
    this.#status.scte35.nextEventId = next?.eventId ?? null;
    this.#status.scte35.nextEventInSeconds = next
      ? Math.max(0, next.programTimeSeconds - this.#status.outTimeSeconds)
      : null;
  }

  #readLogs(chunk: Buffer): void {
    this.#logBuffer += chunk.toString("utf8");
    const lines = this.#logBuffer.split(/\r?\n/);
    this.#logBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !/^frame:\d+\s+pts:/i.test(trimmed)) {
        this.#appendLog(redactSecrets(trimmed, this.#request));
      }
    }
  }

  #readTsdDuckLogs(chunk: Buffer): void {
    this.#tsduckLogBuffer += chunk.toString("utf8");
    const lines = this.#tsduckLogBuffer.split(/\r?\n/);
    this.#tsduckLogBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const marker = line.indexOf(tsduckMonitorPrefix);
      if (marker >= 0) {
        this.#handleTsdDuckMonitorJson(line.slice(marker + tsduckMonitorPrefix.length));
      } else if (this.#handleDvbClockPtsLog(line)) {
        continue;
      } else if (isTsdDuckContinuityWarning(line)) {
        const message = redactSecrets(line.trim(), this.#request);
        this.#status.continuityErrors += 1;
        this.#appendEvent(`TSDuck continuity warning #${this.#status.continuityErrors}: ${message}`);
      } else if (/\b(error|failed|dropping|obsolete)\b/i.test(line)) {
        const message = redactSecrets(line.trim(), this.#request);
        this.#appendEvent(`TSDuck: ${message}`);
        if (this.#status.scte35.enabled && /dropping|obsolete/i.test(line)) {
          this.#status.scte35.state = "failed";
          this.#status.scte35.error = "One or more SCTE-35 cues were too late and were dropped";
        }
      }
    }
  }

  #handleDvbClockPtsLog(line: string): boolean {
    const subtitlePid = this.#status.subtitles.pid;
    const videoPid = this.#request?.endpoint.protocol === "udp"
      ? this.#request.endpoint.mpegTs.videoPid
      : defaultMpegTsOutputSettings.videoPid;
    if (
      !this.#status.subtitles.enabled ||
      subtitlePid == null ||
      !line.includes("pcrextract:")
    ) {
      return false;
    }
    const match = line.match(/PID:\s+0x[0-9A-F]+\s+\((\d+)\),\s+PTS:\s+0x([0-9A-F]+)/i);
    if (!match) return false;
    const pid = Number(match[1]);
    if (pid !== videoPid && pid !== subtitlePid) return false;
    const pts = Number.parseInt(match[2] ?? "", 16);
    if (!Number.isFinite(pts)) return false;
    const ptsMs = Math.max(0, Math.round(pts / 90));
    if (pid === videoPid) {
      if (
        this.#status.subtitles.videoPtsOriginMs == null ||
        ptsMs < this.#status.subtitles.videoPtsOriginMs
      ) {
        this.#status.subtitles.videoPtsOriginMs = ptsMs;
        this.#evaluateDvbSubtitleClock();
      }
      return true;
    }
    this.#status.subtitles.observedPes += 1;
    this.#status.subtitles.lastPtsMs = ptsMs;
    this.#firstSubtitlePtsMs ??= ptsMs;
    this.#evaluateDvbSubtitleClock();
    // Пакет субтитров наблюдается по несколько раз в секунду: в журнале это
    // доказательство того, что дорожка реально идёт в эфир, а в консоли —
    // поток, который её же и останавливает.
    this.#appendEvent(
      `DVB subtitle PES #${this.#status.subtitles.observedPes} observed in final TS ` +
        `on PID ${pid} at PTS ${formatClock(ptsMs / 1_000)}`,
      { quiet: true },
    );
    return true;
  }

  #evaluateDvbSubtitleClock(): void {
    const videoPtsOriginMs = this.#status.subtitles.videoPtsOriginMs;
    const subtitlePtsMs = this.#firstSubtitlePtsMs;
    const cueStartSeconds = this.#subtitleFirstCueStartSeconds;
    if (videoPtsOriginMs == null || subtitlePtsMs == null || cueStartSeconds == null) return;
    const configuredOffsetMs = this.#request?.subtitleOutput.ptsOffsetMs ?? 0;
    const { clockErrorMs, synchronized } = evaluateDvbSubtitleClock({
      videoPtsOriginMs,
      subtitlePtsMs,
      firstCueStartSeconds: cueStartSeconds,
      configuredOffsetMs,
    });
    this.#status.subtitles.clockErrorMs = clockErrorMs;
    this.#status.subtitles.clockSynchronized = synchronized;
    const summary = `video origin ${formatClockWithMilliseconds(videoPtsOriginMs)}, ` +
      `first subtitle PTS ${formatClockWithMilliseconds(subtitlePtsMs)}, ` +
      `clock error ${formatSignedMilliseconds(clockErrorMs)}`;
    if (synchronized) {
      if (this.#status.subtitles.error?.startsWith("DVB subtitle clock mismatch")) {
        this.#status.subtitles.error = null;
      }
      if (this.#subtitleClockReport === "aligned") return;
      this.#subtitleClockReport = "aligned";
      this.#appendEvent(`DVB subtitle clock synchronized: ${summary}`);
    } else {
      const error = `DVB subtitle clock mismatch: ${summary}; ` +
        `allowed ±${dvbSubtitleClockToleranceMs} ms`;
      this.#status.subtitles.error = error;
      if (this.#subtitleClockReport === "mismatch") return;
      this.#subtitleClockReport = "mismatch";
      this.#appendEvent(error);
    }
  }

  #handleTsdDuckMonitorJson(value: string): void {
    try {
      const event = JSON.parse(value) as Record<string, unknown>;
      if (event["#name"] !== "event" || event.progress !== "pending") return;
      const eventId = Number(event["event-id"]);
      if (!Number.isInteger(eventId) || eventId < 0) return;
      const key = `${this.#status.loopCount}:${eventId}`;
      if (this.#observedCueKeys.has(key)) return;
      this.#observedCueKeys.add(key);
      this.#status.scte35.observedEvents = this.#observedCueKeys.size;
      this.#status.scte35.lastEventId = eventId;
      const preRoll = Number(event["time-to-event-ms"]);
      this.#appendEvent(
        `SCTE-35 Event ID ${eventId} emitted on PID ${this.#status.scte35.pid}` +
          (Number.isFinite(preRoll) ? ` (${Math.max(0, Math.round(preRoll))} ms before event)` : ""),
      );
    } catch {
      this.#appendLog("TSDuck returned an unreadable SCTE-35 monitor event");
    }
  }

  #appendLog(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    this.#status.logs.push(`[${timestamp}] ${message}`);
    if (this.#status.logs.length > 200) {
      this.#status.logs.splice(0, this.#status.logs.length - 200);
    }
  }

  #appendEvent(message: string, options?: PlayoutEventOptions): void {
    this.#appendLog(message);
    this.#eventSink?.(message, options);
  }

  #handleFfmpegClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#killTimer) {
      clearTimeout(this.#killTimer);
      this.#killTimer = null;
    }
    const wasStopping = this.#status.state === "stopping";
    const failedByInjector = this.#status.state === "failed";
    this.#child = null;
    this.#terminateClipProducers();
    this.#terminateDvbSubtitles();
    this.#terminateTsdDuck();
    this.#terminateTransportPreview();

    if (!wasStopping && !failedByInjector && code === 0 && this.#request?.repeatPlaylist) {
      this.#status.loopCount += 1;
      this.#resetLoopProgress();
      this.#status.state = "starting";
      this.#appendEvent(`Playlist loop ${this.#status.loopCount} completed; restarting`);
      void this.#restartLoop();
      return;
    }

    if (
      !wasStopping &&
      !failedByInjector &&
      code === 0 &&
      this.#request != null && shouldTransitionToFutureSchedule(this.#request)
    ) {
      this.#status.state = "starting";
      this.#appendEvent(
        `Current schedule completed; promoting ${this.#request?.nextPlaylist.length ?? 0} Future clip(s)`,
      );
      void this.#transitionToFutureSchedule();
      return;
    }

    this.#status.stoppedAt = new Date().toISOString();
    if (wasStopping) {
      this.#status.state = "idle";
      if (this.#status.scte35.enabled) this.#status.scte35.state = "completed";
      if (this.#status.subtitles.enabled) this.#status.subtitles.state = "completed";
      this.#appendEvent(`Playout stopped (${signal ?? code ?? "unknown"})`);
    } else if (failedByInjector) {
      this.#appendEvent(`FFmpeg stopped after injector failure (${signal ?? code ?? "unknown"})`);
    } else if (code === 0) {
      this.#status.state = "completed";
      this.#status.progressPercent = 100;
      this.#status.outTimeSeconds = this.#status.totalDurationSeconds;
      if (this.#status.scte35.enabled && this.#status.scte35.state !== "failed") {
        this.#status.scte35.state = "completed";
      }
      if (this.#status.subtitles.enabled && this.#status.subtitles.state !== "failed") {
        this.#status.subtitles.state = "completed";
      }
      this.#appendEvent("Playlist completed");
    } else {
      this.#status.state = "failed";
      this.#status.error = `FFmpeg exited with ${code ?? signal ?? "unknown"}`;
      this.#appendEvent(this.#status.error);
    }
  }

  async #restartLoop(): Promise<void> {
    try {
      await this.#prepareLoopCommands();
      if (this.#request && usesTsdDuckTransport(this.#request)) {
        await this.#spawnTsdDuck();
        await this.#spawnTransportPreview();
      }
      if (this.#subtitleArgs.length > 0) {
        await this.#spawnDvbSubtitles();
      }
      this.#spawnPreparedFfmpeg();
    } catch (error) {
      this.#handleProcessError(
        error instanceof Error ? error : new Error("Failed to restart playlist loop"),
      );
    }
  }

  async #transitionToFutureSchedule(): Promise<void> {
    try {
      const currentRequest = this.#request;
      if (!currentRequest || currentRequest.nextPlaylist.length === 0) {
        throw new Error("Future schedule is empty");
      }
      const futureRequest: StartPlayoutRequest = {
        ...currentRequest,
        playlist: currentRequest.nextPlaylist,
        nextPlaylist: [],
        repeatPlaylist: false,
      };
      const prepared = await this.#prepareRequest(futureRequest);
      this.#request = prepared.request;
      this.#items = prepared.items;
      this.#status.schedulePhase = "future";
      this.#status.scheduleTransitionCount += 1;
      this.#status.loopCount = 0;
      this.#status.repeatPlaylist = false;
      this.#status.queuedFutureItems = 0;
      this.#status.totalItems = prepared.items.length;
      this.#resetLoopProgress();
      await rm(this.previewDirectory, { force: true, recursive: true });
      await mkdir(this.previewDirectory, { recursive: true });
      await this.#prepareLoopCommands();
      if (usesTsdDuckTransport(prepared.request)) {
        await this.#spawnTsdDuck();
        await this.#spawnTransportPreview();
      }
      if (this.#subtitleArgs.length > 0) {
        await this.#spawnDvbSubtitles();
      }
      const child = this.#spawnPreparedFfmpeg();
      await waitForSpawn(child);
      this.#appendEvent("Future schedule promoted to Current and is now on air");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown transition error";
      this.#handleProcessError(new Error(`Future schedule transition failed: ${message}`));
    }
  }

  #handleProcessError(error: Error): void {
    this.#status.state = "failed";
    this.#status.stoppedAt = new Date().toISOString();
    this.#status.error = error.message;
    this.#appendEvent(`FFmpeg process error: ${error.message}`);
    this.#terminateClipProducers();
    this.#terminateDvbSubtitles();
    this.#terminateTsdDuck();
    this.#terminateTransportPreview();
  }

  #spawnPreparedFfmpeg(): ChildProcessWithoutNullStreams {
    if (this.#commandArgs.length === 0) throw new Error("FFmpeg command is not prepared");
    // stdin — raw video, затем по одному pipe на каждую дорожку программы:
    // pipe:3, pipe:4, ... Их число совпадает с аудио-входами в команде encoder.
    const request = this.#request;
    if (!request) throw new Error("Playout request is not prepared");
    const audioPipeCount = Math.max(1, programAudioTracks(request).length);
    const child = spawn(this.capabilities.ffmpegPath, this.#commandArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe", ...Array<"pipe">(audioPipeCount).fill("pipe")],
    }) as ChildProcessWithoutNullStreams;
    this.#child = child;
    this.#progressBuffer = "";
    this.#logBuffer = "";
    this.#lastLoggedFrame = -1;
    this.#lastConsoleProgressSeconds = Number.NEGATIVE_INFINITY;
    this.#lastConsoleItemIndex = -1;
    const handleInputPipeError = (error: NodeJS.ErrnoException) => {
      // The renderer can still have one buffered raw frame when the encoder
      // closes at loop drain/stop. EPIPE is expected during that hand-off.
      if (!isExpectedPipeError(error)) this.#handleProcessError(error);
    };
    child.stdin.on("error", handleInputPipeError);
    for (let pipeIndex = 3; pipeIndex < child.stdio.length; pipeIndex += 1) {
      (child.stdio[pipeIndex] as Writable | null)?.on("error", handleInputPipeError);
    }
    child.stdout.on("data", (chunk: Buffer) => this.#readProgress(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#readLogs(chunk));
    child.once("spawn", () => {
      if (this.#child !== child) return;
      this.#status.state = "running";
      this.#appendEvent(`FFmpeg started with PID ${child.pid ?? "unknown"}`);
      try {
        this.#activateClipProducer(this.#spawnClipProducer(0), 0);
      } catch (error) {
        this.#handleProcessError(
          error instanceof Error ? error : new Error("Failed to start clip renderer"),
        );
        child.kill("SIGTERM");
      }
    });
    child.once("close", (code, signal) => this.#handleFfmpegClose(code, signal));
    child.once("error", (error) => this.#handleProcessError(error));
    return child;
  }

  /**
   * Поднимает графический процесс на каждую сцену ролика и заводит его вывод
   * в трубу FFmpeg.
   *
   * Процесс отдельный, потому что рисование покадрово — непрерывная нагрузка,
   * а служба однопоточная: рисуя внутри неё, мы бы не отвечали ни на один
   * маршрут всё время показа.
   *
   * Падение графики не имеет права уронить эфир. Труба закрывается, FFmpeg
   * доигрывает ролик без титра — `eof_action=pass` в наложении именно для этого.
   */
  /**
   * Гасит графические процессы. Вызывается вместе с остановкой эфира: висящий
   * рисовальщик после Stop продолжал бы жечь ядро впустую.
   */
  #stopSceneProducers(): void {
    for (const producer of this.#sceneProducers) {
      producer.kill("SIGTERM");
    }
    this.#sceneProducers.clear();
  }

  #attachSceneProducers(
    child: ChildProcessWithoutNullStreams,
    index: number,
    scenes: readonly PreparedSceneShow[],
  ): void {
    for (const [order, scene] of scenes.entries()) {
      const target = child.stdio[firstSceneFileDescriptor + order] as Writable | undefined;
      if (!target) continue;

      const producer = spawn(process.execPath, [this.#sceneEntryPath], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      this.#sceneProducers.add(producer);

      // Труба рендерера закрывается вместе с роликом, а рисовальщик к этому
      // моменту держит ещё кадр: закрытая труба здесь — обычная смена ролика,
      // а не отказ. Без обработчика она всплывает необработанной ошибкой
      // сокета и роняет службу целиком — вместе с эфиром, который к трубе
      // отношения не имеет.
      target.on("error", (error: NodeJS.ErrnoException) => {
        if (!isExpectedPipeError(error)) {
          this.#appendEvent(
            `Scene ${order + 1} of clip ${index + 1} pipe failed: ${error.message}`,
          );
        }
        // Сам рисовальщик закрытия не видит: он пишет в службу, а закрылась
        // труба дальше по цепочке. Не погасив его, мы оставим процесс рисовать
        // в пустоту до конца эфирной сессии.
        producer.kill("SIGTERM");
      });
      guardPipeErrors(producer.stdin);
      guardPipeErrors(producer.stdout);

      // Описание уходит в stdin: каталог превью очищается при старте сессии,
      // и файл до запуска рисовальщика не доживал.
      producer.stdin.end(scene.request);
      producer.stdout.pipe(target);
      this.#readSceneProducerLogs(producer, index, order);
      producer.once("error", (error) => {
        this.#appendEvent(`Scene ${order + 1} of clip ${index + 1} failed to start: ${error.message}`);
        endPipeQuietly(target);
      });
      producer.once("close", (code) => {
        this.#sceneProducers.delete(producer);
        if (code !== 0) {
          this.#appendEvent(`Scene ${order + 1} of clip ${index + 1} exited with code ${code}`);
        }
        endPipeQuietly(target);
      });
    }
  }

  #readSceneProducerLogs(
    producer: ChildProcessWithoutNullStreams,
    index: number,
    order: number,
  ): void {
    let tail = "";
    producer.stderr.setEncoding("utf8");
    producer.stderr.on("data", (chunk: string) => {
      tail = `${tail}${chunk}`.slice(-4_000);
      for (const line of chunk.split(/\r?\n/)) {
        const message = line.trim();
        if (message) this.#appendLog(`Clip ${index + 1} scene ${order + 1}: ${message}`);
      }
    });
    producer.once("close", () => { tail = ""; });
  }

  #spawnClipProducer(index: number): ChildProcessWithoutNullStreams {
    const request = this.#request;
    const item = this.#items[index];
    if (!request || !item) throw new Error(`Clip ${index + 1} is not prepared`);
    const videoCommand = buildFfmpegClipVideoProducerCommand(
      request,
      { ...item, airEpochSeconds: this.#clipAirEpochSeconds(index) },
      this.previewDirectory,
    );
    // Каждая сцена приходит своей трубой: fd 3, 4 и дальше. Без сцен список
    // остаётся прежним, и в конвейере не меняется вообще ничего.
    const scenes = item.scenes ?? [];
    const child = spawn(this.capabilities.ffmpegPath, videoCommand.args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe", ...scenes.map(() => "pipe" as const)],
    }) as ChildProcessWithoutNullStreams;
    this.#attachSceneProducers(child, index, scenes);
    const videoFrameBytes = Math.ceil(request.video.width * request.video.height * 1.5);
    const runtime: ClipProducerRuntime = {
      audio: [],
      child,
      index,
      readyLogged: false,
      videoBridge: new PassThrough({
        highWaterMark: Math.max(minimumClipPipeBufferBytes, videoFrameBytes + 65_536),
      }),
      videoCloseResult: null,
      videoEnded: false,
      videoReady: false,
    };
    this.#producerRuntimes.set(child, runtime);
    // Мост уничтожается на остановке эфира, а рендерер в этот момент может
    // дописывать кадр: закрытая труба здесь штатна, всё остальное — нет.
    const reportVideoPipe = (error: NodeJS.ErrnoException) => {
      this.#appendEvent(`Clip ${index + 1} video pipe failed: ${error.message}`);
    };
    guardPipeErrors(child.stdout, reportVideoPipe);
    guardPipeErrors(runtime.videoBridge, reportVideoPipe);
    child.stdout.once("data", () => this.#handleClipProducerData(runtime, "video"));
    runtime.videoBridge.once("end", () => {
      runtime.videoEnded = true;
      this.#completeClipProducer(runtime);
    });
    child.stdout.pipe(runtime.videoBridge);
    this.#readClipProducerLogs(child, index, "video");
    child.once("error", (error) => this.#handleClipProducerError(child, index, error));
    child.once("close", (code, signal) => {
      runtime.videoCloseResult = { code, signal };
      this.#handleClipProducerClose(runtime, "video", code, signal);
    });

    for (const source of this.#clipAudioSources(item)) {
      runtime.audio.push(this.#spawnClipAudioProducer(runtime, item, source));
    }

    return child;
  }

  /** Источники звука ролика в порядке элементарных потоков программы. */
  #clipAudioSources(item: PreparedPlayoutItem): (ClipAudioSource | undefined)[] {
    const request = this.#request;
    if (!request) throw new Error("Playout request is not prepared");

    const tracks = programAudioTracks(request);
    // Многоязычный звук выключен — одна дорожка из самого ролика, как раньше.
    if (tracks.length === 0) return [undefined];

    return tracks.map((track) => clipAudioSource(item, track));
  }

  #spawnClipAudioProducer(
    runtime: ClipProducerRuntime,
    item: PreparedPlayoutItem,
    source: ClipAudioSource | undefined,
  ): ClipAudioRuntime {
    const request = this.#request;
    if (!request) throw new Error("Playout request is not prepared");

    const command = buildFfmpegClipAudioProducerCommand(request, item, source);
    const child = spawn(this.capabilities.ffmpegPath, command.args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    const audioBufferBytes = request.audio.sampleRate * request.audio.channels * 2 * 2;
    const label = source ? source.label : "audio";
    const audio: ClipAudioRuntime = {
      bridge: new PassThrough({
        highWaterMark: Math.max(minimumClipPipeBufferBytes, audioBufferBytes),
      }),
      child,
      closeResult: null,
      ended: false,
      expectedBytes: clipAudioByteCount(
        item.durationSeconds,
        request.audio.sampleRate,
        request.audio.channels,
      ),
      label,
      paddedBytes: 0,
      ready: false,
      writtenBytes: 0,
    };

    const reportAudioPipe = (error: NodeJS.ErrnoException) => {
      this.#appendEvent(
        `Clip ${runtime.index + 1} audio ${label} pipe failed: ${error.message}`,
      );
    };
    guardPipeErrors(child.stdout, reportAudioPipe);
    guardPipeErrors(audio.bridge, reportAudioPipe);
    child.stdout.once("data", () => this.#handleClipAudioData(runtime, audio));
    audio.bridge.once("end", () => {
      audio.ended = true;
      this.#completeClipProducer(runtime);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      audio.writtenBytes += chunk.length;
    });
    // Мост закрывает не pipe, а #padClipAudio: недостачу байт надо дописать
    // тишиной до того, как дорожка закончится, иначе encoder ждёт отставший вход.
    child.stdout.pipe(audio.bridge, { end: false });
    child.stdout.once("end", () => {
      void this.#padClipAudio(runtime, audio);
    });
    this.#readClipProducerLogs(child, runtime.index, `audio ${label}`);
    child.once("error", (error) => this.#handleClipProducerError(child, runtime.index, error));
    child.once("close", (code, signal) => {
      audio.closeResult = { code, signal };
      this.#handleClipProducerClose(runtime, `audio ${label}`, code, signal);
    });

    return audio;
  }

  /**
   * Страховка поверх фильтра `apad`: если рендерер всё-таки отдал меньше байт,
   * чем длится ролик (упал на середине, exotic-контейнер, срезанный хвост),
   * недостача дописывается тишиной. Молчащий pipe останавливает мультиплексор
   * целиком, поэтому дорожка обязана быть полной даже ценой тишины.
   */
  async #padClipAudio(runtime: ClipProducerRuntime, audio: ClipAudioRuntime): Promise<void> {
    let remaining = clipAudioSilenceBytes(audio.expectedBytes, audio.writtenBytes);
    if (remaining > 0) {
      audio.paddedBytes = remaining;
      const request = this.#request;
      const seconds = request
        ? remaining / (request.audio.sampleRate * request.audio.channels * 2)
        : 0;
      this.#appendEvent(
        `Clip ${runtime.index + 1} audio ${audio.label} ended ` +
          `${seconds.toFixed(2)} s early; padded with silence to keep the programme aligned`,
      );
    }
    while (remaining > 0 && !audio.bridge.destroyed && !audio.bridge.writableEnded) {
      const size = Math.min(remaining, clipAudioSilenceChunkBytes);
      remaining -= size;
      if (!audio.bridge.write(silenceChunk.subarray(0, size))) {
        // Мост может быть уничтожен остановкой эфира — тогда ждать "drain" нечего.
        await Promise.race([
          once(audio.bridge, "drain"),
          once(audio.bridge, "close"),
        ]).catch(() => undefined);
      }
    }
    if (!audio.bridge.destroyed && !audio.bridge.writableEnded) audio.bridge.end();
  }

  #readClipProducerLogs(
    child: ChildProcessWithoutNullStreams,
    index: number,
    stream: string,
  ): void {
    let logBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      logBuffer += chunk.toString("utf8");
      const lines = logBuffer.split(/\r?\n/);
      logBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = line.trim();
        if (message) this.#appendLog(`Clip ${index + 1} ${stream}: ${message}`);
      }
    });
  }

  /**
   * Эфирное время первого кадра ролика: время выхода опорного ролика плюс сумма
   * длительностей всех роликов между ними. Длительности точные, поэтому за
   * недельную сетку часы не накапливают ошибку.
   */
  #clipAirEpochSeconds(index: number): number {
    const anchor = this.#airEpochAnchor;
    if (!anchor || index < anchor.index) return Date.now() / 1_000;
    let epochSeconds = anchor.epochSeconds;
    for (let step = anchor.index; step < index; step += 1) {
      epochSeconds += this.#items[step]?.durationSeconds ?? 0;
    }
    return epochSeconds;
  }

  #activateClipProducer(child: ChildProcessWithoutNullStreams, index: number): void {
    const encoder = this.#child;
    if (!encoder) throw new Error("Persistent encoder is not running");
    const runtime = this.#producerRuntimes.get(child);
    if (!runtime) throw new Error("FFmpeg raw media buffers are unavailable");
    this.#producerChild = child;
    this.#airEpochAnchor = { epochSeconds: Date.now() / 1_000, index };
    this.#status.audioLevelDbfs = null;
    runtime.videoBridge.pipe(encoder.stdin, { end: false });

    runtime.audio.forEach((audio, trackIndex) => {
      const audioInput = encoder.stdio[3 + trackIndex] as Writable | null;
      if (!audioInput) {
        throw new Error(`Encoder audio pipe ${trackIndex} is unavailable`);
      }
      // Индикатор громкости слушает только первую дорожку программы.
      if (trackIndex === 0) {
        audio.bridge.on("data", (chunk: Buffer) => {
          const level = measurePcmS16leDbfs(chunk);
          if (level != null) this.#status.audioLevelDbfs = level;
        });
      }
      audio.bridge.pipe(audioInput, { end: false });
    });

    const audioPids = runtime.audio
      .map((audio) => `${audio.label}=${audio.child.pid ?? "unknown"}`)
      .join(", ");
    this.#appendEvent(
      `Clip renderer ${index + 1}/${this.#items.length} started with video PID ` +
        `${child.pid ?? "unknown"}, audio PID ${audioPids}: ` +
        `"${this.#items[index]?.name ?? "unknown"}"`,
    );
    this.#armClipProducerStartup(runtime);
    const nextIndex = index + 1;
    this.#prefetchedProducerChild = nextIndex < this.#items.length
      ? this.#spawnClipProducer(nextIndex)
      : null;
    if (this.#prefetchedProducerChild) {
      this.#appendEvent(`Clip ${nextIndex + 1} prefetched and waiting on the local pipe`);
    }
  }

  #handleClipProducerClose(
    runtime: ClipProducerRuntime,
    stream: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const stoppedChild = stream === "video"
      ? runtime.child
      : (runtime.audio.find((audio) => stream === `audio ${audio.label}`)?.child ?? runtime.child);
    if (this.#expectedProducerStops.has(stoppedChild)) return;
    if (this.#prefetchedProducerChild === runtime.child && this.#producerChild !== runtime.child) {
      if (code !== 0) {
        this.#handleClipProducerError(
          stoppedChild,
          runtime.index,
          new Error(`${stream} prefetch exited with ${code ?? signal ?? "unknown"}`),
        );
      }
      return;
    }
    if (this.#producerChild !== runtime.child) return;
    if (code !== 0) {
      this.#handleClipProducerError(
        stoppedChild,
        runtime.index,
        new Error(`${stream} renderer exited with ${code ?? signal ?? "unknown"}`),
      );
      return;
    }
    this.#completeClipProducer(runtime);
  }

  #completeClipProducer(runtime: ClipProducerRuntime): void {
    const { child, index } = runtime;
    if (
      this.#producerChild !== child ||
      runtime.videoCloseResult?.code !== 0 ||
      !runtime.videoEnded ||
      runtime.audio.some((audio) => audio.closeResult?.code !== 0 || !audio.ended)
    ) return;
    this.#clearClipProducerStartupTimer();
    this.#producerChild = null;
    this.#producerRuntimes.delete(child);
    const next = this.#prefetchedProducerChild;
    this.#prefetchedProducerChild = null;
    if (next && index + 1 < this.#items.length) {
      this.#activateClipProducer(next, index + 1);
      return;
    }
    const encoder = this.#child;
    if (!encoder) return;
    encoder.stdin.end();
    for (let pipeIndex = 3; pipeIndex < encoder.stdio.length; pipeIndex += 1) {
      (encoder.stdio[pipeIndex] as Writable | null)?.end();
    }
    this.#appendEvent("Last clip rendered; draining the persistent encoder");
  }

  #handleClipProducerData(
    runtime: ClipProducerRuntime,
    stream: "video",
  ): void {
    if (stream === "video") runtime.videoReady = true;
    if (this.#producerChild === runtime.child) this.#reportClipProducerReady(runtime);
  }

  #handleClipAudioData(runtime: ClipProducerRuntime, audio: ClipAudioRuntime): void {
    audio.ready = true;
    if (this.#producerChild === runtime.child) this.#reportClipProducerReady(runtime);
  }

  #reportClipProducerReady(runtime: ClipProducerRuntime): void {
    if (!runtime.videoReady || runtime.readyLogged) return;
    if (runtime.audio.some((audio) => !audio.ready)) return;
    runtime.readyLogged = true;
    this.#clearClipProducerStartupTimer();
    const tracks = runtime.audio.map((audio) => audio.label).join(" + ");
    this.#appendEvent(
      `Clip renderer ${runtime.index + 1}/${this.#items.length} pipe ready: video + ${tracks}`,
    );
  }

  #armClipProducerStartup(runtime: ClipProducerRuntime): void {
    this.#clearClipProducerStartupTimer();
    this.#reportClipProducerReady(runtime);
    if (runtime.readyLogged) return;
    this.#producerStartupTimer = setTimeout(() => {
      if (this.#producerChild !== runtime.child || runtime.readyLogged) return;
      const waitingFor = [
        runtime.videoReady ? null : "video",
        ...runtime.audio.filter((audio) => !audio.ready).map((audio) => `audio ${audio.label}`),
      ].filter(Boolean).join(" + ");
      this.#handleClipProducerError(
        runtime.child,
        runtime.index,
        new Error(`no ${waitingFor} data received within 30 seconds`),
      );
    }, clipProducerStartupTimeoutMs);
    this.#producerStartupTimer.unref();
  }

  #clearClipProducerStartupTimer(): void {
    if (!this.#producerStartupTimer) return;
    clearTimeout(this.#producerStartupTimer);
    this.#producerStartupTimer = null;
  }

  #handleClipProducerError(
    child: ChildProcessWithoutNullStreams,
    index: number,
    error: Error,
  ): void {
    if (this.#expectedProducerStops.has(child) || this.#status.state === "stopping") return;
    this.#clearClipProducerStartupTimer();
    this.#status.state = "failed";
    this.#status.error = `Clip ${index + 1} renderer failed: ${error.message}`;
    this.#appendEvent(this.#status.error);
    this.#terminateClipProducers();
    this.#child?.kill("SIGTERM");
  }

  async #spawnTsdDuck(): Promise<void> {
    if (this.#tsduckArgs.length === 0) throw new Error("TSDuck command is not prepared");
    const child = spawn(this.tsduckCapabilities.tspPath, this.#tsduckArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#tsduckChild = child;
    this.#tsduckLogBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => this.#readTsdDuckLogs(chunk));
    child.stdout.on("data", (chunk: Buffer) => this.#readTsdDuckLogs(chunk));
    child.once("close", (code, signal) => this.#handleTsdDuckClose(child, code, signal));
    child.once("error", (error) => this.#handleTsdDuckError(child, error));
    await waitForSpawn(child);
    if (this.#tsduckChild !== child) throw new Error("TSDuck exited during startup");
    if (this.#status.scte35.enabled) {
      this.#status.scte35.state = "running";
      this.#appendEvent(
        `SCTE-35 injector started with PID ${child.pid ?? "unknown"}; ` +
          `${this.#cues.length} event(s) queued on TS PID ${this.#request?.scte35.pid}`,
      );
    } else {
      const transport = this.#request?.endpoint.protocol === "udp"
        ? "UDP PCR relay"
        : "SRT relay";
      this.#appendEvent(`TSDuck ${transport} started with PID ${child.pid ?? "unknown"}`);
    }
    if (this.#request?.endpoint.protocol === "udp") {
      const endpoint = this.#request.endpoint;
      this.#appendEvent(
        `UDP transport output ${endpoint.host}:${endpoint.port} via ` +
          `${endpoint.localAddress || "OS routing"}; ` +
          `service ${endpoint.mpegTs.serviceId}, video PID ${endpoint.mpegTs.videoPid}, ` +
          `audio PID ${endpoint.mpegTs.audioPid}, ` +
          `transport target ${formatMbps(calculateTransportMuxRate(this.#request))} Mbps ` +
          `(${endpoint.mpegTs.transportBitrateKbps > 0 ? "manual" : "Auto"}), ` +
          `PCR target ${endpoint.mpegTs.pcrPeriodMs} ms`,
      );
      this.#appendEvent(
        `Continuity monitor active on video PID ${endpoint.mpegTs.videoPid} and ` +
          `audio PID ${endpoint.mpegTs.audioPid}`,
      );
    }
  }

  async #spawnTransportPreview(): Promise<void> {
    if (this.#transportPreviewArgs.length === 0 || this.#transportPreviewChild) return;
    if (this.#transportPreviewRestartTimer) {
      clearTimeout(this.#transportPreviewRestartTimer);
      this.#transportPreviewRestartTimer = null;
    }
    const child = spawn(this.capabilities.ffmpegPath, this.#transportPreviewArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#transportPreviewChild = child;
    this.#transportPreviewLogBuffer = "";
    const readLogs = (chunk: Buffer) => this.#readTransportPreviewLogs(chunk);
    child.stdout.on("data", readLogs);
    child.stderr.on("data", readLogs);
    child.once("close", (code, signal) => {
      this.#handleTransportPreviewClose(child, code, signal);
    });
    child.once("error", (error) => this.#handleTransportPreviewError(child, error));
    await waitForSpawn(child);
    if (this.#transportPreviewChild !== child) {
      throw new Error("Final transport preview exited during startup");
    }
    this.#appendEvent(
      `Final transport preview started with PID ${child.pid ?? "unknown"}; ` +
        "source is the post-TSDuck MPEG-TS mirror",
    );
  }

  #readTransportPreviewLogs(chunk: Buffer): void {
    this.#transportPreviewLogBuffer += chunk.toString("utf8");
    const lines = this.#transportPreviewLogBuffer.split(/\r?\n/);
    this.#transportPreviewLogBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const message = line.trim();
      if (/\b(error|failed|invalid|not found|corrupt)\b/i.test(message)) {
        this.#appendLog(`Transport preview: ${message}`);
      }
    }
  }

  #handleTransportPreviewClose(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#transportPreviewChild === child) this.#transportPreviewChild = null;
    if (this.#transportPreviewKillTimer) {
      clearTimeout(this.#transportPreviewKillTimer);
      this.#transportPreviewKillTimer = null;
    }
    if (this.#expectedTransportPreviewStops.has(child)) return;
    this.#scheduleTransportPreviewRestart(`exited with ${code ?? signal ?? "unknown"}`);
  }

  #handleTransportPreviewError(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#expectedTransportPreviewStops.has(child)) return;
    if (this.#transportPreviewChild === child) this.#transportPreviewChild = null;
    this.#expectedTransportPreviewStops.add(child);
    this.#scheduleTransportPreviewRestart(`process error: ${error.message}`);
  }

  #scheduleTransportPreviewRestart(reason: string): void {
    const playoutActive = Boolean(this.#tsduckChild) &&
      ["starting", "running"].includes(this.#status.state);
    if (!playoutActive || this.#transportPreviewArgs.length === 0) return;
    if (this.#transportPreviewRestartAttempts >= 3) {
      this.#appendEvent(`Final transport preview unavailable after 3 retries (${reason})`);
      return;
    }
    this.#transportPreviewRestartAttempts += 1;
    const attempt = this.#transportPreviewRestartAttempts;
    this.#appendEvent(`Final transport preview ${reason}; retry ${attempt}/3`);
    this.#transportPreviewRestartTimer = setTimeout(() => {
      this.#transportPreviewRestartTimer = null;
      void this.#spawnTransportPreview().catch((error: unknown) => {
        this.#scheduleTransportPreviewRestart(
          error instanceof Error ? error.message : "restart failed",
        );
      });
    }, attempt * 750);
    this.#transportPreviewRestartTimer.unref();
  }

  async #spawnDvbSubtitles(): Promise<void> {
    if (this.#subtitleArgs.length === 0) return;
    if (this.#subtitleRestartTimer) {
      clearTimeout(this.#subtitleRestartTimer);
      this.#subtitleRestartTimer = null;
    }
    const child = spawn(this.gstreamerCapabilities.launchPath, this.#subtitleArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#subtitleChild = child;
    this.#subtitleLogBuffer = "";
    const readLogs = (chunk: Buffer) => {
      this.#subtitleLogBuffer += chunk.toString("utf8");
      const lines = this.#subtitleLogBuffer.split(/\r?\n/);
      this.#subtitleLogBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = line.trim();
        if (message) this.#appendLog(`GStreamer DVB: ${message}`);
      }
    };
    child.stdout.on("data", readLogs);
    child.stderr.on("data", readLogs);
    child.once("close", (code, signal) => this.#handleDvbSubtitleClose(child, code, signal));
    child.once("error", (error) => this.#handleDvbSubtitleError(child, error));
    await waitForSpawn(child);
    if (this.#subtitleChild !== child) throw new Error("DVB subtitle encoder exited during startup");
    this.#status.subtitles.state = "running";
    // Причина прошлого падения уже в журнале; держать её в статусе живой ветки
    // незачем — оператор увидел бы красную строку у работающих субтитров.
    this.#status.subtitles.error = null;
    this.#appendEvent(
      `DVB subtitle encoder started with PID ${child.pid ?? "unknown"}; ` +
        `${this.#status.subtitles.plannedCues} cue(s) on TS PID ${this.#request?.subtitleOutput.pid}, ` +
        `language ${this.#request?.subtitleOutput.language}, page IDs 1/1, ` +
        `PES pre-roll ${this.#subtitlePreRollMs} ms, ` +
        `operator PTS offset ${this.#request?.subtitleOutput.ptsOffsetMs ?? 0} ms`,
    );
    void this.#reportGstreamerVersion();
  }

  /**
   * Версия GStreamer в журнале: разбор падения субтитровой ветки начинается
   * именно с неё. Пишется один раз за сессию и в фоне — `gst-launch-1.0
   * --version` на первом запуске может строить реестр плагинов минутами, а
   * старт эфира ждать этого не должен.
   */
  async #reportGstreamerVersion(): Promise<void> {
    if (this.#gstreamerVersionReported) return;
    this.#gstreamerVersionReported = true;
    const version = await this.gstreamerCapabilities.readVersion().catch(() => null);
    if (version) this.#appendEvent(`DVB subtitle encoder runtime: ${version}`);
  }

  #handleDvbSubtitleClose(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#subtitleChild === child) this.#subtitleChild = null;
    if (this.#subtitleKillTimer) {
      clearTimeout(this.#subtitleKillTimer);
      this.#subtitleKillTimer = null;
    }
    if (this.#expectedSubtitleStops.has(child)) return;
    if (code === 0) {
      this.#status.subtitles.state = "completed";
      this.#appendEvent("DVB subtitle cue stream completed");
      return;
    }
    this.#scheduleSubtitleRestart(`exited with ${code ?? signal ?? "unknown"}`);
  }

  #handleDvbSubtitleError(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#expectedSubtitleStops.has(child)) return;
    if (this.#subtitleChild === child) this.#subtitleChild = null;
    this.#scheduleSubtitleRestart(`process error: ${error.message}`);
  }

  /**
   * Субтитры больше не снимают эфир.
   *
   * Раньше любой ненулевой выход GStreamer помечал сессию `failed` и убивал
   * encoder вместе с TSDuck: падение вспомогательной ветки уносило всю выдачу.
   * Subtitle PID объявлен в PMT на старте транспортной сессии и никуда не
   * девается, а `-P merge` просто ждёт данных на своём UDP-входе, поэтому
   * ветку можно поднять заново прямо на ходу. Попытки считаются за сессию:
   * реплика, роняющая GStreamer, не должна крутить перезапуск бесконечно.
   */
  #scheduleSubtitleRestart(reason: string): void {
    if (this.#subtitleArgs.length === 0) return;
    const playoutActive = ["starting", "running"].includes(this.#status.state);
    if (!playoutActive) {
      this.#status.subtitles.state = "failed";
      this.#status.subtitles.error = reason;
      this.#appendEvent(`DVB subtitle encoder ${reason}`);
      return;
    }
    if (this.#subtitleRestartAttempts >= maximumSubtitleRestartAttempts) {
      this.#status.subtitles.state = "failed";
      this.#status.subtitles.error = reason;
      this.#appendEvent(
        `DVB subtitles unavailable after ${maximumSubtitleRestartAttempts} retries (${reason}); ` +
          "playout continues without the subtitle stream",
      );
      return;
    }
    this.#subtitleRestartAttempts += 1;
    const attempt = this.#subtitleRestartAttempts;
    this.#status.subtitles.state = "starting";
    this.#status.subtitles.error = reason;
    this.#appendEvent(
      `DVB subtitle encoder ${reason}; retry ${attempt}/${maximumSubtitleRestartAttempts}`,
    );
    this.#subtitleRestartTimer = setTimeout(() => {
      this.#subtitleRestartTimer = null;
      void this.#resumeDvbSubtitles().catch((error: unknown) => {
        this.#scheduleSubtitleRestart(
          error instanceof Error ? error.message : "restart failed",
        );
      });
    }, attempt * 750);
    this.#subtitleRestartTimer.unref();
  }

  /**
   * Поднимает субтитры с текущего момента эфира.
   *
   * `filesrc ! subparse` всегда читает файл с начала, поэтому перезапуск с
   * исходным файлом выдал бы в эфир реплики с нулевой минуты. Файл собирается
   * заново из оставшихся реплик, а `ts-offset` у `dvbsubenc` получает прибавку
   * на пройденное время — PTS остаются на программной шкале. Реплика, на
   * которой GStreamer упал, при этом остаётся позади и второй раз не
   * проигрывается.
   */
  async #resumeDvbSubtitles(): Promise<void> {
    const request = this.#request;
    const inputPort = this.#subtitleInputPort;
    if (!request || request.subtitleOutput.mode !== "dvb" || inputPort === null) return;
    // Пока таймер ждал, эфир мог остановиться — лишний процесс не поднимаем.
    if (!["starting", "running"].includes(this.#status.state)) return;

    const resumeAtSeconds = this.#status.outTimeSeconds;
    const timeline = buildSubtitleTimeline(
      this.#subtitleProgramCues,
      resumeAtSeconds,
      dvbSubtitlePreRollMs / 1_000,
    );
    if (timeline.cueCount === 0) {
      this.#status.subtitles.state = "completed";
      this.#appendEvent(
        `DVB subtitle encoder not restarted at ${formatClock(resumeAtSeconds)}: no cues left`,
      );
      return;
    }

    this.#subtitleResumeCount += 1;
    const inputPath = path.join(
      this.previewDirectory,
      `dvb-subtitles-loop-${this.#status.loopCount}-resume-${this.#subtitleResumeCount}.srt`,
    );
    await writeFile(inputPath, timeline.content, "utf8");
    this.#subtitlePreRollMs = Math.round(timeline.preRollSeconds * 1_000);
    this.#subtitleArgs = buildGstreamerDvbSubtitleCommand({
      inputPath,
      outputPort: inputPort,
      preRollMs: this.#subtitlePreRollMs,
      timelineOffsetMs: Math.round(resumeAtSeconds * 1_000),
      request,
    });
    this.#appendEvent(
      `Resuming DVB subtitles at ${formatClock(resumeAtSeconds)} with ` +
        `${timeline.cueCount} cue(s) left`,
    );
    await this.#spawnDvbSubtitles();
  }

  #handleTsdDuckClose(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#tsduckChild === child) this.#tsduckChild = null;
    if (this.#tsduckKillTimer) {
      clearTimeout(this.#tsduckKillTimer);
      this.#tsduckKillTimer = null;
    }
    if (this.#expectedTsdDuckStops.has(child)) return;
    const role = this.#status.scte35.enabled
      ? "injector"
      : this.#request?.endpoint.protocol === "udp"
        ? "UDP PCR relay"
        : "SRT relay";
    const error = `TSDuck ${role} exited with ${code ?? signal ?? "unknown"}`;
    if (this.#status.scte35.enabled) {
      this.#status.scte35.state = "failed";
      this.#status.scte35.error = error;
    }
    this.#status.state = "failed";
    this.#status.error = error;
    this.#status.stoppedAt = new Date().toISOString();
    this.#appendEvent(error);
    this.#child?.kill("SIGTERM");
    this.#terminateDvbSubtitles();
    this.#terminateTransportPreview();
  }

  #handleTsdDuckError(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#expectedTsdDuckStops.has(child)) return;
    if (this.#status.scte35.enabled) {
      this.#status.scte35.state = "failed";
      this.#status.scte35.error = error.message;
    }
    this.#status.state = "failed";
    this.#status.error = error.message;
    this.#appendEvent(`TSDuck process error: ${error.message}`);
    this.#child?.kill("SIGTERM");
    this.#terminateDvbSubtitles();
    this.#terminateTransportPreview();
  }

  #terminateTsdDuck(): void {
    const child = this.#tsduckChild;
    if (!child) return;
    this.#tsduckChild = null;
    this.#expectedTsdDuckStops.add(child);
    child.kill("SIGTERM");
    this.#tsduckKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    this.#tsduckKillTimer.unref();
  }

  #terminateDvbSubtitles(): void {
    if (this.#subtitleRestartTimer) {
      clearTimeout(this.#subtitleRestartTimer);
      this.#subtitleRestartTimer = null;
    }
    const child = this.#subtitleChild;
    if (!child) return;
    this.#subtitleChild = null;
    this.#expectedSubtitleStops.add(child);
    child.kill("SIGTERM");
    this.#subtitleKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    this.#subtitleKillTimer.unref();
  }

  #terminateTransportPreview(): void {
    if (this.#transportPreviewRestartTimer) {
      clearTimeout(this.#transportPreviewRestartTimer);
      this.#transportPreviewRestartTimer = null;
    }
    const child = this.#transportPreviewChild;
    if (!child) return;
    this.#transportPreviewChild = null;
    this.#expectedTransportPreviewStops.add(child);
    child.kill("SIGTERM");
    this.#transportPreviewKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    this.#transportPreviewKillTimer.unref();
  }

  #terminateFfmpeg(): void {
    const child = this.#child;
    this.#child = null;
    this.#terminateClipProducers();
    child?.kill("SIGTERM");
  }

  #terminateClipProducers(): void {
    const producers = [this.#producerChild, this.#prefetchedProducerChild]
      .filter((child): child is ChildProcessWithoutNullStreams => Boolean(child));
    this.#producerChild = null;
    this.#prefetchedProducerChild = null;
    this.#clearClipProducerStartupTimer();
    // Графика умирает вместе с рендерерами: висящий рисовальщик жёг бы ядро
    // впустую и держал бы трубу открытой.
    this.#stopSceneProducers();
    for (const child of producers) this.#terminateClipProducer(child);
  }

  #terminateClipProducer(child: ChildProcessWithoutNullStreams): void {
    const runtime = this.#producerRuntimes.get(child);
    this.#producerRuntimes.delete(child);
    runtime?.videoBridge.destroy();
    for (const audio of runtime?.audio ?? []) audio.bridge.destroy();
    const producers = runtime
      ? [runtime.child, ...runtime.audio.map((audio) => audio.child)]
      : [child];
    for (const producer of producers) {
      this.#expectedProducerStops.add(producer);
      producer.stdout.destroy();
      producer.stdin.destroy();
      producer.kill("SIGTERM");
      const forceKill = setTimeout(() => producer.kill("SIGKILL"), 1_000);
      forceKill.unref();
      producer.once("close", () => clearTimeout(forceKill));
    }
  }

  #resetLoopProgress(): void {
    this.#status.currentItemIndex = 0;
    this.#status.currentItemId = this.#items[0]?.id ?? null;
    this.#status.currentItemName = this.#items[0]?.name ?? null;
    this.#status.currentItemElapsedSeconds = 0;
    this.#status.currentItemDurationSeconds = this.#items[0]?.durationSeconds ?? 0;
    this.#status.currentItemProgressPercent = 0;
    this.#status.outTimeSeconds = 0;
    this.#status.progressPercent = 0;
    this.#status.frame = 0;
    this.#status.fps = 0;
    this.#status.bitrateKbps = 0;
    this.#status.speed = 0;
    this.#status.error = null;
    this.#status.stoppedAt = null;
    if (this.#status.scte35.enabled) this.#status.scte35.state = "starting";
    if (this.#status.subtitles.enabled) this.#status.subtitles.state = "starting";
  }
}

async function resolveGraphics(
  request: StartPlayoutRequest,
  onProgress?: PreparationProgress,
): Promise<StartPlayoutRequest> {
  const logo = request.logo ? await resolveLogoOverlay(request.logo) : null;
  const playlist = await mapWithConcurrency(
    request.playlist,
    playlistPreparationConcurrency,
    async (item) => ({
      ...item,
      ageTitle: item.ageTitle?.enabled && item.ageTitle.filePath
        ? {
            ...item.ageTitle,
            filePath: (await resolveAgeOverlay({ filePath: item.ageTitle.filePath })).filePath,
          }
        : item.ageTitle,
      itemLogo: item.itemLogo?.enabled
        ? await resolveLogoOverlay(item.itemLogo)
        : item.itemLogo,
      effects: await Promise.all((item.effects ?? []).map(resolveEffectLayer)),
      subtitles: item.subtitles?.enabled && item.subtitles.filePath
        ? await resolveSubtitleOverlay(item.subtitles)
        : item.subtitles,
    }),
    (completed, total) => onProgress?.("graphics", completed, total),
  );
  return { ...request, logo, playlist };
}

async function resolveEffectLayer(effect: GraphicEffectLayer): Promise<GraphicEffectLayer> {
  const backgroundPath = await resolveEffectSource(
    effect.backgroundPath ?? effect.filePath,
    "FX background",
  );
  const titlePath = effect.titlePath
    ? await resolveEffectSource(effect.titlePath, "FX per-clip title")
    : null;
  return {
    ...effect,
    backgroundPath,
    filePath: backgroundPath,
    titlePath,
  };
}

async function resolveEffectSource(filePath: string, label: string): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    throw new PlayoutPreflightError(`${label} path must be absolute`);
  }
  const resolvedPath = await realpath(filePath);
  if (!(await stat(resolvedPath)).isFile()) {
    throw new PlayoutPreflightError(`${label} path is not a file`);
  }
  const valid = new Set([".png", ".webp", ".mov", ".mp4", ".m4v", ".webm"])
    .has(path.extname(resolvedPath).toLowerCase());
  if (!valid) throw new PlayoutPreflightError(`${label} has an unsupported format`);
  return resolvedPath;
}

async function resolveSubtitleOverlay<T extends { enabled: boolean; filePath: string | null }>(
  subtitle: T,
): Promise<T> {
  try {
    if (!subtitle.filePath || !path.isAbsolute(subtitle.filePath)) {
      return { ...subtitle, enabled: false, filePath: null };
    }
    const resolvedPath = await realpath(subtitle.filePath);
    if (!(await stat(resolvedPath)).isFile() || path.extname(resolvedPath).toLowerCase() !== ".srt") {
      return { ...subtitle, enabled: false, filePath: null };
    }
    return { ...subtitle, filePath: resolvedPath };
  } catch {
    return { ...subtitle, enabled: false, filePath: null };
  }
}

async function resolveLogoOverlay<T extends { filePath: string }>(logo: T): Promise<T> {
  if (!path.isAbsolute(logo.filePath)) {
    throw new PlayoutPreflightError("Logo path must be absolute");
  }
  const resolvedPath = await realpath(logo.filePath);
  const logoStat = await stat(resolvedPath);
  if (!logoStat.isFile()) throw new PlayoutPreflightError("Logo path is not a file");
  if (!isSupportedLogoPath(resolvedPath)) {
    throw new PlayoutPreflightError(
      "Logo must be PNG, WebP, JPEG, GIF, MOV, MP4, M4V, WebM, MKV, AVI or MXF. " +
        "A logo must be a rendered file before playout.",
    );
  }
  return { ...logo, filePath: resolvedPath };
}

async function resolveAgeOverlay<T extends { filePath: string }>(overlay: T): Promise<T> {
  if (!path.isAbsolute(overlay.filePath)) {
    throw new PlayoutPreflightError("AGE overlay path must be absolute");
  }
  const resolvedPath = await realpath(overlay.filePath);
  const overlayStat = await stat(resolvedPath);
  if (!overlayStat.isFile()) throw new PlayoutPreflightError("AGE overlay path is not a file");
  if (!new Set([".png", ".webp"]).has(path.extname(resolvedPath).toLowerCase())) {
    throw new PlayoutPreflightError("AGE overlay must be a full-frame PNG or WebP with alpha");
  }
  return { ...overlay, filePath: resolvedPath };
}

/**
 * Готовит показы сцен одного ролика.
 *
 * Считает полотно на весь показ и кладёт описание на диск: графический процесс
 * получает путь, а не аргументы командной строки — недельная сетка иначе
 * упёрлась бы в предельную длину строки запуска.
 *
 * Сцена, невидимая на всём показе, отбрасывается здесь: поднимать под неё
 * процесс и вход FFmpeg незачем.
 */
export function prepareScenes(
  item: StartPlayoutRequest["playlist"][number],
  request: StartPlayoutRequest,
  durationSeconds: number,
): PreparedSceneShow[] {
  const shows = item.scenes ?? [];
  if (shows.length === 0) return [];

  const format = sceneFormatSchema.parse({
    layout: sceneLayoutFor(request.video.width, request.video.height),
    width: request.video.width,
    height: request.video.height,
    drawRate: request.video.frameRate,
  });

  const prepared: PreparedSceneShow[] = [];
  for (const show of shows) {
    const visible = Math.min(show.durationSeconds, Math.max(0, durationSeconds - show.startSeconds));
    if (visible <= 0) continue;

    const showRequest = {
      template: show.template,
      format,
      durationSeconds: visible,
      fields: show.fields,
      airEpochSeconds: 0,
      clipRemainingSeconds: Math.max(0, durationSeconds - show.startSeconds),
    };
    const plan = planSceneShow(showRequest);
    if (!plan) continue;

    prepared.push({
      x: plan.region.x,
      y: plan.region.y,
      width: plan.region.width,
      height: plan.region.height,
      startSeconds: show.startSeconds,
      frameCount: plan.frameCount,
      request: JSON.stringify(showRequest),
    });
  }
  return prepared;
}

/** Раскладочная цель по размеру кадра: от неё зависят поправки шаблона. */
function sceneLayoutFor(width: number, height: number): SceneLayoutTarget {
  if (height >= 1_440) return "uhd";
  if (height >= 720) return "hd";
  return width / height > 1.5 ? "sd-16x9" : "sd-4x3";
}

async function prepareItems(
  request: StartPlayoutRequest,
  ffprobePath: string,
  onProgress?: PreparationProgress,
): Promise<PreparedPlayoutItem[]> {
  const probeCache = new Map<string, ReturnType<typeof probeMedia>>();
  return mapWithConcurrency(
    request.playlist,
    playlistPreparationConcurrency,
    async (item) => {
      let filePath: string;
      let sourceDurationSeconds: number;
      let hasAudio: boolean;
      // У заглушки файла нет: полосы рисует сам FFmpeg. Проверять путь на диске
      // нечем, поэтому ветка идёт до realpath и stat.
      if (isBarsSource(item.filePath)) {
        return {
          id: item.id,
          name: item.name,
          filePath: item.filePath,
          trimInSeconds: 0,
          durationSeconds: item.trimOutSeconds ?? barsSegmentSeconds,
          hasAudio: false,
        };
      }
      if (item.sourceDurationSeconds != null && item.hasAudio != null) {
        if (!path.isAbsolute(item.filePath)) {
          throw new PlayoutPreflightError(`Media path must be absolute: ${item.filePath}`);
        }
        filePath = await realpath(item.filePath);
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          throw new PlayoutPreflightError(`Media path is not a file: ${filePath}`);
        }
        sourceDurationSeconds = item.sourceDurationSeconds;
        hasAudio = item.hasAudio;
      } else {
        let pendingProbe = probeCache.get(item.filePath);
        if (!pendingProbe) {
          pendingProbe = probeMedia(item.filePath, ffprobePath);
          probeCache.set(item.filePath, pendingProbe);
        }
        const probe = await pendingProbe;
        filePath = probe.filePath;
        sourceDurationSeconds = probe.durationSeconds;
        hasAudio = probe.hasAudio;
      }
      const end = item.trimOutSeconds ?? sourceDurationSeconds;
      const duration = Math.min(end, sourceDurationSeconds) - item.trimInSeconds;
      if (duration <= 0) {
        throw new PlayoutPreflightError(`Invalid trim range for ${item.name}`);
      }
      return {
        id: item.id,
        name: item.name,
        filePath,
        trimInSeconds: item.trimInSeconds,
        durationSeconds: duration,
        hasAudio,
        scenes: prepareScenes(item, request, duration),
        ageTitle: item.ageTitle?.enabled ? item.ageTitle : undefined,
        itemLogo: item.itemLogo?.enabled ? item.itemLogo : undefined,
        effects: item.effects,
        audioOverlays: await prepareAudioOverlays(item, probeCache, ffprobePath),
        subtitles: item.subtitles?.enabled ? item.subtitles : undefined,
        audioTracks: item.audioTracks,
      };
    },
    (completed, total) => onProgress?.("media", completed, total),
  );
}

/**
 * Звуковые вставки ролика (звук стингера). Файл без звуковой дорожки уронил бы
 * рендерер дорожки, а вместе с ним и весь эфир: мультиплексор ждёт отставший
 * вход. Поэтому такая вставка молча выбрасывается ещё до старта.
 */
async function prepareAudioOverlays(
  item: StartPlayoutRequest["playlist"][number],
  probeCache: Map<string, ReturnType<typeof probeMedia>>,
  ffprobePath: string,
): Promise<ClipAudioOverlay[] | undefined> {
  const overlays = item.audioOverlays ?? [];
  if (overlays.length === 0) return undefined;
  const prepared: ClipAudioOverlay[] = [];
  for (const overlay of overlays) {
    let pendingProbe = probeCache.get(overlay.filePath);
    if (!pendingProbe) {
      pendingProbe = probeMedia(overlay.filePath, ffprobePath);
      probeCache.set(overlay.filePath, pendingProbe);
    }
    const probe = await pendingProbe.catch(() => null);
    if (!probe?.hasAudio) continue;
    prepared.push({ ...overlay, filePath: probe.filePath });
  }
  return prepared.length > 0 ? prepared : undefined;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item, index);
      completed += 1;
      onProgress?.(completed, items.length);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

function validateCapabilities(
  capabilities: FfmpegCapabilities,
  request: StartPlayoutRequest,
): void {
  // Ускоритель проверяем первым: без него UHD-профиль недостижим, и узнавать
  // об этом посреди эфира пропущенными кадрами — худший из вариантов.
  // Подмену на программный кодировщик делать нельзя: оператор выбрал ускоритель
  // именно потому, что программный не тянет.
  if (request.video.hardware !== "off") {
    let resolved;
    try {
      resolved = resolveVideoEncoder(request.video, capabilities.videoEncoders);
    } catch (reason) {
      throw new PlayoutPreflightError(
        reason instanceof Error ? reason.message : String(reason),
      );
    }
    if (
      request.video.fieldOrder !== "progressive" &&
      !hardwareSupportsInterlace(resolved.vendor)
    ) {
      // Отдать прогрессив вместо 50i — это не «чуть хуже», а несовпадение
      // с профилем: головная станция ждёт поля.
      throw new PlayoutPreflightError(
        `${resolved.name} cannot encode interlaced video. ` +
          "Switch the field order to progressive, choose QSV, or turn hardware encoding off.",
      );
    }
  }
  if (request.scte35.enabled && request.endpoint.protocol === "rtmp") {
    throw new PlayoutPreflightError(
      "SCTE-35 injection requires UDP or SRT MPEG-TS output; RTMP/FLV is not supported",
    );
  }
  if (request.subtitleOutput.mode === "dvb" && request.endpoint.protocol === "rtmp") {
    throw new PlayoutPreflightError(
      "DVB subtitles require UDP or SRT MPEG-TS output; RTMP/FLV is not supported",
    );
  }
  // Фильтр subtitles живёт только в сборках с libass. Без него FFmpeg падает
  // невнятным "AVFilterGraph: No such filter", поэтому объясняем заранее.
  if (
    request.subtitleOutput.mode === "burn-in" &&
    !capabilities.supports.burnInSubtitles &&
    request.playlist.some((item) => item.subtitles?.enabled)
  ) {
    throw new PlayoutPreflightError(
      "This FFmpeg build has no 'subtitles' filter, so burn-in captions cannot be rendered. " +
        "Install a libass-enabled build (on macOS: brew install ffmpeg-full), " +
        "switch Subtitle output to DVB, or turn SRT off for the affected clips.",
    );
  }
  // Фильтр drawtext живёт только в сборках с libfreetype. Плашки рисует сцена
  // своим растеризатором, а вот возрастная маркировка без картинки — всё ещё
  // drawtext, и без фильтра она роняет граф невнятным "No such filter".
  if (
    !capabilities.supports.dynamicText &&
    request.playlist.some((item) => item.ageTitle?.enabled && !item.ageTitle.filePath)
  ) {
    throw new PlayoutPreflightError(
      "This FFmpeg build has no 'drawtext' filter, so the age rating cannot be drawn as text. " +
        "Install a libfreetype-enabled build (on macOS: brew install ffmpeg-full), " +
        "or give the age rating an image file.",
    );
  }
  const ffmpegProtocol = usesTsdDuckTransport(request)
    ? "udp"
    : request.endpoint.protocol;
  if (!capabilities.supports[ffmpegProtocol]) {
    throw new PlayoutPreflightError(
      `FFmpeg does not support ${ffmpegProtocol.toUpperCase()} output`,
    );
  }
  if (!capabilities.supports[request.video.codec]) {
    throw new PlayoutPreflightError(
      `FFmpeg does not support ${request.video.codec.toUpperCase()} encoding`,
    );
  }
  if (!capabilities.supports.aac) {
    throw new PlayoutPreflightError("FFmpeg AAC encoder is required for live preview");
  }
  if (!capabilities.videoEncoders.includes("libx264")) {
    throw new PlayoutPreflightError("FFmpeg libx264 encoder is required for live preview");
  }
  if (
    request.endpoint.protocol === "rtmp" &&
    (request.video.codec !== "h264" || request.audio.codec !== "aac")
  ) {
    throw new PlayoutPreflightError("RTMP output requires H.264 video and AAC audio");
  }
  if (request.audio.codec === "mp2" && request.audio.channels === 6) {
    throw new PlayoutPreflightError("MP2 output supports mono or stereo audio only");
  }
  if (
    request.endpoint.protocol === "udp" &&
    request.endpoint.mpegTs.transportBitrateKbps > 0
  ) {
    const configuredRate = request.endpoint.mpegTs.transportBitrateKbps * 1_000;
    const minimumRate = calculateMinimumTransportMuxRate(request);
    if (configuredRate < minimumRate) {
      throw new PlayoutPreflightError(
        `Transport bitrate ${formatMbps(configuredRate)} Mbps is too low for the configured ` +
          `video and audio peak. Use at least ${formatMbps(minimumRate)} Mbps or set 0 for Auto.`,
      );
    }
  }
  if (request.scte35.enabled && request.endpoint.protocol !== "rtmp") {
    const { audioPid, videoPid } = request.endpoint.protocol === "udp"
      ? request.endpoint.mpegTs
      : defaultMpegTsOutputSettings;
    if (request.scte35.pid === videoPid || request.scte35.pid === audioPid) {
      throw new PlayoutPreflightError(
        `SCTE-35 PID ${request.scte35.pid} conflicts with ` +
          `${request.scte35.pid === videoPid ? "video" : "audio"} PID`,
      );
    }
  }
  if (request.subtitleOutput.mode === "dvb" && request.endpoint.protocol !== "rtmp") {
    const { audioPid, videoPid } = request.endpoint.protocol === "udp"
      ? request.endpoint.mpegTs
      : defaultMpegTsOutputSettings;
    const conflictsWith = request.subtitleOutput.pid === videoPid
      ? "video"
      : request.subtitleOutput.pid === audioPid
        ? "audio"
        : request.scte35.enabled && request.subtitleOutput.pid === request.scte35.pid
          ? "SCTE-35"
          : null;
    if (conflictsWith) {
      throw new PlayoutPreflightError(
        `DVB subtitle PID ${request.subtitleOutput.pid} conflicts with ${conflictsWith} PID`,
      );
    }
  }
}

function validateScte35Cues(
  request: StartPlayoutRequest,
  cues: PlannedScte35Cue[],
): void {
  const earliestMs = request.scte35.preRollMs + injectorStartupSafetyMs;
  const tooEarly = cues.find((cue) => cue.programTimeSeconds * 1_000 < earliestMs);
  if (tooEarly) {
    throw new PlayoutPreflightError(
      `SCTE-35 Event ID ${tooEarly.eventId} is too close to playlist start. ` +
        `Place it at ${formatSeconds(earliestMs / 1_000)} or later ` +
        `(${request.scte35.preRollMs} ms pre-roll + ${injectorStartupSafetyMs} ms startup reserve).`,
    );
  }
}

function redactSecrets(line: string, request: StartPlayoutRequest | null): string {
  if (!request) return line;
  let redacted = line;
  if (request.endpoint.protocol === "rtmp") {
    redacted = redacted.replaceAll(request.endpoint.streamKey, "***");
  } else if (request.endpoint.protocol === "srt" && request.endpoint.passphrase) {
    redacted = redacted.replaceAll(request.endpoint.passphrase, "***");
  }
  return redacted;
}

function idleStatus(): PlayoutStatus {
  return {
    state: "idle",
    sessionId: null,
    startedAt: null,
    stoppedAt: null,
    currentItemIndex: 0,
    currentItemId: null,
    currentItemName: null,
    currentItemElapsedSeconds: 0,
    currentItemDurationSeconds: 0,
    currentItemProgressPercent: 0,
    totalItems: 0,
    outTimeSeconds: 0,
    totalDurationSeconds: 0,
    progressPercent: 0,
    frame: 0,
    fps: 0,
    bitrateKbps: 0,
    audioLevelDbfs: null,
    transportBitrateBps: null,
    transportBitrateMode: null,
    continuityErrors: 0,
    speed: 0,
    endpointLabel: null,
    previewPath: null,
    repeatPlaylist: false,
    loopCount: 0,
    schedulePhase: "current",
    scheduleTransitionCount: 0,
    queuedFutureItems: 0,
    scte35: {
      enabled: false,
      state: "disabled",
      pid: null,
      plannedEvents: 0,
      observedEvents: 0,
      lastEventId: null,
      nextEventId: null,
      nextEventInSeconds: null,
      error: null,
    },
    subtitles: {
      enabled: false,
      state: "disabled",
      pid: null,
      language: null,
      plannedCues: 0,
      sourceItems: 0,
      observedPes: 0,
      lastPtsMs: null,
      videoPtsOriginMs: null,
      clockErrorMs: null,
      clockSynchronized: null,
      error: null,
    },
    error: null,
    logs: [],
  };
}

function numberValue(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTsdDuckContinuityWarning(line: string): boolean {
  return /FluxIO-output/i.test(line) && /\b(continuity|discontinuity|missing)\b/i.test(line);
}

export function shouldTransitionToFutureSchedule(request: StartPlayoutRequest): boolean {
  return !request.repeatPlaylist && request.nextPlaylist.length > 0;
}

function assertPlaylistPrefixUnchanged(
  current: ReadonlyArray<{ id: string }>,
  replacement: ReadonlyArray<{ id: string }>,
  activeIndex: number,
): void {
  for (let index = 0; index <= activeIndex; index += 1) {
    if (current[index]?.id !== replacement[index]?.id) {
      throw new PlayoutConflictError(
        "HOT CHANGE cannot remove or reorder the on-air and already played clips",
      );
    }
  }
}

export function alignHotChangePlaylist<T extends { id: string }>(
  current: readonly T[],
  replacement: readonly T[],
  activeIndex: number,
  activeId: string | null,
): T[] {
  const onAirId = activeId ?? current[activeIndex]?.id;
  const replacementActiveIndex = onAirId
    ? replacement.findIndex((item) => item.id === onAirId)
    : -1;
  if (replacementActiveIndex < 0) {
    throw new PlayoutConflictError("HOT CHANGE cannot remove the on-air clip");
  }
  return [
    ...current.slice(0, activeIndex),
    ...replacement.slice(replacementActiveIndex),
  ];
}

/**
 * Сколько байт тишины дописать в дорожку, чтобы она совпала по длине с роликом.
 * Лишние байты обрезать уже нельзя — их забрал encoder, поэтому только недостача.
 */
export function clipAudioSilenceBytes(expectedBytes: number, writtenBytes: number): number {
  return Math.max(0, expectedBytes - writtenBytes);
}

export function measurePcmS16leDbfs(chunk: Buffer): number | null {
  const sampleCount = Math.floor(chunk.length / 2);
  if (sampleCount === 0) return null;
  let sumSquares = 0;
  for (let offset = 0; offset < sampleCount * 2; offset += 2) {
    const sample = chunk.readInt16LE(offset) / 32_768;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms > 0 ? Math.max(-120, Math.min(0, 20 * Math.log10(rms))) : -120;
}

export function estimateCommandLineCharacters(command: string, args: string[]): number {
  return command.length + args.reduce((total, argument) => total + argument.length + 3, 1);
}

function formatMbps(bitrateBps: number): string {
  return (bitrateBps / 1_000_000).toFixed(3);
}

export function formatFrameProgressLog({
  bitrateKbps,
  fps,
  frame,
  outTimeSeconds,
}: {
  bitrateKbps: number;
  fps: number;
  frame: number;
  outTimeSeconds: number;
}): string {
  return `Transmitted frames: ${Math.max(0, Math.round(frame))} | ` +
    `FPS: ${Math.max(0, fps).toFixed(2)} | ` +
    `bitrate: ${Math.max(0, bitrateKbps).toFixed(0)} kbps | ` +
    `time: ${formatClock(outTimeSeconds)}`;
}

export function shouldReportEncodingActivity({
  currentItemIndex,
  lastItemIndex,
  lastOutTimeSeconds,
  outTimeSeconds,
}: {
  currentItemIndex: number;
  lastItemIndex: number;
  lastOutTimeSeconds: number;
  outTimeSeconds: number;
}): boolean {
  return currentItemIndex !== lastItemIndex ||
    !Number.isFinite(lastOutTimeSeconds) ||
    outTimeSeconds < lastOutTimeSeconds ||
    outTimeSeconds - lastOutTimeSeconds >= consoleProgressIntervalSeconds;
}

export function formatEncodingActivity({
  bitrateKbps,
  currentItemIndex,
  currentItemName,
  fps,
  frame,
  outTimeSeconds,
  speed,
  totalItems,
}: {
  bitrateKbps: number;
  currentItemIndex: number;
  currentItemName: string | null;
  fps: number;
  frame: number;
  outTimeSeconds: number;
  speed: number;
  totalItems: number;
}): string {
  const safeName = (currentItemName ?? "unknown clip").replace(/[\r\n\t]+/g, " ");
  return `Encoding clip ${currentItemIndex + 1}/${Math.max(1, totalItems)} ` +
    `"${safeName}" | frame: ${Math.max(0, Math.round(frame))} | ` +
    `FPS: ${Math.max(0, fps).toFixed(2)} | ` +
    `bitrate: ${Math.max(0, bitrateKbps).toFixed(0)} kbps | ` +
    `speed: ${Math.max(0, speed).toFixed(2)}x | ` +
    `time: ${formatClock(outTimeSeconds)}`;
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

function formatClockWithMilliseconds(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  return `${formatClock(safeMilliseconds / 1_000)}.${String(safeMilliseconds % 1_000).padStart(3, "0")}`;
}

function formatSignedMilliseconds(milliseconds: number): string {
  return `${milliseconds >= 0 ? "+" : ""}${milliseconds} ms`;
}

export async function waitForPlayoutStop(
  isActive: () => boolean,
  timeoutMs = 8_000,
  pollIntervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isActive()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out while stopping the active playout for a hot take");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function reserveUdpPort(): Promise<number> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", resolve);
    });
    const address = socket.address();
    if (typeof address === "string") throw new Error("Failed to reserve local UDP port");
    return address.port;
  } finally {
    socket.close();
  }
}

async function reserveDistinctUdpPort(excludedPort: number): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await reserveUdpPort();
    if (port !== excludedPort) return port;
  }
  throw new Error("Failed to reserve a distinct UDP port for final transport preview");
}

function formatSeconds(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} seconds`;
}

/**
 * Подставляет заглушку, когда стартовать нечем.
 *
 * Пустое расписание раньше было отказом на старте. Инженеру привычнее обратное:
 * линия поднимается, в неё уходят цветные полосы, и уже под живым эфиром можно
 * собрать расписание — транспорт, PCR и адрес выдачи при этом настоящие.
 *
 * Повтор включается принудительно: заглушка обязана крутиться, пока её не
 * сменят, а без повтора эфир завершился бы через один круг полос.
 */
export function withBarsFallback(request: StartPlayoutRequest): StartPlayoutRequest {
  if (request.playlist.length > 0) return request;
  return { ...request, playlist: [barsPlayoutItem()], repeatPlaylist: true };
}
