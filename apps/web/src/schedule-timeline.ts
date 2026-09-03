import type { MediaAsset, ScheduleMetadata, ScheduleSlot } from "./types.js";

const RUSSIAN_WEEKDAYS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const;

export interface ScheduleTimelineEntry {
  asset: MediaAsset;
  startTime: string;
  dayKey: string;
  dayLabel: string;
  dateLabel: string;
  startsNewDay: boolean;
}

export function buildScheduleTimeline(
  playlist: MediaAsset[],
  metadata: ScheduleMetadata | null,
  slot: ScheduleSlot,
  now = new Date(),
): ScheduleTimelineEntry[] {
  const anchor = parseLocalDate(metadata?.anchorDate) ?? scheduleAnchor(slot, now);
  const startSeconds = parseScheduleClock(metadata?.startTime ?? "12:00:00.00");
  let cursorSeconds = startSeconds + (metadata?.delaySeconds ?? 0);
  let previousDayKey: string | null = null;

  return playlist.map((asset) => {
    const startsAt = new Date(anchor);
    startsAt.setSeconds(cursorSeconds);
    const dayKey = localDateKey(startsAt);
    const entry: ScheduleTimelineEntry = {
      asset,
      startTime: formatAirTime(startsAt),
      dayKey,
      dayLabel: RUSSIAN_WEEKDAYS[startsAt.getDay()] ?? "Понедельник",
      dateLabel: formatAirDate(startsAt),
      startsNewDay: dayKey !== previousDayKey,
    };
    previousDayKey = dayKey;
    cursorSeconds += itemDurationSeconds(asset);
    return entry;
  });
}

function scheduleAnchor(slot: ScheduleSlot, now: Date): Date {
  const anchor = new Date(now);
  anchor.setHours(0, 0, 0, 0);
  const daysSinceMonday = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - daysSinceMonday + (slot === "future" ? 7 : 0));
  return anchor;
}

function parseLocalDate(value: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScheduleClock(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return 12 * 60 * 60;
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) +
    Number(`0.${match[4] ?? "0"}`);
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatAirDate(value: Date): string {
  return [
    String(value.getDate()).padStart(2, "0"),
    String(value.getMonth() + 1).padStart(2, "0"),
    value.getFullYear(),
  ].join(".");
}

function formatAirTime(value: Date): string {
  return [
    String(value.getHours()).padStart(2, "0"),
    String(value.getMinutes()).padStart(2, "0"),
    String(value.getSeconds()).padStart(2, "0"),
  ].join(":");
}

export interface ScheduleCatchUpPoint {
  assetId: string;
  itemIndex: number;
  /** Сколько секунд ролика уже прошло бы к этому моменту. */
  itemOffsetSeconds: number;
  /** Сколько прошло с начала расписания — для строки состояния. */
  elapsedSeconds: number;
}

/**
 * Где расписание находилось бы прямо сейчас, если бы эфир не прерывался.
 *
 * Это ответ на вопрос «с чего поднимать эфир после падения»: не с того места,
 * где он оборвался, а с того, которое зритель ждёт увидеть в эту минуту.
 * Расписание привязано к времени суток, поэтому после часового простоя
 * подъём с места обрыва означал бы сдвинутый на час эфир — и дальше он ехал
 * бы так до конца недели.
 *
 * Длительность берётся ровно та же, что и у списка расписания: разойдись они,
 * строка «в эфире с 12:40» показывала бы одно, а подъём начинался с другого.
 *
 * `null` — расписание ещё не началось или уже кончилось: тогда решать нечего,
 * и подъём остаётся за оператором.
 */
export function scheduleCatchUpPoint(
  playlist: MediaAsset[],
  metadata: ScheduleMetadata | null,
  slot: ScheduleSlot,
  now = new Date(),
): ScheduleCatchUpPoint | null {
  if (playlist.length === 0) return null;
  const anchor = parseLocalDate(metadata?.anchorDate) ?? scheduleAnchor(slot, now);
  const startsAt = new Date(anchor);
  startsAt.setSeconds(
    parseScheduleClock(metadata?.startTime ?? "12:00:00.00") + (metadata?.delaySeconds ?? 0),
  );
  const elapsedSeconds = (now.getTime() - startsAt.getTime()) / 1_000;
  if (elapsedSeconds < 0) return null;

  let cursorSeconds = 0;
  for (const [itemIndex, asset] of playlist.entries()) {
    const duration = itemDurationSeconds(asset);
    if (elapsedSeconds < cursorSeconds + duration) {
      return {
        assetId: asset.id,
        itemIndex,
        // Хвост ролика короче кадра эфиру не нужен: начинать с последних
        // сотых значит выдать в линию обрывок вместо передачи.
        itemOffsetSeconds: Math.min(
          Math.max(0, elapsedSeconds - cursorSeconds),
          Math.max(0, duration - 0.04),
        ),
        elapsedSeconds,
      };
    }
    cursorSeconds += duration;
  }
  return null;
}

/** Длительность строки расписания — одна на список и на догон. */
function itemDurationSeconds(asset: MediaAsset): number {
  return asset.declaredDurationSeconds ?? asset.durationSeconds;
}
