/* -------------------------------------------------------------------------- *
 * Упаковка структур в строку расписания.
 *
 * Расписание разбирается построчно по фигурным скобкам, а сцена и значения
 * полей — это JSON, в котором скобок полно. base64 убирает их из строки
 * целиком, поэтому разбор остаётся тем же, каким был.
 *
 * `btoa` работает с байтами, а не с символами: кириллицу он без перекодировки
 * не принимает вовсе.
 * ------------------------------------------------------------------------- */

export function encodeScheduleBlob(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeScheduleBlob<T>(blob: string): T {
  const binary = atob(blob);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
