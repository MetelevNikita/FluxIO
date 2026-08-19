import { ipcMain } from "electron";

//

import {
  SAVE_ENCODING_SETTINGS_FILE_CHANNEL,
  SAVE_SCHEDULE_FILE_CHANNEL,
  SELECT_AGE_DIRECTORY_CHANNEL,
  SELECT_EFFECT_DIRECTORY_CHANNEL,
  SELECT_BROADCAST_TASK_FILE_CHANNEL,
  SELECT_EFFECT_FILES_CHANNEL,
  SELECT_STINGER_FILE_CHANNEL,
  SELECT_TICKER_SOURCE_FILE_CHANNEL,
  SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL,
  SELECT_ENCODING_SETTINGS_FILE_CHANNEL,
  SELECT_LOGO_CHANNEL,
  SELECT_MEDIA_DIRECTORY_CHANNEL,
  SELECT_MEDIA_FILES_CHANNEL,
  SELECT_SCHEDULE_FILE_CHANNEL,
  SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL,
  SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL,
  SELECT_SUBTITLE_DIRECTORY_CHANNEL,
  SERVICE_HEALTH_CHANNEL,
} from "./channels.js";
import {
  readTextFile,
  saveTextFile,
  selectDirectory,
  selectFile,
  selectFileDirectory,
  selectFiles,
  selectImageDirectory,
} from "./dialogs.js";
import { scheduleSaveInput, textFileSaveInput } from "./saveInput.js";

const videoExtensions = [
  "avi", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mxf", "ts", "webm",
];
const effectExtensions = ["json", "png", "webp", "mov", "mp4", "m4v", "webm"];
const titleExtensions = new Set([".png", ".webp", ".mov", ".mp4", ".m4v", ".webm"]);
const subtitleExtensions = new Set([".srt"]);
const audioTrackExtensions = new Set([
  ".aac", ".ac3", ".eac3", ".flac", ".m4a", ".mka", ".mp2", ".mp3",
  ".oga", ".ogg", ".opus", ".wav", ".wma",
  ".mkv", ".mov", ".mp4", ".m4v", ".ts", ".mxf", ".webm",
]);

export function registerIpcHandlers(): void {
  registerMediaHandlers();
  registerScheduleHandlers();
  registerEffectHandlers();
  registerEncodingSettingsHandlers();
  registerServiceHandlers();
}

//
// Медиатека
//

function registerMediaHandlers(): void {
  ipcMain.handle(SELECT_MEDIA_FILES_CHANNEL, async () =>
    selectFiles("Select media files", [
      { name: "Video files", extensions: videoExtensions },
    ]));

  ipcMain.handle(SELECT_MEDIA_DIRECTORY_CHANNEL, async () =>
    selectDirectory("Select media directory"));

  ipcMain.handle(SELECT_LOGO_CHANNEL, async () =>
    selectFile("Select output logo", [
      { name: "Logo images", extensions: ["png", "webp", "jpg", "jpeg"] },
    ]));
}

//
// Расписание и его графика
//

function registerScheduleHandlers(): void {
  ipcMain.handle(SELECT_SCHEDULE_FILE_CHANNEL, async () =>
    selectFile("Select weekly schedule", [
      { name: "FluxIO schedules", extensions: ["air", "txt"] },
    ]));

  ipcMain.handle(SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL, async () =>
    selectImageDirectory("Select folder with channel logos"));

  ipcMain.handle(SELECT_AGE_DIRECTORY_CHANNEL, async () =>
    selectImageDirectory("Select folder with AGE graphics"));

  ipcMain.handle(SELECT_SUBTITLE_DIRECTORY_CHANNEL, async () =>
    selectFileDirectory("Select folder with SRT subtitles", subtitleExtensions));

  ipcMain.handle(SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL, async () =>
    selectFileDirectory("Select folder with additional audio tracks", audioTrackExtensions));

  ipcMain.handle(SAVE_SCHEDULE_FILE_CHANNEL, async (_event, value: unknown) => {
    const input = scheduleSaveInput(value);

    return saveTextFile({
      content: input.content,
      defaultName: input.defaultName,
      extension: input.extension,
      filterName: "Text schedule",
      keepAnyExtension: true,
      title: "Save edited weekly schedule",
    });
  });
}

//
// Графические эффекты
//

function registerEffectHandlers(): void {
  ipcMain.handle(SELECT_EFFECT_FILES_CHANNEL, async () =>
    selectFiles("Select graphic effects", [
      { name: "FluxIO graphic effects", extensions: effectExtensions },
    ]));

  ipcMain.handle(SELECT_EFFECT_DIRECTORY_CHANNEL, async () =>
    selectDirectory("Select folder with graphic effects"));

  ipcMain.handle(SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL, async () =>
    selectFileDirectory("Select folder with per-clip alpha titles", titleExtensions));

  // Файлы данных эффектов второго уровня. Их содержимое читает media-service —
  // здесь выбирается только путь.
  ipcMain.handle(SELECT_BROADCAST_TASK_FILE_CHANNEL, async () =>
    selectFile("Select effect task file", [
      { name: "FluxIO effect task", extensions: ["json"] },
    ]));

  ipcMain.handle(SELECT_TICKER_SOURCE_FILE_CHANNEL, async () =>
    selectFile("Select ticker messages", [
      { name: "Ticker messages", extensions: ["json", "txt"] },
    ]));

  ipcMain.handle(SELECT_STINGER_FILE_CHANNEL, async () =>
    selectFile("Select stinger transition", [
      { name: "Alpha transition", extensions: ["mov", "webm", "mp4", "m4v"] },
    ]));
}

//
// Профили настроек кодирования
//

function registerEncodingSettingsHandlers(): void {
  ipcMain.handle(SELECT_ENCODING_SETTINGS_FILE_CHANNEL, async () => {
    const filePath = await selectFile("Import encoding settings", [
      { name: "FluxIO encoding settings", extensions: ["txt"] },
    ]);
    if (!filePath) return null;

    const content = await readTextFile(filePath, 1024 * 1024, "Encoding settings file");

    return { content, filePath };
  });

  ipcMain.handle(SAVE_ENCODING_SETTINGS_FILE_CHANNEL, async (_event, value: unknown) => {
    const input = textFileSaveInput(value);

    return saveTextFile({
      content: input.content,
      defaultName: input.defaultName,
      extension: "txt",
      filterName: "FluxIO encoding settings",
      title: "Save encoding settings",
    });
  });
}

//
// Media-service
//

function registerServiceHandlers(): void {
  ipcMain.handle(SERVICE_HEALTH_CHANNEL, async () => {
    const baseUrl = process.env.GRUBER_MEDIA_API_URL ?? "http://127.0.0.1:4310";
    const response = await fetch(new URL("/api/health", baseUrl), {
      signal: AbortSignal.timeout(1_500),
    });

    if (!response.ok) {
      throw new Error(`Media service returned ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  });
}
