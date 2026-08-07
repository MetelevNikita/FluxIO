import { contextBridge, ipcRenderer, webUtils } from "electron";

const SELECT_LOGO_CHANNEL = "dialog:select-logo";
const SELECT_MEDIA_DIRECTORY_CHANNEL = "dialog:select-media-directory";
const SELECT_MEDIA_FILES_CHANNEL = "dialog:select-media-files";
const SELECT_SCHEDULE_FILE_CHANNEL = "dialog:select-schedule-file";
const SERVICE_HEALTH_CHANNEL = "service:get-health";

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
});
