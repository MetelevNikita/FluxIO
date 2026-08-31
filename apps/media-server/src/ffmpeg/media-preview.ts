import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import type { ClipPreviewSession, StartPlayoutRequest } from "@gruber/contracts";
import {
  buildFfmpegCompositePreviewCommand,
  firstSceneFileDescriptor,
  previewSizedRequest,
  type PreparedPlayoutItem,
  type PreparedSceneShow,
} from "./command-builder.js";
import { prepareScenes } from "./playout-supervisor.js";
import { probeMedia } from "./probe.js";
import { runCommand } from "./process.js";

/**
 * Превью считаются параллельно, но с потолком: импорт недельного расписания
 * запрашивает сотни картинок сразу, а неограниченный параллелизм увёл бы CPU
 * у эфирного encoder-а. Одна общая очередь (как было) делала обратную ошибку —
 * последняя картинка ждала все предыдущие.
 */
const thumbnailConcurrency = 4;

/**
 * media-service переживает окно, но не перезапуск приложения: launch.mjs гасит
 * сервер вместе с Electron. Реестр роликов живёт в памяти, поэтому после
 * повторного старта восстановленная из БД сессия просила превью для «неизвестных»
 * файлов и получала 404 — все картинки в интерфейсе гасли. Теперь такой файл
 * заново прогоняется через ffprobe. Ограничение параллелизма обязательно:
 * восстановленное недельное расписание запрашивает сотни превью одновременно.
 */
const registrationConcurrency = 4;

interface RegisteredMedia {
  durationSeconds: number;
  filePath: string;
}

interface ActivePreview {
  child: ChildProcessWithoutNullStreams | null;
  directory: string;
  sessionId: string;
  stderr: string;
  /**
   * Графические процессы сцен этого предпросмотра.
   *
   * Гасятся вместе с ним: рисовальщик, переживший Stop, продолжал бы жечь ядро
   * и писать в закрытую трубу.
   */
  sceneProducers: Set<ChildProcessWithoutNullStreams>;
}

export class MediaPreviewService {
  /** Точка входа графического процесса — та же, что у эфирного рендерера. */
  readonly #sceneEntryPath = fileURLToPath(new URL("../scene/process-entry.js", import.meta.url));
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly rootDirectory: string;
  #active: ActivePreview | null = null;
  #registered = new Map<string, RegisteredMedia>();
  #registrationJobs = new Map<string, Promise<RegisteredMedia>>();
  #registrationSlots = new Semaphore(registrationConcurrency);
  #thumbnailJobs = new Map<string, Promise<Buffer>>();
  #thumbnailSlots = new Semaphore(thumbnailConcurrency);

  constructor(
    ffmpegPath: string,
    rootDirectory: string,
    ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe",
  ) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
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
    const job = this.#thumbnailSlots.run(() =>
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
    const visibleDuration = clipDuration - offsetSeconds;
    // Сцена считается под **кадр предпросмотра**, а не эфирный: превью
    // кодируется уменьшенным, и область, посчитанная по 1920, легла бы мимо.
    // Показ, начавшийся до точки перемотки, сдвигается назад ровно как FX-слой;
    // закончившийся — отбрасывается.
    const scenes = prepareScenes(
      {
        ...source,
        scenes: (source.scenes ?? []).flatMap((show) => {
          const start = show.startSeconds - offsetSeconds;
          const end = start + show.durationSeconds;
          return end > 0 ? [{ ...show, startSeconds: Math.max(0, start) }] : [];
        }),
      },
      previewSizedRequest(request),
      visibleDuration,
    );
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
      scenes,
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
    return this.#launchPreview(command.args, sessionId, directory, offsetSeconds, scenes);
  }

  async #launchPreview(
    args: string[],
    sessionId: string,
    directory: string,
    offsetSeconds: number,
    scenes: readonly PreparedSceneShow[] = [],
  ): Promise<ClipPreviewSession> {
    const manifestPath = path.join(directory, "index.m3u8");
    const firstSegmentPath = path.join(directory, "segment-000000.ts");
    await mkdir(directory, { recursive: true });
    // Каждая сцена приходит своей трубой: fd 3, 4 и дальше — тот же уговор,
    // что и у эфирного рендерера. Без сцен список остаётся прежним.
    const child = spawn(this.ffmpegPath, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe", ...scenes.map(() => "pipe" as const)],
    }) as ChildProcessWithoutNullStreams;
    const active: ActivePreview = {
      child, directory, sessionId, stderr: "", sceneProducers: new Set(),
    };
    this.#active = active;
    this.#attachSceneProducers(active, scenes);
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

  /**
   * Поднимает графический процесс на каждую сцену предпросмотра.
   *
   * Процесс отдельный по той же причине, что и в эфире: рисование покадрово —
   * непрерывная нагрузка, а служба однопоточная, и рисуя внутри неё, она
   * перестала бы отвечать на маршруты всё время показа.
   *
   * Падение графики не имеет права уронить предпросмотр: труба закрывается,
   * FFmpeg доигрывает ролик без титра — `eof_action=pass` в наложении ровно
   * для этого.
   */
  #attachSceneProducers(active: ActivePreview, scenes: readonly PreparedSceneShow[]): void {
    const child = active.child;
    if (!child) return;
    for (const [order, scene] of scenes.entries()) {
      const target = child.stdio[firstSceneFileDescriptor + order] as Writable | undefined;
      if (!target) continue;
      const producer = spawn(process.execPath, [this.#sceneEntryPath], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      active.sceneProducers.add(producer);
      // Описание уходит в stdin: каталог сессии сносится при остановке, и файл
      // до запуска рисовальщика не доживал бы.
      producer.stdin.end(scene.request);
      producer.stdout.pipe(target);
      producer.stderr.resume();
      producer.once("error", () => { target.end(); });
      producer.once("close", () => {
        active.sceneProducers.delete(producer);
        target.end();
      });
    }
  }

  async stop(sessionId?: string): Promise<void> {
    const active = this.#active;
    if (!active || (sessionId && active.sessionId !== sessionId)) return;
    this.#active = null;
    for (const producer of active.sceneProducers) producer.kill("SIGTERM");
    active.sceneProducers.clear();
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
    const media = this.#registered.get(resolvedPath);
    if (media) return media;

    const restoredDuration = persistedDurationSeconds ?? 0;
    if (
      Number.isFinite(restoredDuration) &&
      restoredDuration > 0 &&
      (await stat(resolvedPath)).isFile()
    ) {
      const restored = { durationSeconds: restoredDuration, filePath: resolvedPath };
      this.#registered.set(resolvedPath, restored);
      return restored;
    }

    return this.#reregister(resolvedPath);
  }

  /** Файл известен интерфейсу, но не этому процессу: анализируем его заново. */
  async #reregister(resolvedPath: string): Promise<RegisteredMedia> {
    const running = this.#registrationJobs.get(resolvedPath);
    if (running) return running;

    const job = this.#registrationSlots.run(async () => {
      const probe = await probeMedia(resolvedPath, this.ffprobePath).catch(() => null);
      if (!probe) throw new Error("Media file has not been analyzed in this session");
      const media = {
        durationSeconds: Math.max(0, probe.durationSeconds),
        filePath: probe.filePath,
      };
      this.#registered.set(probe.filePath, media);
      return media;
    });
    this.#registrationJobs.set(resolvedPath, job);
    try {
      return await job;
    } finally {
      this.#registrationJobs.delete(resolvedPath);
    }
  }
}

/** Потолок одновременных дочерних процессов: ffprobe для реестра, ffmpeg для превью. */
class Semaphore {
  readonly limit: number;
  #active = 0;
  #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }

    this.#active += 1;
    try {
      return await task();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
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
