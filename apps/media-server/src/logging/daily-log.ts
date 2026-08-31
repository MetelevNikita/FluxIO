import type { PlayoutStatus } from "@gruber/contracts";

/**
 * Суточный журнал работы приложения.
 *
 * Разбор на две части сделан намеренно: здесь только чистые функции — формат
 * строки, имя файла и накопление суточной статистики, — а запись на диск живёт
 * в `logger.ts`. Журнал обязан пережить падение эфира, поэтому в нём не должно
 * быть ничего, что само способно бросить исключение.
 *
 * Основа журнала — работа эфира: смена роликов, транспорт (UDP/SRT/RTMP),
 * ошибки. Статистика набирается из снимков `PlayoutStatus`, а не разбором
 * текста событий: текст меняется, поля контракта — нет.
 */

export type LogLevel = "info" | "warn" | "error";

export interface DailyStats {
  /** Локальная дата в формате YYYY-MM-DD — по ней же названа папка файла. */
  date: string;
  serviceStartedAt: string | null;
  sessions: SessionStats[];
  errors: string[];
  warnings: number;
}

interface SessionStats {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  endState: PlayoutStatus["state"] | null;
  endpointLabel: string | null;
  transportBitrateKbps: number | null;
  totalItems: number;
  /** Уникальные ролики, которые реально пошли в эфир. */
  airedItemIds: string[];
  lastItemName: string | null;
  airedSeconds: number;
  loopCount: number;
  scheduleTransitions: number;
  continuityErrors: number;
  scte35Events: number;
  errors: string[];
}

export function emptyDailyStats(date: string): DailyStats {
  return { date, errors: [], serviceStartedAt: null, sessions: [], warnings: 0 };
}

const maximumTrackedErrors = 200;

/** Уникальная ошибка суток. Повтор одного и того же текста счёт не увеличивает. */
export function recordError(stats: DailyStats, message: string): DailyStats {
  if (!message || stats.errors.includes(message)) return stats;
  return {
    ...stats,
    errors: stats.errors.length >= maximumTrackedErrors
      ? stats.errors
      : [...stats.errors, message],
  };
}

/** Локальная дата машины: сутки журнала считаются по её часам, а не по UTC. */
export function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function logFileName(date: Date): string {
  return `fluxio-${localDateKey(date)}.log`;
}

/** Каждая строка несёт дату и время локальных часов — включая строки ошибок. */
export function formatLogLine(
  date: Date,
  level: LogLevel,
  category: string,
  message: string,
): string {
  const text = message.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return `[${formatLocalStamp(date)}] ${level.toUpperCase().padEnd(5)} ${category.padEnd(9)} ${text}`;
}

/** Отметка времени по часам машины — в журнале нет ни одной величины в UTC. */
export function formatLocalStamp(date: Date): string {
  return `${localDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:` +
    `${String(date.getMinutes()).padStart(2, "0")}:` +
    `${String(date.getSeconds()).padStart(2, "0")}.` +
    `${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * Накопление статистики по снимку состояния эфира. Возвращает строки, которые
 * стоит записать в журнал: смена сессии, смена ролика, новая ошибка. Функция
 * чистая — она не пишет и не читает время сама.
 */
export function observeStatus(
  stats: DailyStats,
  status: PlayoutStatus,
  at: Date,
): { stats: DailyStats; entries: { level: LogLevel; category: string; message: string }[] } {
  const entries: { level: LogLevel; category: string; message: string }[] = [];
  if (!status.sessionId) return { entries, stats };

  const sessions = [...stats.sessions];
  const existing = sessions.find((candidate) => candidate.sessionId === status.sessionId);
  let session: SessionStats;
  if (existing) {
    session = { ...existing };
  } else {
    session = {
      airedItemIds: [],
      airedSeconds: 0,
      continuityErrors: 0,
      endState: null,
      endedAt: null,
      endpointLabel: status.endpointLabel,
      errors: [],
      lastItemName: null,
      loopCount: 0,
      scheduleTransitions: 0,
      scte35Events: 0,
      sessionId: status.sessionId,
      startedAt: status.startedAt ?? at.toISOString(),
      totalItems: status.totalItems,
      transportBitrateKbps: null,
    };
    sessions.push(session);
    entries.push({
      category: "AIR",
      level: "info",
      message: `Эфирная сессия ${status.sessionId} начата: ${status.totalItems} ролик(ов), ` +
        `выход ${status.endpointLabel ?? "не указан"}`,
    });
  }

  // Ролик считается вышедшим, когда становится текущим; повтор плейлиста тот же
  // ролик заново не считает — иначе суточная сводка врала бы на закольцованном эфире.
  if (status.currentItemId && !session.airedItemIds.includes(status.currentItemId)) {
    session.airedItemIds = [...session.airedItemIds, status.currentItemId];
    entries.push({
      category: "AIR",
      level: "info",
      message: `В эфире ${status.currentItemIndex + 1}/${status.totalItems}: ` +
        `"${status.currentItemName ?? status.currentItemId}" ` +
        `(${formatDuration(status.currentItemDurationSeconds)})`,
    });
  }
  if (status.currentItemName) session.lastItemName = status.currentItemName;
  session.airedSeconds = Math.max(session.airedSeconds, status.outTimeSeconds);
  session.continuityErrors = Math.max(session.continuityErrors, status.continuityErrors);
  session.scte35Events = Math.max(session.scte35Events, status.scte35.observedEvents);
  session.endpointLabel = status.endpointLabel ?? session.endpointLabel;
  session.totalItems = status.totalItems;
  if (status.transportBitrateBps) {
    session.transportBitrateKbps = Math.round(status.transportBitrateBps / 1_000);
  }
  if (status.loopCount > session.loopCount) {
    session.loopCount = status.loopCount;
    entries.push({
      category: "AIR",
      level: "info",
      message: `Плейлист начат заново, круг ${status.loopCount}`,
    });
  }
  if (status.scheduleTransitionCount > session.scheduleTransitions) {
    session.scheduleTransitions = status.scheduleTransitionCount;
    entries.push({
      category: "AIR",
      level: "info",
      message: "Эфир переключён на будущее расписание",
    });
  }

  // В счётчик ошибок суток попадают только настоящие отказы контура, а не
  // повествовательные строки вроде «сессия завершена (failed)».
  const dailyErrors = [...stats.errors];
  const errors = [status.error, status.scte35.error, status.subtitles.error]
    .filter((value): value is string => Boolean(value));
  for (const error of errors) {
    if (session.errors.includes(error)) continue;
    session.errors = [...session.errors, error];
    if (!dailyErrors.includes(error)) dailyErrors.push(error);
    entries.push({ category: "AIR", level: "error", message: error });
  }

  if (["stopped", "failed"].includes(status.state) && !session.endedAt) {
    session.endedAt = status.stoppedAt ?? at.toISOString();
    session.endState = status.state;
    entries.push({
      category: "AIR",
      level: status.state === "failed" ? "error" : "info",
      message: `Эфирная сессия ${session.sessionId} завершена (${status.state}): ` +
        `${session.airedItemIds.length} ролик(ов), ${formatDuration(session.airedSeconds)} в эфире`,
    });
  }

  return {
    entries,
    stats: {
      ...stats,
      errors: dailyErrors,
      sessions: sessions.map((candidate) =>
        candidate.sessionId === session.sessionId ? { ...session } : candidate),
    },
  };
}

/**
 * Суточный отчёт. Пишется в конец файла при смене суток и при остановке
 * сервиса — то есть в самом файле дня, к которому относится.
 */
export function buildDailyReport(stats: DailyStats, at: Date): string {
  const airedItems = stats.sessions.reduce((total, s) => total + s.airedItemIds.length, 0);
  const airedSeconds = stats.sessions.reduce((total, s) => total + s.airedSeconds, 0);
  const failed = stats.sessions.filter((s) => s.endState === "failed").length;
  const lines = [
    "",
    "=".repeat(78),
    `СУТОЧНЫЙ ОТЧЁТ ЗА ${stats.date} — сформирован ${formatLocalStamp(at)}`,
    "=".repeat(78),
    `Сервис запущен:        ${stats.serviceStartedAt ?? "в этот день не запускался"}`,
    `Эфирных сессий:        ${stats.sessions.length}` +
      (failed > 0 ? ` (аварийно завершено: ${failed})` : ""),
    `Роликов выдано:        ${airedItems}`,
    `Суммарно в эфире:      ${formatDuration(airedSeconds)}`,
    `Ошибок за сутки:       ${stats.errors.length}`,
    `Предупреждений:        ${stats.warnings}`,
  ];

  for (const session of stats.sessions) {
    lines.push(
      "",
      `— Сессия ${session.sessionId}`,
      `  Начало / конец:      ${localStampOf(session.startedAt)} → ` +
        `${session.endedAt ? localStampOf(session.endedAt) : "не завершена"}` +
        (session.endState ? ` (${session.endState})` : ""),
      `  Выход:               ${session.endpointLabel ?? "не указан"}` +
        (session.transportBitrateKbps ? ` @ ${session.transportBitrateKbps} кбит/с` : ""),
      `  Роликов:             ${session.airedItemIds.length} из ${session.totalItems}` +
        (session.lastItemName ? `, последний — "${session.lastItemName}"` : ""),
      `  В эфире:             ${formatDuration(session.airedSeconds)}`,
      `  Кругов плейлиста:    ${session.loopCount}`,
      `  Переходов на Future: ${session.scheduleTransitions}`,
      `  Ошибок непрерывности TS: ${session.continuityErrors}`,
      `  Меток SCTE-35:       ${session.scte35Events}`,
    );
    for (const error of session.errors) lines.push(`  ОШИБКА: ${error}`);
  }

  lines.push("=".repeat(78), "");
  return lines.join("\n");
}

/** Отметки контура приходят в ISO/UTC — в отчёте показываем их по часам машины. */
function localStampOf(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? isoTimestamp : formatLocalStamp(date);
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return [
    String(Math.floor(total / 3_600)).padStart(2, "0"),
    String(Math.floor((total % 3_600) / 60)).padStart(2, "0"),
    String(total % 60).padStart(2, "0"),
  ].join(":");
}
