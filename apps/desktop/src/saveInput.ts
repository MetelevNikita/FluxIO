/**
 * Проверка payload, пришедшего из renderer перед записью на диск.
 * Renderer доверенный, но сохранять произвольные путь/размер нельзя.
 */

const invalidNamePattern = /[\\/:*?"<>|]/;
const megabyte = 1024 * 1024;

export interface ScheduleSaveInput {
  content: string;
  defaultName: string;
  extension: "txt";
}

export interface TextFileSaveInput {
  content: string;
  defaultName: string;
}

export function scheduleSaveInput(value: unknown): ScheduleSaveInput {
  const candidate = asRecord(value, "Invalid schedule save request");

  if (candidate.extension !== "txt") {
    throw new Error("Invalid schedule extension");
  }

  return {
    content: validContent(candidate.content, 10 * megabyte, "Schedule content"),
    defaultName: validFileName(candidate.defaultName, "Invalid schedule file name"),
    extension: "txt",
  };
}

export function textFileSaveInput(value: unknown): TextFileSaveInput {
  const candidate = asRecord(value, "Invalid text file save request");

  return {
    content: validContent(candidate.content, megabyte, "Encoding settings content"),
    defaultName: validFileName(candidate.defaultName, "Invalid encoding settings file name"),
  };
}

//

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error(message);

  return value as Record<string, unknown>;
}

function validContent(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be between 1 byte and ${maxLength / megabyte} MB`);
  }

  return value;
}

function validFileName(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim() || invalidNamePattern.test(value)) {
    throw new Error(message);
  }

  return value;
}
