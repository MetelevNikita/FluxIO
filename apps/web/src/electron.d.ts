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
      selectEffectFiles: () => Promise<string[]>;
      selectEffectDirectory: () => Promise<string | null>;
      selectBroadcastTaskFile: () => Promise<string | null>;
      selectTickerSourceFile: () => Promise<string | null>;
      selectStingerFile: () => Promise<string | null>;
      selectEffectTitleDirectory: () => Promise<{
        directoryPath: string;
        filePaths: string[];
      } | null>;
      selectSubtitleDirectory: () => Promise<{
        directoryPath: string;
        filePaths: string[];
      } | null>;
      selectAudioTrackDirectory: () => Promise<{
        directoryPath: string;
        filePaths: string[];
      } | null>;
      saveScheduleFile: (input: {
        content: string;
        defaultName: string;
        extension: "txt";
      }) => Promise<string | null>;
      saveEncodingSettingsFile: (input: {
        content: string;
        defaultName: string;
      }) => Promise<string | null>;
    };
  }
}
