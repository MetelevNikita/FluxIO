export {};

declare global {
  interface Window {
    gruberDesktop?: {
      getServiceHealth: () => Promise<unknown>;
      getMediaFilePath: (file: File) => string;
      mediaApiBaseUrl: string;
      platform: string;
      selectLogoFile: () => Promise<string | null>;
      selectMediaDirectory: () => Promise<string | null>;
      selectMediaFiles: () => Promise<string[]>;
      selectScheduleFile: () => Promise<string | null>;
    };
  }
}
