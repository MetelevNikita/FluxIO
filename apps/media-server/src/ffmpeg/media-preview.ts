import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ClipPreviewSession, StartPlayoutRequest } from "@gruber/contracts";
import { buildFfmpegCompositePreviewCommand, type PreparedPlayoutItem } from "./command-builder.js";
import { runCommand } from "./process.js";

/**
 * Превью считаются параллельно, но с потолком: импорт недельного расписания
 * запрашивает сотни картинок сразу, а неограниченный параллелизм увёл бы CPU
 * у эфирного encoder-а. Одна общая очередь (как было) делала обратную ошибку —
 * последняя картинка ждала все предыдущие.
 */
const thumbnailConcurrency = 4;

interface RegisteredMedia {
  durationSeconds: number;
  filePath: string;
}

interface ActivePreview {
  child: ChildProcessWithoutNullStreams | null;
  directory: string;
  sessionId: string;
  stderr: string;
}

export class MediaPreviewService {
  readonly ffmpegPath: string;
  readonly rootDirectory: string;
  #active: ActivePreview | null = null;
  #registered = new Map<string, RegisteredMedia>();
  #thumbnailJobs = new Map<string, Promise<Buffer>>();
  #thumbnailActive = 0;
  #thumbnailWaiting: (() => void)[] = [];

  constructor(ffmpegPath: string, rootDirectory: string) {
    this.ffmpegPath = ffmpegPath;
    this.rootDirectory = rootDirectory;
  }

  register(filePath: string, durationSeconds: number): void {
    this.#registered.set(filePath, {
      durationSeconds: Math.max(0, durationSeconds),
      filePath,
    });
  }

  async thumbnail(filePath: string, requestedSeconds?: number): Promise<Buffer> {
    const media = await this.#resolveRegistered(filePath);
    const fileStat = await stat(media.filePath);
    const defaultSeconds = Math.min(5, Math.max(0, media.durationSeconds * 0.1));
    const seekSeconds = Math.min(
      Math.max(0, media.durationSeconds - 0.05),
      Number.isFinite(requestedSeconds) ? Math.max(0, requestedSeconds ?? 0) : defaultSeconds,
    );
    const key = createHash("sha256")
      .update(`${media.filePath}\0${fileStat.size}\0${fileStat.mtimeMs}\0${seekSeconds.toFixed(3)}`)
      .digest("hex");
    const thumbnailDirectory = path.join(this.rootDirectory, "thumbnails");
    const thumbnailPath = path.join(thumbnailDirectory, `${key}.jpg`);

    try {
      return await readFile(thumbnailPath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    const existingJob = this.#thumbnailJobs.get(key);
    if (existingJob) return existingJob;
    const job = this.#withThumbnailSlot(() =>
      this.#generateThumbnail(media, seekSeconds, thumbnailDirectory, thumbnailPath)
    );
    this.#thumbnailJobs.set(key, job);
    try {
      return await job;
    } finally {
      this.#thumbnailJobs.delete(key);
    }
  }

  async start(filePath: string, startSeconds: number): Promise<ClipPreviewSession> {
    const media = await this.#resolveRegistered(filePath);
    await this.stop();

    const maximumStart = Math.max(0, media.durationSeconds - 0.1);
    const offsetSeconds = Math.min(Math.max(0, startSeconds), maximumStart);
    const sessionId = randomUUID();
    const directory = path.join(this.rootDirectory, "sessions", sessionId);
    const args = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-loglevel",
      "warning",
      "-ss",
      decimal(offsetSeconds),
      "-re",
      "-i",
      media.filePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=960:-2:force_original_aspect_ratio=decrease,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "25",
      "-keyint_min",
      "25",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      "-hls_flags",
      "independent_segments+append_list+temp_file",
      "-hls_segment_filename",
      path.join(directory, "segment-%06d.ts"),
      path.join(directory, "index.m3u8"),
    ];
    return this.#launchPreview(args, sessionId, directory, offsetSeconds);
  }

  async startComposite(
    request: StartPlayoutRequest,
    startSeconds: number,
  ): Promise<ClipPreviewSession> {
    const source = request.playlist[0];
    if (!source) throw new Error("Composite preview requires one playlist item");
    const media = await this.#resolveRegistered(
      source.filePath,
      source.sourceDurationSeconds,
    );
    await this.stop();
    const sourceDuration = source.sourceDurationSeconds ?? media.durationSeconds;
    const clipEnd = Math.min(source.trimOutSeconds ?? sourceDuration, sourceDuration);
    const clipDuration = Math.max(0.1, clipEnd - source.trimInSeconds);
    const offsetSeconds = Math.min(Math.max(0, startSeconds), clipDuration - 0.1);
    const item: PreparedPlayoutItem = {
      ageTitle: source.ageTitle?.enabled && offsetSeconds < source.ageTitle.durationSeconds
        ? { ...source.ageTitle, durationSeconds: source.ageTitle.durationSeconds - offsetSeconds }
        : undefined,
      durationSeconds: clipDuration - offsetSeconds,
      effects: source.effects?.flatMap((effect) => {
        const start = effect.startSeconds - offsetSeconds;
        const end = effect.endSeconds - offsetSeconds;
        return end > 0
          ? [{ ...effect, startSeconds: Math.max(0, start), endSeconds: end }]
          : [];
      }),
      filePath: media.filePath,
      hasAudio: source.hasAudio ?? true,
      id: source.id,
      itemLogo: source.itemLogo?.enabled ? source.itemLogo : undefined,
      name: source.name,
      subtitles: source.subtitles?.enabled ? source.subtitles : undefined,
      trimInSeconds: source.trimInSeconds + offsetSeconds,
    };
    const sessionId = randomUUID();
    const directory = path.join(this.rootDirectory, "sessions", sessionId);
    const command = buildFfmpegCompositePreviewCommand(
      { ...request, playlist: [source], nextPlaylist: [], repeatPlaylist: false },
      item,
      directory,
    );
    return this.#launchPreview(command.args, sessionId, directory, offsetSeconds);
  }

  async #launchPreview(
    args: string[],
    sessionId: string,
    directory: string,
    offsetSeconds: number,
  ): Promise<ClipPreviewSession> {
    const manifestPath = path.join(directory, "index.m3u8");
    const firstSegmentPath = path.join(directory, "segment-000000.ts");
    await mkdir(directory, { recursive: true });
    const child = spawn(this.ffmpegPath, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const active: ActivePreview = { child, directory, sessionId, stderr: "" };
    this.#active = active;
    // Composite previews report FFmpeg progress on stdout. Drain it so a long
    // preview cannot block when the child-process pipe becomes full.
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => {
      active.stderr = `${active.stderr}${chunk.toString("utf8")}`.slice(-16_384);
    });
    child.once("close", () => {
      if (this.#active === active) active.child = null;
    });
    child.once("error", (error) => {
      active.stderr = error.message;
    });

    try {
      await waitForPreviewFiles(active, manifestPath, firstSegmentPath);
    } catch (error) {
      await this.stop(sessionId);
      throw error;
    }

    return {
      sessionId,
      manifestPath: `/api/media/clip-preview/${sessionId}/index.m3u8`,
      offsetSeconds,
    };
  }

  async readPreviewFile(sessionId: string, filename: string): Promise<Buffer> {
    const active = this.#active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Clip preview session is not active");
    }
    if (!/^(?:index\.m3u8|segment-\d{6}\.ts)$/.test(filename)) {
      throw new Error("Clip preview file is invalid");
    }
    return readFile(path.join(active.directory, filename));
  }

  async stop(sessionId?: string): Promise<void> {
    const active = this.#active;
    if (!active || (sessionId && active.sessionId !== sessionId)) return;
    this.#active = null;
    const child = active.child;
    if (child && child.exitCode == null && child.signalCode == null) {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      const closedInTime = await Promise.race([
        closed.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (!closedInTime && child.exitCode == null && child.signalCode == null) {
        child.kill("SIGKILL");
        await once(child, "close").catch(() => undefined);
      }
    }
    await rm(active.directory, { force: true, recursive: true });
  }

  async close(): Promise<void> {
    await this.stop();
  }

  async #withThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.#thumbnailActive >= thumbnailConcurrency) {
      await new Promise<void>((resolve) => this.#thumbnailWaiting.push(resolve));
    }

    this.#thumbnailActive += 1;
    try {
      return await task();
    } finally {
      this.#thumbnailActive -= 1;
      this.#thumbnailWaiting.shift()?.();
    }
  }

  async #generateThumbnail(
    media: RegisteredMedia,
    seekSeconds: number,
    thumbnailDirectory: string,
    thumbnailPath: string,
  ): Promise<Buffer> {
    await mkdir(thumbnailDirectory, { recursive: true });
    await runCommand(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      decimal(seekSeconds),
      "-i",
      media.filePath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "thumbnail=n=8,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:black",
      "-q:v",
      "3",
      "-y",
      thumbnailPath,
    ]);
    return readFile(thumbnailPath);
  }

  async #resolveRegistered(
    filePath: string,
    persistedDurationSeconds?: number,
  ): Promise<RegisteredMedia> {
    if (!path.isAbsolute(filePath)) {
      throw new Error("Media path must be absolute");
    }
    const resolvedPath = await realpath(filePath);
    let media = this.#registered.get(resolvedPath);
    const restoredDuration = persistedDurationSeconds ?? 0;
    if (
      !media &&
      Number.isFinite(restoredDuration) &&
      restoredDuration > 0 &&
      (await stat(resolvedPath)).isFile()
    ) {
      media = { durationSeconds: restoredDuration, filePath: resolvedPath };
      this.#registered.set(resolvedPath, media);
    }
    if (!media) {
      throw new Error("Media file has not been analyzed in this session");
    }
    return media;
  }
}

async function waitForPreviewFiles(
  active: ActivePreview,
  manifestPath: string,
  firstSegmentPath: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const [manifest, segment] = await Promise.all([
        stat(manifestPath),
        stat(firstSegmentPath),
      ]);
      if (manifest.size > 0 && segment.size > 0) return;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    if (!active.child && Date.now() + 250 < deadline) {
      throw new Error(`FFmpeg preview stopped before it became ready: ${active.stderr.trim()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`FFmpeg preview did not become ready: ${active.stderr.trim()}`);
}

function decimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
