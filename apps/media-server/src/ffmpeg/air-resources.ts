import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { constants, freemem, setPriority } from "node:os";
import { performance } from "node:perf_hooks";

/* -------------------------------------------------------------------------- *
 * Ресурсы машины для эфира: приоритет процессов и чтение роликов впрок.
 *
 * Эфир живёт на той же машине, что и всё остальное. На эфирном сервере
 * копировали файлы на тот же диск, с которого идёт вещание, и выдача замирала:
 * диск был занят на 100 % при 40 МБ/с, а рендерер читает ролик по мере
 * надобности и запаса не держит. Выдача при этом идёт строго в реальном
 * времени — полсекунды раздумий диска становятся полсекундой стоп-кадра.
 *
 * Поднять эфиру приоритет диска обычная программа в Windows не может: выше
 * «нормального» его получают только система и диспетчер памяти. Поэтому здесь
 * две вещи, которые сделать можно: процессор эфиру отдаётся первым, а ролик
 * прочитывается в память раньше, чем до него дойдёт выдача, — рендерер берёт
 * его из кэша системы, и занятый диск эфира уже не касается. Копировщику со
 * своей стороны стоит уйти в фоновый режим (`PROCESS_MODE_BACKGROUND_BEGIN`):
 * это опускает его приоритет диска.
 * ------------------------------------------------------------------------- */

const mebibyte = 1_048_576;
const gibibyte = 1_024 * mebibyte;

/**
 * Приоритет процессов эфира.
 *
 * На Windows это `HIGH_PRIORITY_CLASS`: прав администратора не требует и, в
 * отличие от REALTIME, не ставит машину колом — выдача идёт в реальном времени
 * и лишнего процессора не просит. На Unix отрицательный nice требует прав:
 * без них эфир идёт с обычным приоритетом, и об этом говорится одной строкой.
 */
export function airProcessPriority(platform: NodeJS.Platform = process.platform): number {
  return platform === "win32"
    ? constants.priority.PRIORITY_HIGH
    : constants.priority.PRIORITY_ABOVE_NORMAL;
}

/** Поднять приоритет процесса эфира. Отказ эфиру не мешает — он лишь называется. */
export function raiseAirPriority(pid: number | undefined, onFailure: (reason: string) => void): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, airProcessPriority());
  } catch (error) {
    onFailure(systemErrorCode(error));
  }
}

/**
 * Короткий системный код отказа — `EACCES`, `EPERM`.
 *
 * Node заворачивает его в `ERR_SYSTEM_ERROR`, а настоящую причину кладёт в
 * `info.code`. Обёртка ничего не объясняет, и хуже того — в ней есть слово
 * «error»: журнал по нему красил штатный отказ в красный, как аварию.
 */
function systemErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const info = (error as { info?: { code?: unknown } }).info;
    if (info?.code) return String(info.code);
    if ("code" in error) return String((error as { code: unknown }).code);
  }
  return String(error);
}

/**
 * Сколько ролика читать впрок.
 *
 * Не больше половины свободной памяти и не больше 2 ГиБ: кэш держит система, и
 * забитая им память вытеснила бы то, что нужно самому эфиру. Меньше 64 МиБ
 * читать незачем — это секунды выдачи, а диск на них уже потрачен.
 */
export function readAheadBudgetBytes(freeMemoryBytes: number): number {
  const budget = Math.min(2 * gibibyte, Math.floor(freeMemoryBytes / 2));
  return budget >= 64 * mebibyte ? budget : 0;
}

/**
 * Какие байты файла читать впрок.
 *
 * С того места, где ролик войдёт в эфир, а не с начала файла: подъём по часам и
 * срез с середины начинают передачу с тридцатой минуты, и первые полчаса в
 * памяти ей не нужны. Место считается долей времени — байты в файле ложатся по
 * нему почти ровно, а точнее без разбора контейнера не узнать.
 */
export function readAheadRange(input: {
  sizeBytes: number;
  trimInSeconds: number;
  durationSeconds: number;
  budgetBytes: number;
}): { start: number; end: number } | null {
  const { sizeBytes, trimInSeconds, durationSeconds, budgetBytes } = input;
  if (sizeBytes <= 0 || budgetBytes <= 0) return null;
  const total = trimInSeconds + durationSeconds;
  const share = total > 0 ? Math.min(1, Math.max(0, trimInSeconds / total)) : 0;
  const start = Math.floor((sizeBytes * share) / mebibyte) * mebibyte;
  if (start >= sizeBytes) return null;
  return { start, end: Math.min(sizeBytes, start + budgetBytes) - 1 };
}

/**
 * Прочитать ролик впрок — в кэш системы, откуда его возьмёт рендерер.
 *
 * Прочитанное выбрасывается: память держит не служба, а система, и отдаёт её
 * сама, когда та нужнее. Любой отказ — пропавший файл, сеть, обрыв по
 * `signal` — это `null`, а не исключение: чтение впрок не имеет права уронить
 * эфир, который без него просто идёт с диска.
 */
export async function readAhead(
  item: { filePath: string; trimInSeconds: number; durationSeconds: number },
  signal: AbortSignal,
  freeMemoryBytes = freemem(),
): Promise<{ bytes: number; seconds: number } | null> {
  try {
    const { size } = await stat(item.filePath);
    const range = readAheadRange({
      sizeBytes: size,
      trimInSeconds: item.trimInSeconds,
      durationSeconds: item.durationSeconds,
      budgetBytes: readAheadBudgetBytes(freeMemoryBytes),
    });
    if (!range || signal.aborted) return null;
    const started = performance.now();
    let bytes = 0;
    const stream = createReadStream(item.filePath, {
      start: range.start,
      end: range.end,
      highWaterMark: 8 * mebibyte,
      signal,
    });
    for await (const chunk of stream) bytes += (chunk as Buffer).length;
    return { bytes, seconds: (performance.now() - started) / 1_000 };
  } catch {
    return null;
  }
}
