import { contextBridge, ipcRenderer, webUtils } from "electron";

// preload работает в sandbox: обычный import отсюда невозможен, поэтому имена
// каналов продублированы. Тип DesktopChannel стирается при компиляции, но
// удерживает эти строки в соответствии с ./channels.ts.
import type { DesktopChannel } from "./channels.js";

const SELECT_LOGO_CHANNEL: DesktopChannel = "dialog:select-logo";
const SELECT_MEDIA_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-media-directory";
const SELECT_MEDIA_FILES_CHANNEL: DesktopChannel = "dialog:select-media-files";
const SELECT_SCHEDULE_FILE_CHANNEL: DesktopChannel = "dialog:select-schedule-file";
const SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-schedule-logo-directory";
const SELECT_AGE_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-age-directory";
const SELECT_EFFECT_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-effect-directory";
const SELECT_EFFECT_FILES_CHANNEL: DesktopChannel = "dialog:select-effect-files";
const SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-effect-title-directory";
const SELECT_SUBTITLE_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-subtitle-directory";
const SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL: DesktopChannel = "dialog:select-audio-track-directory";
const SAVE_SCHEDULE_FILE_CHANNEL: DesktopChannel = "dialog:save-schedule-file";
const SELECT_ENCODING_SETTINGS_FILE_CHANNEL: DesktopChannel = "dialog:select-encoding-settings-file";
const SAVE_ENCODING_SETTINGS_FILE_CHANNEL: DesktopChannel = "dialog:save-encoding-settings-file";
const SERVICE_HEALTH_CHANNEL: DesktopChannel = "service:get-health";

contextBridge.exposeInMainWorld("gruberDesktop", {
  getServiceHealth: (): Promise<unknown> =>
    ipcRenderer.invoke(SERVICE_HEALTH_CHANNEL) as Promise<unknown>,
  getMediaFilePath: (file: File): string => webUtils.getPathForFile(file),
  mediaApiBaseUrl:
    process.env.GRUBER_MEDIA_API_URL ?? "http://127.0.0.1:4310",
  platform: process.platform,
  selectLogoFile: (): Promise<string | null> =>
    ipcRenderer.invoke(SELECT_LOGO_CHANNEL) as Promise<string | null>,
  selectMediaDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(SELECT_MEDIA_DIRECTORY_CHANNEL) as Promise<string | null>,
  selectMediaFiles: (): Promise<string[]> =>
    ipcRenderer.invoke(SELECT_MEDIA_FILES_CHANNEL) as Promise<string[]>,
  selectScheduleFile: (): Promise<string | null> =>
    ipcRenderer.invoke(SELECT_SCHEDULE_FILE_CHANNEL) as Promise<string | null>,
  selectEncodingSettingsFile: (): Promise<{ content: string; filePath: string } | null> =>
    ipcRenderer.invoke(SELECT_ENCODING_SETTINGS_FILE_CHANNEL) as Promise<{
      content: string;
      filePath: string;
    } | null>,
  selectScheduleLogoDirectory: (): Promise<{ directoryPath: string; imagePaths: string[] } | null> =>
    ipcRenderer.invoke(SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL) as Promise<{
      directoryPath: string;
      imagePaths: string[];
    } | null>,
  selectAgeDirectory: (): Promise<{ directoryPath: string; imagePaths: string[] } | null> =>
    ipcRenderer.invoke(SELECT_AGE_DIRECTORY_CHANNEL) as Promise<{
      directoryPath: string;
      imagePaths: string[];
    } | null>,
  selectEffectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke(SELECT_EFFECT_FILES_CHANNEL) as Promise<string[]>,
  selectEffectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(SELECT_EFFECT_DIRECTORY_CHANNEL) as Promise<string | null>,
  selectEffectTitleDirectory: (): Promise<{ directoryPath: string; filePaths: string[] } | null> =>
    ipcRenderer.invoke(SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL) as Promise<{
      directoryPath: string;
      filePaths: string[];
    } | null>,
  selectSubtitleDirectory: (): Promise<{ directoryPath: string; filePaths: string[] } | null> =>
    ipcRenderer.invoke(SELECT_SUBTITLE_DIRECTORY_CHANNEL) as Promise<{
      directoryPath: string;
      filePaths: string[];
    } | null>,
  selectAudioTrackDirectory: (): Promise<{ directoryPath: string; filePaths: string[] } | null> =>
    ipcRenderer.invoke(SELECT_AUDIO_TRACK_DIRECTORY_CHANNEL) as Promise<{
      directoryPath: string;
      filePaths: string[];
    } | null>,
  saveScheduleFile: (input: {
    content: string;
    defaultName: string;
    extension: "txt";
  }): Promise<string | null> =>
    ipcRenderer.invoke(SAVE_SCHEDULE_FILE_CHANNEL, input) as Promise<string | null>,
  saveEncodingSettingsFile: (input: {
    content: string;
    defaultName: string;
  }): Promise<string | null> =>
    ipcRenderer.invoke(SAVE_ENCODING_SETTINGS_FILE_CHANNEL, input) as Promise<string | null>,
});
