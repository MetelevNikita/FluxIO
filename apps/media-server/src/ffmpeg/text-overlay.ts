import type { BroadcastTextOverlay, BroadcastTextStyle } from "@gruber/contracts";

/**
 * Надписи эфирных эффектов второго уровня: произвольный Dynamic title,
 * бегущая строка, часы и обратный отсчёт. Всё рисует `drawtext`, потому что:
 *
 * • бегущая строка обязана идти с постоянной скоростью независимо от длины
 *   текста — это возможно только через выражение с `tw` (шириной надписи),
 *   которая известна лишь во время рендера;
 * • часы и отсчёт нельзя «запечь» в кадры: rolling playout запускает рендерер
 *   следующего ролика заранее, и заранее нарисованное время уехало бы.
 *
 * Часы привязаны к абсолютному эфирному времени ролика (`airEpochSeconds`), а не
 * к системным часам рендерера, поэтому предзапущенный рендерер показывает то же
 * время, что и вышедший в эфир кадр.
 */

export interface TextOverlayFrame {
  width: number;
  height: number;
  /** UNIX-время первого кадра ролика. Нужно только режиму `clock`. */
  airEpochSeconds: number;
}

/**
 * Полоса, внутри которой едет бегущая строка: строка рисуется на отдельном
 * прозрачном холсте этого размера и накладывается на кадр, поэтому текст
 * физически не может выйти за её края. `null` — полоса во весь кадр, отдельный
 * холст не нужен.
 */
export function tickerRegion(
  overlay: BroadcastTextOverlay,
  frame: TextOverlayFrame,
): { x: number; y: number; width: number; height: number } | null {
  if (overlay.mode !== "ticker" || overlay.regionWidthPercent >= 100) return null;
  const width = Math.max(16, Math.round(frame.width * overlay.regionWidthPercent / 100));
  // Высота с запасом на выносные элементы букв.
  const height = Math.max(8, Math.round(fontSize(overlay.style, frame.height) * 1.8));
  return {
    height,
    width,
    x: Math.round(frame.width * overlay.regionXPercent / 100),
    y: Math.round(frame.height * overlay.style.yPercent / 100) - Math.round(height / 2),
  };
}

/** Один аргумент фильтра `drawtext` без завершающей запятой. */
export function buildTextOverlayFilter(
  overlay: BroadcastTextOverlay,
  frame: TextOverlayFrame,
  /** Строка рисуется на своём холсте: координаты считаются от его левого верха. */
  insideRegion = false,
): string {
  const options = [
    `text='${overlayText(overlay, frame)}'`,
    `x='${overlayX(overlay, frame)}'`,
    // Y — это середина строки по высоте, а не её верх: так надпись попадает
    // ровно на место текстового слоя Lottie, чья координата тоже даёт середину.
    insideRegion
      ? "y='(h-th)/2'"
      : `y='${Math.round(frame.height * overlay.style.yPercent / 100)}-th/2'`,
    `fontsize=${fontSize(overlay.style, frame.height)}`,
    `fontcolor=${overlay.style.color}`,
    ...(overlay.style.fontFilePath
      ? [`fontfile='${escapeFilterValue(overlay.style.fontFilePath)}'`]
      : []),
    ...(overlay.style.boxEnabled
      ? [
          "box=1",
          `boxcolor=${overlay.style.boxColor}@${decimal(overlay.style.boxOpacity)}`,
          `boxborderw=${Math.max(0, Math.round(frame.height * overlay.style.boxPaddingPercent / 100))}`,
        ]
      : []),
    `enable='between(t,${decimal(overlay.startSeconds)},${decimal(overlay.endSeconds)})'`,
  ];
  return `drawtext=${options.join(":")}`;
}

/**
 * Содержимое надписи.
 *
 * Двоеточие обязано быть экранировано даже внутри кавычек: кавычки снимаются
 * разбором графа, а на опции `key=value` строка делится уже после этого — по
 * неэкранированным `:`. Проверено эмпирически: без `\\:` FFmpeg падает на
 * `No option name near ...`. `%` в подстановках, наоборот, экранировать нельзя —
 * это маркер самой подстановки.
 */
function overlayText(overlay: BroadcastTextOverlay, frame: TextOverlayFrame): string {
  if (overlay.mode === "clock") {
    // gmtime + сдвиг пояса вместо localtime: результат не зависит от того, в
    // какой временной зоне запущен media-service.
    const epoch = Math.round(frame.airEpochSeconds + overlay.timezoneOffsetMinutes * 60);
    const part = (format: string) => `%{pts\\:gmtime\\:${epoch}\\:${format}}`;
    return clockParts(overlay.clockFormat, part("%H"), part("%M"), part("%S"));
  }
  if (overlay.mode === "countdown") {
    // Оставшееся время считается от точки запуска окна, поэтому отсчёт приходит
    // в ноль ровно на `startSeconds + countdownFromSeconds` без накопления ошибки.
    const remaining =
      `max(0,${decimal(overlay.countdownFromSeconds)}-(t-${decimal(overlay.startSeconds)}))`;
    const digits = (expression: string) => `%{eif\\:trunc(${expression})\\:d\\:2}`;
    return clockParts(
      overlay.clockFormat,
      digits(`${remaining}/3600`),
      digits(`mod(${remaining}/60,60)`),
      digits(`mod(${remaining},60)`),
    );
  }
  return escapeDrawtextContent(
    overlay.mode === "ticker" ? singleLine(overlay.content) : overlay.content,
  );
}

function clockParts(
  format: BroadcastTextOverlay["clockFormat"],
  hours: string,
  minutes: string,
  seconds: string,
): string {
  // Разделитель между подстановками — тоже экранированное двоеточие.
  if (format === "HH:MM") return `${hours}\\:${minutes}`;
  if (format === "MM:SS") return `${minutes}\\:${seconds}`;
  if (format === "SS") return seconds;
  return `${hours}\\:${minutes}\\:${seconds}`;
}

/**
 * Горизонтальная позиция. У бегущей строки она зависит от `tw` — ширины уже
 * отрисованной надписи, поэтому длинный и короткий текст едут одинаково быстро:
 * за секунду надпись смещается ровно на `speedPixelsPerSecond` пикселей, а
 * период одного круга равен `(w+tw)/speed`.
 */
function overlayX(overlay: BroadcastTextOverlay, frame: TextOverlayFrame): string {
  if (overlay.mode !== "ticker") {
    // Выключка считается по реальной ширине надписи (`tw`), поэтому
    // центрированный текст остаётся центрированным при любом значении.
    const anchor = Math.round(frame.width * overlay.style.xPercent / 100);
    if (overlay.style.align === "center") return `${anchor}-tw/2`;
    if (overlay.style.align === "right") return `${anchor}-tw`;
    return String(anchor);
  }
  const speed = decimal(overlay.speedPixelsPerSecond);
  const travelled = `(max(0,t-${decimal(overlay.startSeconds)})*${speed})`;
  const cycle = "(w+tw)";
  const wrapped = overlay.direction === "left"
    ? `w-mod(${travelled},${cycle})`
    : `-tw+mod(${travelled},${cycle})`;
  if (overlay.repeat === 0) return wrapped;
  // Задано конечное число кругов: после последнего надпись уезжает за кадр
  // насовсем. Скрыть её через `enable` нельзя — там нет доступа к `tw`.
  return `if(gte(${travelled},${overlay.repeat}*${cycle}),0-tw-16,${wrapped})`;
}

/** Готовый текст бегущей строки из списка сообщений и разделителя. */
export function joinTickerItems(items: readonly string[], separator: string): string {
  const messages = items.map((item) => singleLine(item)).filter((item) => item.length > 0);
  if (messages.length === 0) return "";
  // Разделитель ставится и в конце: на стыке круга последнее сообщение не
  // склеивается с первым.
  return messages.length === 1
    ? messages[0] ?? ""
    : `${messages.join(separator)}${separator}`;
}

export function fontSize(style: BroadcastTextStyle, frameHeight: number): number {
  return Math.max(8, Math.round(frameHeight * style.fontSizePercent / 100));
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Экранирование статического текста. `%` обязателен, иначе оператор случайно
 * запустит подстановку `%{}` и FFmpeg упадёт на разборе.
 */
function escapeDrawtextContent(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function escapeFilterValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function decimal(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}
