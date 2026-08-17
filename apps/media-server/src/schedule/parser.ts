import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parsedScheduleSchema,
  type ParsedSchedule,
  type ParsedScheduleItem,
  type ScheduleGraphicElement,
  type ScheduleItemType,
} from "@gruber/contracts";

const targetDurationSeconds = 7 * 24 * 60 * 60;
const maximumScheduleBytes = 5 * 1024 * 1024;
const headerPattern = /^start\s+on\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*-\s*delay\s+(\d+(?:\.\d+)?)\s*$/i;
const itemPattern = /^(movie|chop|clip)\s+(\d{2,}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(.+)$/i;
const agePattern = /^insertAgeTitle\s*\{([^}]*)\}(?:\s+duration\s*\{(\d+)\})?\s*$/i;
const logoPattern = /^insertLogoTitle\s*\{([^}]*)\}\s*$/i;
const graphicPattern = /^insertGraphicElement_(?:\{([^}]*)\}|([^\s]+))\s+backgroundPath\s*\{([^}]*)\}\s+((?:titlePath(?:#\d+)?\s*\{[^}]*\}\s*)*)duration\s*\{([^}]*)\}\s+startOn\s*\{([^}]*)\}(?:\s+endOn\s*\{([^}]*)\})?\s*$/i;
const graphicTitlePattern = /titlePath(?:#(\d+))?\s*\{([^}]*)\}/gi;
const srtPattern = /^insertSRT\s*\{([^}]*)\}(?:\s*state\s*\{(on|off)\})?\s*$/i;
// Путь дорожки сам начинается с {язык}, поэтому внешние скобки закрываются жадно.
const audioTrackPattern = /^insertAudioTrack_\{([^}]{1,32})\}\s*\{(.+)\}\s*$/i;

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
  let pendingAgeTitleDurationSeconds: number | null = null;
  let pendingLogoPath: string | null = null;
  let pendingGraphicElements: ScheduleGraphicElement[] = [];
  let pendingSrtPath: string | null = null;
  let pendingSrtEnabled = true;
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
      pendingAgeTitleDurationSeconds = parseAgeDuration(age[2], entry.lineNumber);
      continue;
    }
    const logo = line.match(logoPattern);
    if (logo) {
      pendingLogoPath = requiredDirectiveValue(logo[1], "insertLogoTitle", entry.lineNumber);
      continue;
    }
    const graphic = line.match(graphicPattern);
    if (graphic) {
      const name = requiredDirectiveValue(
        graphic[1] ?? graphic[2],
        "insertGraphicElement",
        entry.lineNumber,
      );
      const backgroundPath = optionalDirectiveValue(graphic[3]);
      const titleDirectives = [...(graphic[4] ?? "").matchAll(graphicTitlePattern)];
      const titlePath = optionalDirectiveValue(
        titleDirectives.find((directive) => directive[1] == null)?.[2],
      );
      const titlePaths = titleDirectives
        .filter((directive) => directive[1] != null)
        .sort((left, right) => Number(left[1]) - Number(right[1]))
        .map((directive) => directive[2] ?? "");
      if (!backgroundPath && !titlePath) {
        throw new ScheduleParseError(
          `Line ${entry.lineNumber}: insertGraphicElement requires backgroundPath or titlePath`,
        );
      }
      const startOnSeconds = parseDirectiveTime(
        graphic[6] ?? "",
        `Line ${entry.lineNumber}: invalid graphic startOn`,
        false,
      );
      const declaredDurationSeconds = parseDirectiveTime(
        graphic[5] ?? "",
        `Line ${entry.lineNumber}: invalid graphic duration`,
        true,
      );
      const endOnSeconds = graphic[7]
        ? parseDirectiveTime(
            graphic[7],
            `Line ${entry.lineNumber}: invalid graphic endOn`,
            false,
          )
        : startOnSeconds + declaredDurationSeconds;
      if (endOnSeconds <= startOnSeconds) {
        throw new ScheduleParseError(
          `Line ${entry.lineNumber}: graphic endOn must be after startOn`,
        );
      }
      pendingGraphicElements.push({
        backgroundPath,
        durationSeconds: endOnSeconds - startOnSeconds,
        endOnSeconds,
        name,
        startOnSeconds,
        titlePath,
        titlePaths,
      });
      continue;
    }
    const srt = line.match(srtPattern);
    if (srt) {
      pendingSrtPath = requiredDirectiveValue(srt[1], "insertSRT", entry.lineNumber);
      pendingSrtEnabled = (srt[2] ?? "on").toLowerCase() !== "off";
      continue;
    }

    const audioTrack = line.match(audioTrackPattern);
    if (audioTrack) {
      const previous = items[items.length - 1];
      if (!previous) {
        warnings.push(`Line ${entry.lineNumber}: insertAudioTrack has no preceding media item`);
        continue;
      }
      const language = requiredDirectiveValue(audioTrack[1], "insertAudioTrack", entry.lineNumber);
      const filePath = requiredDirectiveValue(audioTrack[2], "insertAudioTrack", entry.lineNumber);
      if (previous.audioTracks.some((track) => track.language === language)) {
        warnings.push(`Line ${entry.lineNumber}: duplicate audio track ${language} ignored`);
        continue;
      }
      previous.audioTracks.push({ language, filePath });
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
      for (const graphicElement of pendingGraphicElements) {
        if (graphicElement.startOnSeconds + graphicElement.durationSeconds > declaredDurationSeconds) {
          itemWarnings.push(
            `Line ${entry.lineNumber}: graphic ${graphicElement.name} exceeds clip duration`,
          );
        }
      }
      items.push({
        ageTitle: pendingAgeTitle,
        ageTitleDurationSeconds: pendingAgeTitle
          ? pendingAgeTitleDurationSeconds ?? 10
          : null,
        declaredDuration,
        declaredDurationSeconds,
        filePath,
        graphicElements: pendingGraphicElements,
        lineNumber: entry.lineNumber,
        logoPath: pendingLogoPath,
        srtPath: pendingSrtPath,
        srtEnabled: pendingSrtPath ? pendingSrtEnabled : true,
        audioTracks: [],
        type,
        warnings: itemWarnings,
      });
      warnings.push(...itemWarnings);
      pendingAgeTitle = null;
      pendingAgeTitleDurationSeconds = null;
      pendingLogoPath = null;
      pendingGraphicElements = [];
      pendingSrtPath = null;
      pendingSrtEnabled = true;
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
  if (pendingGraphicElements.length > 0) {
    warnings.push("insertGraphicElement at end of file has no following media item");
  }
  if (pendingSrtPath) warnings.push("insertSRT at end of file has no following media item");

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

function optionalDirectiveValue(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}

function parseDirectiveTime(value: string, message: string, positive: boolean): number {
  const normalized = value.trim();
  const parsed = normalized.includes(":")
    ? parseClock(normalized, true, message)
    : Number(normalized);
  if (!Number.isFinite(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    throw new ScheduleParseError(message);
  }
  return parsed;
}

function parseAgeDuration(value: string | undefined, lineNumber: number): number | null {
  if (value === undefined) return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 10 || duration > 60) {
    throw new ScheduleParseError(
      `Line ${lineNumber}: AGE duration must be an integer from 10 to 60 seconds`,
    );
  }
  return duration;
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
