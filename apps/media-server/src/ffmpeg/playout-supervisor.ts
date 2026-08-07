import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FfmpegCapabilities,
  PlayoutStatus,
  StartPlayoutRequest,
} from "@gruber/contracts";
import { defaultMpegTsOutputSettings, playoutStatusSchema } from "@gruber/contracts";
import { buildFfmpegCommand, type PreparedPlayoutItem } from "./command-builder.js";
import { FfmpegCapabilitiesService } from "./capabilities.js";
import { probeMedia } from "./probe.js";
import { TsdDuckCapabilitiesService } from "../tsduck/capabilities.js";
import {
  buildScte35CueXml,
  planScte35Cues,
  type PlannedScte35Cue,
} from "../tsduck/cue-builder.js";
import {
  buildTsdDuckCommand,
  calculateMinimumTransportMuxRate,
  calculateTransportMuxRate,
} from "../tsduck/command-builder.js";

const previewPath = "/api/playout/preview/index.m3u8";
const injectorStartupSafetyMs = 2_000;
const tsduckMonitorPrefix = "GRUBER_SCTE35:";
const consoleProgressIntervalSeconds = 5;

export class PlayoutConflictError extends Error {}
export class PlayoutPreflightError extends Error {}
export type PlayoutEventSink = (entry: string) => void;

export function usesTsdDuckTransport(request: StartPlayoutRequest): boolean {
  return request.endpoint.protocol === "udp" || request.endpoint.protocol === "srt";
}

export class PlayoutSupervisor {
  readonly previewDirectory: string;
  readonly capabilities: FfmpegCapabilitiesService;
  readonly tsduckCapabilities: TsdDuckCapabilitiesService;
  #child: ChildProcessWithoutNullStreams | null = null;
  #tsduckChild: ChildProcessWithoutNullStreams | null = null;
  #expectedTsdDuckStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #killTimer: NodeJS.Timeout | null = null;
  #tsduckKillTimer: NodeJS.Timeout | null = null;
  #request: StartPlayoutRequest | null = null;
  #items: PreparedPlayoutItem[] = [];
  #commandArgs: string[] = [];
  #tsduckArgs: string[] = [];
  #cues: PlannedScte35Cue[] = [];
  #observedCueKeys = new Set<string>();
  #status: PlayoutStatus = idleStatus();
  #progressBuffer = "";
  #logBuffer = "";
  #tsduckLogBuffer = "";
  #lastLoggedFrame = -1;
  #lastConsoleProgressSeconds = Number.NEGATIVE_INFINITY;
  #lastConsoleItemIndex = -1;
  #eventSink: PlayoutEventSink | null;

  constructor(
    capabilities: FfmpegCapabilitiesService,
    previewDirectory: string,
    eventSink: PlayoutEventSink | null = null,
    tsduckCapabilities = new TsdDuckCapabilitiesService(),
  ) {
    this.capabilities = capabilities;
    this.previewDirectory = previewDirectory;
    this.#eventSink = eventSink;
    this.tsduckCapabilities = tsduckCapabilities;
  }

  getStatus(): PlayoutStatus {
    this.#updateNextCue();
    return playoutStatusSchema.parse({
      ...this.#status,
      scte35: { ...this.#status.scte35 },
      logs: [...this.#status.logs],
    });
  }

  async start(request: StartPlayoutRequest): Promise<PlayoutStatus> {
    if (
      this.#child ||
      this.#tsduckChild ||
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
      currentItemName: request.playlist[0]?.name ?? null,
      transportBitrateBps: request.endpoint.protocol === "udp"
        ? calculateTransportMuxRate(request)
        : null,
      transportBitrateMode: request.endpoint.protocol === "udp"
        ? request.endpoint.mpegTs.transportBitrateKbps > 0 ? "manual" : "auto"
        : null,
      repeatPlaylist: request.repeatPlaylist,
      scte35: {
        ...idleStatus().scte35,
        enabled: request.scte35.enabled,
        state: request.scte35.enabled ? "starting" : "disabled",
        pid: request.scte35.enabled ? request.scte35.pid : null,
      },
    };

    try {
      const capabilities = await this.capabilities.get();
      validateCapabilities(capabilities, request);
      if (usesTsdDuckTransport(request)) {
        await this.tsduckCapabilities.getVersion();
        if (request.endpoint.protocol === "srt") {
          await this.tsduckCapabilities.assertSrtSupport();
        }
      }
      const resolvedRequest = await resolveLogos(request);
      this.#request = resolvedRequest;
      this.#items = await prepareItems(resolvedRequest, this.capabilities.ffprobePath);
      await rm(this.previewDirectory, { force: true, recursive: true });
      await mkdir(this.previewDirectory, { recursive: true });
      await this.#prepareLoopCommands();
      this.#appendEvent(`Starting ${request.playlist.length} clip playout`);
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
      }
      const child = this.#spawnPreparedFfmpeg();
      await waitForSpawn(child);
      return this.getStatus();
    } catch (error) {
      this.#terminateTsdDuck();
      this.#terminateFfmpeg();
      this.#status.state = "failed";
      this.#status.stoppedAt = new Date().toISOString();
      this.#status.error = error instanceof Error ? error.message : "Unknown start error";
      if (this.#status.scte35.enabled && this.#status.scte35.state !== "running") {
        this.#status.scte35.state = "failed";
        this.#status.scte35.error = this.#status.error;
      }
      this.#appendEvent(`Start failed: ${this.#status.error}`);
      throw error;
    }
  }

  async stop(): Promise<PlayoutStatus> {
    const child = this.#child;
    if (!child && !this.#tsduckChild) {
      return this.getStatus();
    }
    if (this.#status.state !== "stopping") {
      this.#status.state = "stopping";
      this.#appendEvent("Graceful stop requested");
      this.#terminateTsdDuck();
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

  async close(): Promise<void> {
    await this.stop();
  }

  async #prepareLoopCommands(): Promise<void> {
    const request = this.#request;
    if (!request) throw new Error("Playout request is not prepared");

    this.#cues = request.scte35.enabled
      ? planScte35Cues(request, this.#items, this.#status.loopCount)
      : [];
    this.#observedCueKeys.clear();
    this.#status.scte35.plannedEvents = this.#cues.length;
    this.#status.scte35.observedEvents = 0;
    this.#status.scte35.lastEventId = null;
    this.#status.scte35.error = null;

    if (!usesTsdDuckTransport(request)) {
      const command = buildFfmpegCommand(
        request,
        this.#items,
        this.previewDirectory,
        {
          transportMuxRateBps: request.endpoint.protocol === "udp"
            ? calculateTransportMuxRate(request)
            : undefined,
        },
      );
      this.#commandArgs = command.args;
      this.#tsduckArgs = [];
      this.#applyCommandStatus(command.totalDurationSeconds, command.endpointLabel);
      return;
    }

    if (request.scte35.enabled) validateScte35Cues(request, this.#cues);
    const inputPort = await reserveUdpPort();
    const cueFilePath = request.scte35.enabled && this.#cues.length > 0
      ? path.join(this.previewDirectory, `scte35-loop-${this.#status.loopCount}.xml`)
      : null;
    if (cueFilePath) {
      await writeFile(cueFilePath, buildScte35CueXml(request, this.#cues), "utf8");
    }
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
    const command = buildFfmpegCommand(request, this.#items, this.previewDirectory, {
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
      request,
    });
    this.#commandArgs = command.args;
    this.#tsduckArgs = tsduck.args;
    this.#applyCommandStatus(command.totalDurationSeconds, tsduck.endpointLabel);
  }

  #applyCommandStatus(totalDurationSeconds: number, endpointLabel: string): void {
    this.#status.totalDurationSeconds = totalDurationSeconds;
    this.#status.endpointLabel = endpointLabel;
    this.#status.previewPath = previewPath;
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
      if (this.#status.outTimeSeconds < elapsed + duration) {
        currentIndex = index;
        break;
      }
      elapsed += duration;
    }
    this.#status.currentItemIndex = currentIndex;
    this.#status.currentItemName = this.#items[currentIndex]?.name ?? null;
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
      if (trimmed) this.#appendLog(redactSecrets(trimmed, this.#request));
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

  #appendEvent(message: string): void {
    this.#appendLog(message);
    this.#eventSink?.(message);
  }

  #handleFfmpegClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#killTimer) {
      clearTimeout(this.#killTimer);
      this.#killTimer = null;
    }
    const wasStopping = this.#status.state === "stopping";
    const failedByInjector = this.#status.state === "failed";
    this.#child = null;
    this.#terminateTsdDuck();

    if (!wasStopping && !failedByInjector && code === 0 && this.#request?.repeatPlaylist) {
      this.#status.loopCount += 1;
      this.#resetLoopProgress();
      this.#status.state = "starting";
      this.#appendEvent(`Playlist loop ${this.#status.loopCount} completed; restarting`);
      void this.#restartLoop();
      return;
    }

    this.#status.stoppedAt = new Date().toISOString();
    if (wasStopping) {
      this.#status.state = "idle";
      if (this.#status.scte35.enabled) this.#status.scte35.state = "completed";
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
      }
      this.#spawnPreparedFfmpeg();
    } catch (error) {
      this.#handleProcessError(
        error instanceof Error ? error : new Error("Failed to restart playlist loop"),
      );
    }
  }

  #handleProcessError(error: Error): void {
    this.#status.state = "failed";
    this.#status.stoppedAt = new Date().toISOString();
    this.#status.error = error.message;
    this.#appendEvent(`FFmpeg process error: ${error.message}`);
    this.#terminateTsdDuck();
  }

  #spawnPreparedFfmpeg(): ChildProcessWithoutNullStreams {
    if (this.#commandArgs.length === 0) throw new Error("FFmpeg command is not prepared");
    const child = spawn(this.capabilities.ffmpegPath, this.#commandArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#progressBuffer = "";
    this.#logBuffer = "";
    this.#lastLoggedFrame = -1;
    this.#lastConsoleProgressSeconds = Number.NEGATIVE_INFINITY;
    this.#lastConsoleItemIndex = -1;
    child.stdout.on("data", (chunk: Buffer) => this.#readProgress(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#readLogs(chunk));
    child.once("spawn", () => {
      if (this.#child !== child) return;
      this.#status.state = "running";
      this.#appendEvent(`FFmpeg started with PID ${child.pid ?? "unknown"}`);
    });
    child.once("close", (code, signal) => this.#handleFfmpegClose(code, signal));
    child.once("error", (error) => this.#handleProcessError(error));
    return child;
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

  #terminateFfmpeg(): void {
    const child = this.#child;
    this.#child = null;
    child?.kill("SIGTERM");
  }

  #resetLoopProgress(): void {
    this.#status.currentItemIndex = 0;
    this.#status.currentItemName = this.#items[0]?.name ?? null;
    this.#status.outTimeSeconds = 0;
    this.#status.progressPercent = 0;
    this.#status.frame = 0;
    this.#status.fps = 0;
    this.#status.bitrateKbps = 0;
    this.#status.speed = 0;
    this.#status.error = null;
    this.#status.stoppedAt = null;
    if (this.#status.scte35.enabled) this.#status.scte35.state = "starting";
  }
}

async function resolveLogos(request: StartPlayoutRequest): Promise<StartPlayoutRequest> {
  const logo = request.logo ? await resolveLogoOverlay(request.logo) : null;
  const playlist: StartPlayoutRequest["playlist"] = [];
  for (const item of request.playlist) {
    playlist.push({
      ...item,
      ageTitle: item.ageTitle?.enabled && item.ageTitle.filePath
        ? {
            ...item.ageTitle,
            filePath: (await resolveLogoOverlay({ filePath: item.ageTitle.filePath })).filePath,
          }
        : item.ageTitle,
      itemLogo: item.itemLogo?.enabled
        ? await resolveLogoOverlay(item.itemLogo)
        : item.itemLogo,
    });
  }
  return { ...request, logo, playlist };
}

async function resolveLogoOverlay<T extends { filePath: string }>(logo: T): Promise<T> {
  if (!path.isAbsolute(logo.filePath)) {
    throw new PlayoutPreflightError("Logo path must be absolute");
  }
  const resolvedPath = await realpath(logo.filePath);
  const logoStat = await stat(resolvedPath);
  if (!logoStat.isFile()) throw new PlayoutPreflightError("Logo path is not a file");
  if (!new Set([".png", ".webp", ".jpg", ".jpeg"]).has(path.extname(resolvedPath).toLowerCase())) {
    throw new PlayoutPreflightError("Logo must be PNG, WebP, JPEG or JPG");
  }
  return { ...logo, filePath: resolvedPath };
}

async function prepareItems(
  request: StartPlayoutRequest,
  ffprobePath: string,
): Promise<PreparedPlayoutItem[]> {
  const prepared: PreparedPlayoutItem[] = [];
  for (const item of request.playlist) {
    const probe = await probeMedia(item.filePath, ffprobePath);
    const end = item.trimOutSeconds ?? probe.durationSeconds;
    const duration = Math.min(end, probe.durationSeconds) - item.trimInSeconds;
    if (duration <= 0) throw new PlayoutPreflightError(`Invalid trim range for ${item.name}`);
    prepared.push({
      id: item.id,
      name: item.name,
      filePath: probe.filePath,
      trimInSeconds: item.trimInSeconds,
      durationSeconds: duration,
      hasAudio: probe.hasAudio,
      ageTitle: item.ageTitle?.enabled ? item.ageTitle : undefined,
      itemLogo: item.itemLogo?.enabled ? item.itemLogo : undefined,
    });
  }
  return prepared;
}

function validateCapabilities(
  capabilities: FfmpegCapabilities,
  request: StartPlayoutRequest,
): void {
  if (request.scte35.enabled && request.endpoint.protocol === "rtmp") {
    throw new PlayoutPreflightError(
      "SCTE-35 injection requires UDP or SRT MPEG-TS output; RTMP/FLV is not supported",
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
    currentItemName: null,
    totalItems: 0,
    outTimeSeconds: 0,
    totalDurationSeconds: 0,
    progressPercent: 0,
    frame: 0,
    fps: 0,
    bitrateKbps: 0,
    transportBitrateBps: null,
    transportBitrateMode: null,
    continuityErrors: 0,
    speed: 0,
    endpointLabel: null,
    previewPath: null,
    repeatPlaylist: false,
    loopCount: 0,
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

function formatSeconds(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} seconds`;
}
