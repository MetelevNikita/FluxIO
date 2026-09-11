import type { PlaybackMode, StartPlayoutRequest } from "@gruber/contracts";
import { airDurationSeconds } from "./clip-duration.js";
import {
  scheduleCatchUpPoint,
  scheduleStartsAt,
  type ScheduleCatchUpPoint,
} from "./schedule-timeline.js";
import type { MediaAsset, ScheduleMetadata, ScheduleSlot } from "./types.js";

/* -------------------------------------------------------------------------- *
 * Тип воспроизведения — форма, в которой расписание выходит в эфир.
 *
 * Выбирает её оператор, потому что у эфира две разные жизни. Одна — список
 * файлов: пустил с любого места, крутится по кругу. Другая — время, которое
 * эфир обязан заполнить: зритель ждёт передачу в своё время, и эфир, уехавший
 * за край окна, залез бы на следующую программу.
 *
 * - `free` — произвольное: старт с любого ролика, плейлист по кругу.
 * - `planned` — планируемое: начало и конец задаёт оператор, промежуток между
 *   ними — время заполнения. Старт с любого ролика в любой момент до конца, а
 *   кончается эфир в заданный конец.
 * - `weekly` — недельное: то же окно, но конец ставится сам — то же время через
 *   семь дней, — и старт **только по часам**: с того ролика и той секунды, что
 *   идут сейчас по сетке.
 *
 * Окно живёт в метаданных расписания: начало — `anchorDate` + `startTime`,
 * время заполнения — `targetDurationSeconds`. Не в настройках станции: у
 * Current и Future формы разные, и Future уходит в эфир со своей.
 * ------------------------------------------------------------------------- */

/** Черновик окна «Тип воспроизведения». */
export interface PlaybackDraft {
  mode: PlaybackMode;
  /** Начало окна: `ГГГГ-ММ-ДД` и `ЧЧ:ММ:СС`. */
  startDate: string;
  startTime: string;
  /** Конец планируемого. У недельного не выбирается — ровно семь дней. */
  endDate: string;
  endTime: string;
}

/**
 * С чего открывается окно.
 *
 * Расписание из файла уже знает время своего старта — для него это недельное с
 * его днём и часом. Просто список файлов — произвольное, а окно, если его всё
 * же выберут, начинается с текущей минуты. Конец по умолчанию — там, где
 * кончится сам список: время заполнения сразу совпадает с его длиной, и
 * оператору остаётся подвинуть край, а не считать.
 */
export function playbackDraftFrom(
  metadata: ScheduleMetadata | null,
  playlist: readonly MediaAsset[],
  now = new Date(),
): PlaybackDraft {
  const startDate = metadata?.anchorDate ?? localDate(now);
  const startTime = metadata?.startTime?.slice(0, 8) ?? `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  const listSeconds = playlist.reduce((sum, asset) => sum + airDurationSeconds(asset), 0);
  const fillSeconds = metadata?.playbackMode === "planned"
    ? metadata.targetDurationSeconds
    : Math.max(60, Math.round(listSeconds));
  const end = new Date(localMoment(startDate, startTime).getTime() + fillSeconds * 1_000);
  return {
    mode: metadata?.playbackMode ?? (metadata?.sourceFilePath ? "weekly" : "free"),
    startDate,
    startTime,
    endDate: localDate(end),
    endTime: localClock(end),
  };
}

/**
 * Метаданные расписания с выбранной формой.
 *
 * У просто списка файлов метаданных нет — они заводятся здесь же: иначе форму
 * негде хранить, и после перезапуска она терялась бы вместе с сессией.
 * Время заполнения не зажимается: конец раньше начала — ошибка черновика, и
 * отсекает её окно выбора, а не тихая подмена здесь.
 */
export function applyPlaybackDraft(
  metadata: ScheduleMetadata | null,
  draft: PlaybackDraft,
): ScheduleMetadata {
  const startTime = normalizeClock(draft.startTime);
  const base: ScheduleMetadata = metadata ?? {
    sourceFilePath: "",
    sourceName: "",
    encoding: "utf-8",
    startTime: `${startTime}.00`,
    anchorDate: draft.startDate,
    delaySeconds: 0,
    targetDurationSeconds: 604_800,
    warnings: [],
  };
  if (draft.mode === "free") return { ...base, playbackMode: "free" };
  const start = localMoment(draft.startDate, startTime);
  // Конец недели — то же время суток через семь дней, а не плюс 168 часов: с
  // переводом часов внутри недели эти двое расходятся на час.
  const end = draft.mode === "weekly"
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7,
      start.getHours(), start.getMinutes(), start.getSeconds())
    : localMoment(draft.endDate, normalizeClock(draft.endTime));
  return {
    ...base,
    playbackMode: draft.mode,
    anchorDate: draft.startDate,
    startTime: `${startTime}.00`,
    targetDurationSeconds: (end.getTime() - start.getTime()) / 1_000,
  };
}

/** Окно эфира: начало и конец — начало плюс время заполнения. */
export function playbackWindow(
  metadata: ScheduleMetadata,
  slot: ScheduleSlot,
  now = new Date(),
): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(scheduleStartsAt(metadata, slot, now));
  return { startsAt, endsAt: new Date(startsAt.getTime() + metadata.targetDurationSeconds * 1_000) };
}

export type PlaybackStart =
  /** Ограничений нет: старт с любого ролика. */
  | { kind: "any-clip" }
  | { kind: "on-air"; point: ScheduleCatchUpPoint; endsAt: Date }
  | { kind: "not-started"; startsAt: Date }
  | { kind: "ended"; endsAt: Date }
  /** Неделя идёт, а ролики кончились раньше неё: поднимать эфир не с чего. */
  | { kind: "schedule-short"; endsAt: Date };

/**
 * Можно ли поднять эфир прямо сейчас — и откуда.
 *
 * Отказ здесь — не осторожность, а суть формы: после конца окна время уже не
 * заполнить, а недельный эфир, поднятый до начала недели, шёл бы по сетке,
 * которой зритель не ждёт.
 */
export function playbackStart(
  playlist: MediaAsset[],
  metadata: ScheduleMetadata | null,
  slot: ScheduleSlot,
  now = new Date(),
): PlaybackStart {
  const mode = metadata?.playbackMode;
  if (!metadata || (mode !== "planned" && mode !== "weekly")) return { kind: "any-clip" };
  const { startsAt, endsAt } = playbackWindow(metadata, slot, now);
  if (now >= endsAt) return { kind: "ended", endsAt };
  // Планируемое стартует с любого ролика и в любой момент до конца.
  if (mode === "planned") return { kind: "any-clip" };
  if (now < startsAt) return { kind: "not-started", startsAt };
  const point = scheduleCatchUpPoint(playlist, metadata, slot, now);
  return point ? { kind: "on-air", point, endsAt } : { kind: "schedule-short", endsAt };
}

/**
 * Запрос старта в выбранной форме.
 *
 * Применяется **последним**, после среза с середины ролика: и у планируемого,
 * и у недельного эфир кончается в конце окна от этой минуты, а не через
 * «столько-то» от старта — опоздавший старт не имеет права увезти эфир за край,
 * после которого идёт следующая программа. Формы нет — запрос не трогается, и
 * повтор по-прежнему решает кнопка «Повтор».
 */
export function withPlaybackMode(
  request: StartPlayoutRequest,
  metadata: ScheduleMetadata | null,
  slot: ScheduleSlot = "current",
  now = new Date(),
): StartPlayoutRequest {
  if (!metadata?.playbackMode) return request;
  if (metadata.playbackMode === "free") {
    return { ...request, repeatPlaylist: true, scheduleDurationSeconds: null };
  }
  const seconds = (playbackWindow(metadata, slot, now).endsAt.getTime() - now.getTime()) / 1_000;
  return { ...request, repeatPlaylist: false, scheduleDurationSeconds: Math.max(1, seconds) };
}

/** Секунды как `ЧЧ:ММ:СС`; часов может быть больше суток. */
export function formatClockDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${pad(Math.floor(total / 3_600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

const weekdays = {
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;

/** «Пн 07.09.2026 09:50» — момент эфира так, как его читает оператор. */
export function formatAirMoment(value: Date, language: "ru" | "en" = "ru"): string {
  const seconds = value.getSeconds() > 0 ? `:${pad(value.getSeconds())}` : "";
  return `${weekdays[language][value.getDay()]} ${pad(value.getDate())}.${pad(value.getMonth() + 1)}.` +
    `${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}${seconds}`;
}

/** Поле времени отдаёт `ЧЧ:ММ`, пока секунды не тронуты: догоняем до `ЧЧ:ММ:СС`. */
function normalizeClock(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value.slice(0, 8);
}

function localMoment(date: string, clock: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = clock.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function localClock(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
