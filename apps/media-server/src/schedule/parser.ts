import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parsedScheduleSchema,
  type ParsedSchedule,
  type ParsedScheduleItem,
  type ScheduleItemType,
} from "@gruber/contracts";

const targetDurationSeconds = 7 * 24 * 60 * 60;
const maximumScheduleBytes = 5 * 1024 * 1024;
const headerPattern = /^start\s+on\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*-\s*delay\s+(\d+(?:\.\d+)?)\s*$/i;
const itemPattern = /^(movie|chop|clip)\s+(\d{2,}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(.+)$/i;
const agePattern = /^insertAgeTitle\s*\{([^}]*)\}\s*$/i;
const logoPattern = /^insertLogoTitle\s*\{([^}]*)\}\s*$/i;

export class ScheduleParseError extends Error {}

export async function parseScheduleFile(filePath: string): Promise<ParsedSchedule> {
  if (!path.isAbsolute(filePath)) {
    throw new ScheduleParseError("Schedule path must be absolute");
  }
  if (!new Set([".txt", ".air"]).has(path.extname(filePath).toLowerCase())) {
    throw new ScheduleParseError("Schedule file must use .txt or .air extension");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ScheduleParseError("Schedule path is not a file");
  if (fileStat.size > maximumScheduleBytes) {
    throw new ScheduleParseError("Schedule file is larger than 5 MB");
  }
  const content = await readFile(filePath);
  const decoded = decodeScheduleBuffer(content);
  return parseScheduleText(decoded.text, filePath, decoded.encoding);
}

export function decodeScheduleBuffer(buffer: Uint8Array): {
  encoding: "utf-8" | "windows-1251";
  text: string;
} {
  try {
    return {
      encoding: "utf-8",
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""),
    };
  } catch {
    return {
      encoding: "windows-1251",
      text: new TextDecoder("windows-1251").decode(buffer).replace(/^\uFEFF/, ""),
    };
  }
}

export function parseScheduleText(
  text: string,
  sourceFilePath = "/schedule.air",
  encoding: "utf-8" | "windows-1251" = "utf-8",
): ParsedSchedule {
  let startTime: string | null = null;
  let startSeconds = 0;
  let delaySeconds = 0;
  let pendingAgeTitle: string | null = null;
  let pendingLogoPath: string | null = null;
  const items: ParsedScheduleItem[] = [];
  const warnings: string[] = [];

  for (const entry of logicalLines(text)) {
    const line = entry.text.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const header = line.match(headerPattern);
    if (header) {
      if (startTime) {
        warnings.push(`Line ${entry.lineNumber}: repeated start header ignored`);
        continue;
      }
      startTime = header[1] ?? null;
      startSeconds = parseClock(startTime ?? "", false, `Line ${entry.lineNumber}`);
      delaySeconds = parseNonNegative(header[2] ?? "", `Line ${entry.lineNumber}: invalid delay`);
      continue;
    }

    const age = line.match(agePattern);
    if (age) {
      pendingAgeTitle = requiredDirectiveValue(age[1], "insertAgeTitle", entry.lineNumber);
      continue;
    }
    const logo = line.match(logoPattern);
    if (logo) {
      pendingLogoPath = requiredDirectiveValue(logo[1], "insertLogoTitle", entry.lineNumber);
      continue;
    }

    const itemMatch = line.match(itemPattern);
    if (itemMatch) {
      const type = itemMatch[1]?.toLowerCase() as ScheduleItemType;
      const declaredDuration = itemMatch[2] ?? "";
      const declaredDurationSeconds = parseClock(
        declaredDuration,
        true,
        `Line ${entry.lineNumber}`,
      );
      if (declaredDurationSeconds <= 0) {
        throw new ScheduleParseError(`Line ${entry.lineNumber}: duration must be positive`);
      }
      const filePath = itemMatch[3]?.trim() ?? "";
      if (!filePath) throw new ScheduleParseError(`Line ${entry.lineNumber}: media path is empty`);
      const itemWarnings = validateTypeDuration(type, declaredDurationSeconds, entry.lineNumber);
      items.push({
        ageTitle: pendingAgeTitle,
        declaredDuration,
        declaredDurationSeconds,
        filePath,
        lineNumber: entry.lineNumber,
        logoPath: pendingLogoPath,
        type,
        warnings: itemWarnings,
      });
      warnings.push(...itemWarnings);
      pendingAgeTitle = null;
      pendingLogoPath = null;
      continue;
    }

    warnings.push(`Line ${entry.lineNumber}: unknown instruction ignored`);
  }

  if (!startTime) {
    throw new ScheduleParseError("Schedule header is missing: start on HH:MM:SS.ff - delay N");
  }
  if (items.length === 0) throw new ScheduleParseError("Schedule contains no media items");
  if (pendingAgeTitle) warnings.push("insertAgeTitle at end of file has no following media item");
  if (pendingLogoPath) warnings.push("insertLogoTitle at end of file has no following media item");

  const totalDurationSeconds = delaySeconds + items.reduce(
    (total, item) => total + item.declaredDurationSeconds,
    0,
  );
  return parsedScheduleSchema.parse({
    delaySeconds,
    encoding,
    items,
    sourceFilePath,
    startSeconds,
    startTime,
    targetDurationSeconds,
    totalDurationSeconds,
    varianceSeconds: totalDurationSeconds - targetDurationSeconds,
    warnings,
  });
}

function logicalLines(text: string): Array<{ lineNumber: number; text: string }> {
  return text.split(/\r?\n/).flatMap((sourceLine, index) => {
    const separated = sourceLine
      .replace(/}(?=(?:movie|chop|clip)\s+\d{2,}:\d{2}:\d{2})/gi, "}\n")
      .split("\n");
    return separated.map((line) => ({ lineNumber: index + 1, text: line }));
  });
}

function parseClock(value: string, allowLongHours: boolean, context: string): number {
  const match = value.match(/^(\d{2,}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) throw new ScheduleParseError(`${context}: invalid timecode ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(`0.${match[4] ?? "0"}`);
  if ((!allowLongHours && hours > 23) || minutes > 59 || seconds > 59) {
    throw new ScheduleParseError(`${context}: invalid timecode ${value}`);
  }
  return hours * 3_600 + minutes * 60 + seconds + fraction;
}

function parseNonNegative(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ScheduleParseError(message);
  return parsed;
}

function requiredDirectiveValue(
  value: string | undefined,
  directive: string,
  lineNumber: number,
): string {
  const result = value?.trim() ?? "";
  if (!result) throw new ScheduleParseError(`Line ${lineNumber}: ${directive} value is empty`);
  return result;
}

function validateTypeDuration(
  type: ScheduleItemType,
  seconds: number,
  lineNumber: number,
): string[] {
  if (type === "movie" && seconds <= 300) {
    return [`Line ${lineNumber}: movie duration should be longer than 5 minutes`];
  }
  if (type === "chop" && seconds >= 30) {
    return [`Line ${lineNumber}: chop duration should be shorter than 30 seconds`];
  }
  if (type === "clip" && seconds >= 300) {
    return [`Line ${lineNumber}: clip duration should be shorter than 5 minutes`];
  }
  return [];
}
