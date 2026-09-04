/**
 * Имена IPC-каналов между Electron main и preload.
 *
 * preload работает в sandbox и не может импортировать этот файл во время
 * выполнения, поэтому там строки продублированы, но помечены типом
 * DesktopChannel — расхождение поймает компилятор, а не пользователь.
 */
export const SELECT_LOGO_CHANNEL = "dialog:select-logo";
export const SELECT_MEDIA_DIRECTORY_CHANNEL = "dialog:select-media-directory";
export const SELECT_MEDIA_FILES_CHANNEL = "dialog:select-media-files";
export const SELECT_SCHEDULE_FILE_CHANNEL = "dialog:select-schedule-file";
export const SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL = "dialog:select-schedule-logo-directory";
export const SELECT_AGE_DIRECTORY_CHANNEL = "dialog:select-age-directory";
export const SELECT_EFFECT_DIRECTORY_CHANNEL = "dialog:select-effect-directory";
export const SELECT_EFFECT_FILES_CHANNEL = "dialog:select-effect-files";
export const SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL = "dialog:select-effect-title-directory";
export const SELECT_BROADCAST_TASK_FILE_CHANNEL = "dialog:select-broadcast-task-file";
export const SELECT_TICKER_SOURCE_FILE_CHANNEL = "dialog:select-ticker-source-file";
export const SELECT_STINGER_FILE_CHANNEL = "dialog:select-stinger-file";
export const SELECT_DECORATION_FILE_CHANNEL = "dialog:select-decoration-file";
export const SELECT_VECTOR_FILE_CHANNEL = "dialog:select-vector-file";
export const SAVE_TITLE_FILE_CHANNEL = "dialog:save-title-file";
export const SELECT_TITLE_FILE_CHANNEL = "dialog:select-title-file";
export const READ_TITLE_LIBRARY_CHANNEL = "dialog:read-title-library";
export const SELECT_TITLE_LIBRARY_CHANNEL = "dialog:select-title-library";
export const SELECT_SUBTITLE_DIRECTORY_CHANNEL = "dialog:select-subtitle-directory";
export const SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL = "dialog:select-audio-track-directory";
export const SAVE_SCHEDULE_FILE_CHANNEL = "dialog:save-schedule-file";
export const SELECT_ENCODING_SETTINGS_FILE_CHANNEL = "dialog:select-encoding-settings-file";
export const SAVE_ENCODING_SETTINGS_FILE_CHANNEL = "dialog:save-encoding-settings-file";
/** Показать файл в проводнике: оператор ищет ролик там, где он лежит. */
export const REVEAL_IN_FOLDER_CHANNEL = "shell:reveal-in-folder";
export const SERVICE_HEALTH_CHANNEL = "service:get-health";

export type DesktopChannel =
  | typeof SELECT_LOGO_CHANNEL
  | typeof SELECT_MEDIA_DIRECTORY_CHANNEL
  | typeof SELECT_MEDIA_FILES_CHANNEL
  | typeof SELECT_SCHEDULE_FILE_CHANNEL
  | typeof SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL
  | typeof SELECT_AGE_DIRECTORY_CHANNEL
  | typeof SELECT_EFFECT_DIRECTORY_CHANNEL
  | typeof SELECT_EFFECT_FILES_CHANNEL
  | typeof SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL
  | typeof SELECT_BROADCAST_TASK_FILE_CHANNEL
  | typeof SELECT_TICKER_SOURCE_FILE_CHANNEL
  | typeof SELECT_STINGER_FILE_CHANNEL
  | typeof SELECT_DECORATION_FILE_CHANNEL
  | typeof SELECT_VECTOR_FILE_CHANNEL
  | typeof SAVE_TITLE_FILE_CHANNEL
  | typeof SELECT_TITLE_FILE_CHANNEL
  | typeof READ_TITLE_LIBRARY_CHANNEL
  | typeof SELECT_TITLE_LIBRARY_CHANNEL
  | typeof SELECT_SUBTITLE_DIRECTORY_CHANNEL
  | typeof SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL
  | typeof SAVE_SCHEDULE_FILE_CHANNEL
  | typeof SELECT_ENCODING_SETTINGS_FILE_CHANNEL
  | typeof SAVE_ENCODING_SETTINGS_FILE_CHANNEL
  | typeof REVEAL_IN_FOLDER_CHANNEL
  | typeof SERVICE_HEALTH_CHANNEL;
