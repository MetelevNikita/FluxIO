import type { ParsedSchedule } from "@gruber/contracts";
import { matchingNamedAssetPath } from "./graphic-title-matching.js";
import type { MediaAsset } from "./types.js";

/* -------------------------------------------------------------------------- *
 * Ресурсы станции, восстановленные из расписания.
 *
 * Расписание несёт абсолютные пути к логотипу, картинкам маркировки, файлам
 * перевода и субтитрам. Панель ресурсов при импорте оставалась пустой, и
 * оператор видел «Not selected» там, где расписание всё принесло само —
 * а значит шёл выбирать папки заново и до тех пор не знал, что подхватилось,
 * а что нет.
 *
 * Папка выводится из самих путей и на диск за этим никто не ходит: чужое
 * расписание почти всегда приносит пути с другой машины, и сканирование
 * молча отдало бы пустой список вместо того, что в файле записано. Что из
 * этого реально лежит на диске, показывает проверка графики следом.
 * ------------------------------------------------------------------------- */

export interface ScheduleLibraries {
  /** Логотип: путь файла и папка, из которой он взят. */
  logoPath: string | null;
  logoSource: string | null;
  /** Картинки возрастной маркировки. */
  ageDirectory: string | null;
  agePaths: string[];
  /** Файлы субтитров. */
  subtitleDirectory: string | null;
  subtitlePaths: string[];
  /** Папка переводов. */
  audioDirectory: string | null;
}

/** Родительская папка пути. Разделитель берётся из самого пути: расписание с эфирной машины приходит с `\`. */
export function parentDirectoryOf(value: string): string {
  const separator = value.includes("\\") ? "\\" : "/";
  const index = value.lastIndexOf(separator);
  return index > 0 ? value.slice(0, index) : value;
}

/**
 * Пути, объявленные расписанием.
 *
 * Папка выбирается по большинству: у одного ролика логотип может быть свой,
 * и папка, взятая от первого попавшегося пути, увела бы оператора не туда.
 */
export function librariesFromSchedule(parsed: ParsedSchedule): ScheduleLibraries {
  // Папку считаем по всем вхождениям, а список файлов отдаём без повторов:
  // один логотип на двухстах роликах — это двести голосов за свою папку и
  // одна строка в списке.
  const logoPaths = collect(parsed, (item) => item.logoPath);
  const agePaths = collect(parsed, (item) => item.ageTitlePath);
  const subtitlePaths = collect(parsed, (item) => item.srtPath);
  const audioPaths = parsed.items.flatMap((item) => item.audioTracks.map((track) => track.filePath));
  const logoPath = mostCommon(logoPaths);

  return {
    logoPath,
    logoSource: logoPath ? parentDirectoryOf(logoPath) : null,
    ageDirectory: commonDirectory(agePaths),
    agePaths: [...new Set(agePaths)],
    subtitleDirectory: commonDirectory(subtitlePaths),
    subtitlePaths: [...new Set(subtitlePaths)],
    audioDirectory: commonDirectory(audioPaths),
  };
}

function collect(
  parsed: ParsedSchedule,
  pick: (item: ParsedSchedule["items"][number]) => string | null,
): string[] {
  return parsed.items.map(pick).filter((value): value is string => Boolean(value));
}

function commonDirectory(paths: readonly string[]): string | null {
  return mostCommon(paths.map(parentDirectoryOf));
}

/** Значение, встречающееся чаще прочих; при равенстве — первое по порядку. */
function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Пересопоставление субтитров с содержимым папки.
 *
 * `enableAll` включает субтитры каждому ролику, которому нашёлся файл, — так
 * ведёт себя первый выбор папки: оператор выбрал её именно затем, чтобы
 * субтитры пошли в эфир, а обходить сотню роликов ради галочки на каждом —
 * работа, которой он не просил. Дальше трогаются только уже включённые:
 * выключенный ролик оператор выключил намеренно, и возвращать ему субтитры
 * при каждой смене папки значит спорить с ним.
 */
export function reconcileSubtitleAssignments(
  items: MediaAsset[],
  subtitlePaths: string[],
  enableAll = false,
): MediaAsset[] {
  return items.map((asset) => {
    if (!enableAll && !asset.subtitles?.enabled) return asset;
    const filePath = matchingNamedAssetPath(asset.name, subtitlePaths);
    // Ролику, у которого субтитров и не было, пустая запись не нужна: она
    // только засоряет снимок сессии.
    if (!filePath && !asset.subtitles) return asset;
    return { ...asset, subtitles: { enabled: Boolean(filePath), filePath } };
  });
}

/** Сколько роликов получат субтитры из этой папки. */
export function countSubtitleMatches(items: MediaAsset[], subtitlePaths: string[]): number {
  return items.filter((asset) => matchingNamedAssetPath(asset.name, subtitlePaths)).length;
}
