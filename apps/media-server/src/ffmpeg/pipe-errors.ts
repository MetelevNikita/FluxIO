import type { Writable } from "node:stream";

/* -------------------------------------------------------------------------- *
 * Ошибки трубы между процессами.
 *
 * Труба всегда закрывается с одной стороны раньше, чем с другой: рендерер
 * ролика уходит на EOF, а рисовальщик сцены в этот момент держит ещё кадр;
 * encoder закрывает вход на остановке, а мост дописывает хвост. Это штатная
 * смена ролика, а не отказ.
 *
 * Без обработчика такая ошибка роняет **всю службу вместе с эфиром**:
 * `pipe()` вешает на приёмник свой обработчик, но, не найдя рядом ни одного
 * пользовательского, переизлучает ошибку обратно — а необработанное событие
 * "error" на потоке заканчивается выходом процесса. Поэтому у каждого конца
 * трубы обработчик обязан быть, даже если он ничего не делает.
 * ------------------------------------------------------------------------- */

const expectedPipeErrorCodes = new Set([
  "ECONNRESET",
  "EOF",
  "EPIPE",
  "ERR_STREAM_ALREADY_FINISHED",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

export function isExpectedPipeError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && expectedPipeErrorCodes.has(code);
}

/**
 * Ставит на поток обработчик, который проглатывает закрытие трубы и отдаёт
 * наружу только то, что закрытием не объясняется.
 */
export function guardPipeErrors(
  stream: NodeJS.EventEmitter | null | undefined,
  report?: (error: NodeJS.ErrnoException) => void,
): void {
  stream?.on("error", (error: NodeJS.ErrnoException) => {
    if (isExpectedPipeError(error)) return;
    report?.(error);
  });
}

/**
 * Закрывает вход, если он ещё жив. `end()` по уже закрытой трубе сам по себе
 * даёт ошибку, а закрывать её приходится из нескольких мест сразу.
 */
export function endPipeQuietly(target: Writable): void {
  if (target.destroyed || target.writableEnded) return;
  target.end();
}

/**
 * Последняя страховка эфирного контура.
 *
 * Труб в службе много — рендерер ролика, рисовальщик сцены, encoder, TSDuck,
 * субтитры, — и любая, закрывшаяся без обработчика, уносила службу целиком:
 * эфир обрывался на середине ролика, а в журнале не оставалось ни строки.
 * Пропущенный обработчик стоит одного пропущенного кадра, а не всего эфира,
 * поэтому закрытая труба здесь переживается, а всё остальное по-прежнему
 * роняет процесс, как это делает Node без обработчика.
 *
 * Повтор одного и того же кода придерживается: труба закрывается на каждом
 * кадре, и без задержки журнал забился бы одинаковыми строками.
 */
export function brokenPipeGuard(
  report: (message: string) => void,
  onFatal: (error: Error) => void,
  repeatIntervalMs = 10_000,
  now: () => number = Date.now,
): (error: NodeJS.ErrnoException) => void {
  const lastReported = new Map<string, number>();
  return (error: NodeJS.ErrnoException) => {
    if (!isExpectedPipeError(error)) {
      onFatal(error);
      return;
    }
    const code = error.code ?? "EPIPE";
    const at = now();
    const previous = lastReported.get(code);
    if (previous != null && at - previous < repeatIntervalMs) return;
    lastReported.set(code, at);
    report(
      `Труба закрылась раньше, чем в неё дописали (${code}); ` +
        `служба продолжает эфир: ${error.message}`,
    );
  };
}

export function installBrokenPipeGuard(report: (message: string) => void): () => void {
  const handler = brokenPipeGuard(report, (error) => {
    // Не про трубу — ведём себя как Node без обработчика: печатаем и уходим.
    console.error(error);
    process.exit(1);
  });
  process.on("uncaughtException", handler);
  return () => { process.off("uncaughtException", handler); };
}
