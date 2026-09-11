import { scheduleItemTypeFor } from "@gruber/contracts";
import { airDurationSeconds } from "./clip-duration.js";
import type { MediaAsset } from "./types.js";

/* -------------------------------------------------------------------------- *
 * Разделение ролика на части.
 *
 * Фильм в эфире режут рекламой: оператор ставит точки среза, между частями
 * встаёт пометка «Рекламный блок», а сами части идут в эфир отрезками одного
 * файла. Часть — обычная строка расписания со своей точкой входа в файле
 * (`trimInSeconds`) и длиной (`declaredDurationSeconds`), поэтому эфир,
 * отметка старта, горячая замена и расписание `.txt` работают с ней как с
 * любым роликом.
 * ------------------------------------------------------------------------- */

export const defaultBreakComment = "Рекламный блок";
/** Самая короткая часть: срез короче секунды — промах мышью, а не монтаж. */
export const minimumPartSeconds = 1;
export const maximumSplitParts = 10;
/** Путь строки-пометки: файла у неё нет, а схема сессии требует непустой путь. */
export const commentRowPath = "comment://break";

export interface SplitPart {
  startSeconds: number;
  endSeconds: number;
  name: string;
}

export interface SplitDraft {
  parts: SplitPart[];
  /** Пометки между частями: `comments[i]` встаёт после части `i`. */
  comments: string[];
}

export interface SplitRange {
  startSeconds: number;
  endSeconds: number;
}

/** Отрезок файла, который занимает строка: у уже разрезанной части он свой. */
export function splitRange(asset: MediaAsset): SplitRange {
  const startSeconds = asset.trimInSeconds ?? 0;
  return { startSeconds, endSeconds: startSeconds + airDurationSeconds(asset) };
}

/** Сколько частей помещается в строку, если каждой нужна хотя бы секунда. */
export function maximumPartsFor(range: SplitRange): number {
  return Math.min(
    maximumSplitParts,
    Math.floor((range.endSeconds - range.startSeconds) / minimumPartSeconds),
  );
}

/**
 * Равные части по целым секундам: круглые точки среза проще проверить глазом.
 * Названия и пометки, уже набранные оператором, переживают смену числа частей.
 */
export function evenSplitDraft(asset: MediaAsset, count: number, previous?: SplitDraft): SplitDraft {
  const range = splitRange(asset);
  const parts = Math.max(2, Math.min(Math.floor(count), maximumPartsFor(range)));
  const length = (range.endSeconds - range.startSeconds) / parts;
  const cut = (index: number) => Math.round(range.startSeconds + length * index);
  return {
    parts: Array.from({ length: parts }, (_, index) => ({
      startSeconds: index === 0 ? range.startSeconds : cut(index),
      endSeconds: index === parts - 1 ? range.endSeconds : cut(index + 1),
      name: previous?.parts[index]?.name ?? `${asset.name} · часть ${index + 1}`,
    })),
    comments: Array.from(
      { length: parts - 1 },
      (_, index) => previous?.comments[index] ?? defaultBreakComment,
    ),
  };
}

/**
 * Правка точки среза.
 *
 * Конец части — начало следующей: срез двигает обе, иначе между частями
 * остался бы кусок, который не выйдет в эфир, или повтор, который выйдет
 * дважды. Начало следующей части можно увести позже конца предыдущей — так
 * вырезают, например, титры внутри фильма, — но не раньше. Каждая точка зажата
 * соседями и длиной ролика: увести срез за соседний или за конец файла нельзя.
 */
export function moveSplitPoint(
  draft: SplitDraft,
  range: SplitRange,
  index: number,
  edge: "start" | "end",
  seconds: number,
): SplitDraft {
  const parts = draft.parts.map((part) => ({ ...part }));
  const part = parts[index];
  if (!part || !Number.isFinite(seconds)) return draft;
  const previous = parts[index - 1];
  const next = parts[index + 1];
  if (edge === "start") {
    part.startSeconds = clamp(
      seconds,
      previous?.endSeconds ?? range.startSeconds,
      part.endSeconds - minimumPartSeconds,
    );
  } else {
    // Следующей части остаётся хотя бы секунда до её собственного конца.
    const linked = next?.startSeconds === part.endSeconds;
    part.endSeconds = clamp(
      seconds,
      part.startSeconds + minimumPartSeconds,
      next ? next.endSeconds - minimumPartSeconds : range.endSeconds,
    );
    if (next && (linked || next.startSeconds < part.endSeconds)) next.startSeconds = part.endSeconds;
  }
  return { ...draft, parts };
}

/** Что мешает создать разделение; пусто — можно. */
export function splitDraftIssues(draft: SplitDraft, range: SplitRange): string[] {
  const issues: string[] = [];
  draft.parts.forEach((part, index) => {
    if (part.endSeconds - part.startSeconds < minimumPartSeconds) {
      issues.push(`часть ${index + 1} короче секунды`);
    }
    if (!part.name.trim()) issues.push(`у части ${index + 1} нет названия`);
  });
  const first = draft.parts[0];
  const last = draft.parts.at(-1);
  if (!first || !last || first.startSeconds < range.startSeconds || last.endSeconds > range.endSeconds) {
    issues.push("части выходят за длину ролика");
  }
  // Название и пометка уходят в расписание внутри фигурных скобок.
  if ([...draft.parts.map((part) => part.name), ...draft.comments].some((text) => /[{}\r\n]/.test(text))) {
    issues.push("фигурные скобки в названии или комментарии");
  }
  return issues;
}

/**
 * Строки, которыми разрезанный ролик встаёт в расписание.
 *
 * Обвязка раздаётся частям по времени: метка SCTE-35, показ сцены, FX-слой и
 * звуковая вставка уходят в ту часть, где начинаются, со сдвигом к её началу, —
 * «Смотрите далее» в конце фильма остаётся в конце последней части. Логотип,
 * субтитры и дорожки перевода нужны каждой части, маркировка — тоже: возрастной
 * знак показывают в начале программы и после каждого рекламного блока.
 */
export function splitAssetRows(
  asset: MediaAsset,
  draft: SplitDraft,
  newId: () => string,
): MediaAsset[] {
  const origin = asset.trimInSeconds ?? 0;
  // Разрез уже разрезанной части продолжает её разрез: весь фильм красится одним цветом.
  const splitGroupId = asset.splitGroupId ?? `split-${newId()}`;
  return draft.parts.flatMap((part, index) => {
    const start = part.startSeconds;
    const end = part.endSeconds;
    const last = index === draft.parts.length - 1;
    // Точка на самом срезе принадлежит следующей части; конец файла — последней.
    const contains = (seconds: number) => seconds >= start && (seconds < end || (last && seconds <= end));
    const row: MediaAsset = {
      ...asset,
      id: newId(),
      name: part.name.trim(),
      duration: formatSplitTimecode(end - start),
      trimInSeconds: start,
      declaredDurationSeconds: end - start,
      scheduleType: scheduleItemTypeFor(end - start),
      splitGroupId,
      scte35Markers: asset.scte35Markers?.filter((marker) => contains(marker.positionSeconds)),
      scenes: asset.scenes
        ?.filter((show) => contains(origin + show.startSeconds))
        .map((show) => ({
          ...show,
          startSeconds: origin + show.startSeconds - start,
          durationSeconds: Math.max(0.04, Math.min(show.durationSeconds, end - origin - show.startSeconds)),
        })),
      effects: asset.effects
        ?.filter((layer) => contains(origin + layer.startSeconds) && origin + layer.startSeconds < end)
        .map((layer) => ({
          ...layer,
          startSeconds: origin + layer.startSeconds - start,
          endSeconds: Math.min(origin + layer.endSeconds, end) - start,
        })),
      audioOverlays: asset.audioOverlays
        ?.filter((overlay) => contains(origin + overlay.startSeconds) && origin + overlay.startSeconds < end)
        .map((overlay) => ({
          ...overlay,
          startSeconds: origin + overlay.startSeconds - start,
          durationSeconds: Math.min(overlay.durationSeconds, end - origin - overlay.startSeconds),
        })),
    };
    const comment = draft.comments[index];
    return comment === undefined || last ? [row] : [row, commentRow(comment, newId())];
  });
}

/** Пометка между частями: без файла, без хронометража, в эфир не уходит. */
export function commentRow(text: string, id: string): MediaAsset {
  return {
    id,
    name: text.trim() || defaultBreakComment,
    rowKind: "comment",
    duration: "",
    durationSeconds: 0,
    codec: "",
    codecFamily: "",
    codecProfile: "",
    resolution: "",
    fps: "",
    bitrate: "",
    size: "",
    status: "analyzed",
    preview: commentRowPath,
    filePath: commentRowPath,
    colorSpace: "",
    audio: "",
    sha256: "",
  };
}

/**
 * Разрез, узнанный по самому расписанию.
 *
 * В `.txt` часть — строка с точкой входа, и пометки «это части одного фильма»
 * файл не несёт: её восстанавливает стык. Строка того же файла, которая
 * начинается ровно там, где кончилась предыдущая его строка, — следующая часть
 * того же разреза, даже если между ними стоит реклама.
 */
export function splitGroupsFromSchedule(
  items: readonly { filePath: string; inPointSeconds: number; declaredDurationSeconds: number }[],
): (string | null)[] {
  const groups: (string | null)[] = items.map(() => null);
  const lastEnd = new Map<string, { index: number; endSeconds: number }>();
  items.forEach((item, index) => {
    const previous = lastEnd.get(item.filePath);
    if (item.inPointSeconds > 0 && previous && Math.abs(previous.endSeconds - item.inPointSeconds) < 0.02) {
      const group = groups[previous.index] ?? `split-${previous.index}`;
      groups[previous.index] = group;
      groups[index] = group;
    }
    lastEnd.set(item.filePath, { index, endSeconds: item.inPointSeconds + item.declaredDurationSeconds });
  });
  return groups;
}

/** Тайм-код части: `ЧЧ:ММ:СС:КК` при 25 кадрах — так его читает эфирный монтажёр. */
export function formatSplitTimecode(seconds: number): string {
  const frames = Math.max(0, Math.round(seconds * 25));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(frames / 90_000))}:${pad(Math.floor(frames / 1_500) % 60)}:` +
    `${pad(Math.floor(frames / 25) % 60)}:${pad(frames % 25)}`;
}

/**
 * Разбор введённого времени: `ЧЧ:ММ:СС:КК`, `ЧЧ:ММ:СС`, `ММ:СС` или секунды.
 * Недописанное — `null`: поле держит черновик, а не прыгает к нулю.
 */
export function parseSplitTimecode(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const groups = text.split(":");
  if (groups.length < 2 || groups.length > 4 || groups.some((group) => !/^\d+(?:\.\d+)?$/.test(group))) {
    return null;
  }
  const numbers = groups.map(Number);
  const [hours = 0, minutes = 0, seconds = 0, frames = 0] = groups.length === 2
    ? [0, ...numbers]
    : numbers;
  if (minutes >= 60 || seconds >= 60 || frames >= 25) return null;
  return Math.round((hours * 3_600 + minutes * 60 + seconds + frames / 25) * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
