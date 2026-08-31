import type { BroadcastEffectKind } from "@gruber/contracts";

export interface BroadcastTaskSummary {
  filePath: string;
  entryCount: number;
  fields: { key: string; populatedCount: number; samples: string[] }[];
  records: Record<string, string>[];
  warnings: string[];
}

export const broadcastEffectCatalog: {
  kind: BroadcastEffectKind;
  title: string;
  titleRu: string;
  summary: string;
  summaryEn: string;
}[] = [
  {
    kind: "animation-in-out",
    summary: "Входная и выходная анимация ролика с привязкой файлом задания",
    summaryEn: "Clip intro and outro animation driven by a task file",
    title: "Animation in/out",
    titleRu: "Анимация входа/выхода",
  },
  {
    kind: "dynamic-title",
    summary: "Плашка с произвольным текстом из интерфейса или файла задания",
    summaryEn: "Lower third with text from the interface or a task file",
    title: "Dynamic title",
    titleRu: "Динамическая плашка",
  },
  {
    kind: "next-program",
    summary: "Плашка «Смотрите далее» с названием следующего материала",
    summaryEn: "Up-next title with the name of the following programme item",
    title: "Next program",
    titleRu: "Следующая программа",
  },
  {
    kind: "ticker-crawl",
    summary: "Бегущая строка с постоянной скоростью при любой длине текста",
    summaryEn: "Ticker crawl with constant speed for any text length",
    title: "Ticker crawl",
    titleRu: "Бегущая строка",
  },
  {
    kind: "clock-countdown",
    summary: "Экранные часы по эфирному времени или обратный отсчёт",
    summaryEn: "On-screen air-time clock or countdown",
    title: "Clock / countdown",
    titleRu: "Часы / отсчёт",
  },
  {
    kind: "stinger-transition",
    summary: "Брендированный переход, закрывающий стык двух роликов",
    summaryEn: "Branded transition covering the cut between two clips",
    title: "Stinger transition",
    titleRu: "Стингер-переход",
  },
];

export function broadcastEffectTitle(
  kind: BroadcastEffectKind,
  tr?: (russian: string, english: string) => string,
): string {
  const entry = broadcastEffectCatalog.find((candidate) => candidate.kind === kind);
  if (!entry) return kind;
  return tr ? tr(entry.titleRu, entry.title) : entry.titleRu;
}
