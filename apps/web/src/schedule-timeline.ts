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
    cursorSeconds += asset.declaredDurationSeconds ?? asset.durationSeconds;
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
