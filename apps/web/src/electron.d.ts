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
      selectEncodingSettingsFile: () => Promise<{
        content: string;
        filePath: string;
      } | null>;
      selectScheduleLogoDirectory: () => Promise<{
        directoryPath: string;
        imagePaths: string[];
      } | null>;
      selectAgeDirectory: () => Promise<{
        directoryPath: string;
        imagePaths: string[];
      } | null>;
      saveScheduleFile: (input: {
        content: string;
        defaultName: string;
        extension: "air" | "txt";
      }) => Promise<string | null>;
      saveEncodingSettingsFile: (input: {
        content: string;
        defaultName: string;
      }) => Promise<string | null>;
    };
  }
}
