import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SELECT_LOGO_CHANNEL = "dialog:select-logo";
const SELECT_MEDIA_DIRECTORY_CHANNEL = "dialog:select-media-directory";
const SELECT_MEDIA_FILES_CHANNEL = "dialog:select-media-files";
const SELECT_SCHEDULE_FILE_CHANNEL = "dialog:select-schedule-file";
const SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL = "dialog:select-schedule-logo-directory";
const SELECT_AGE_DIRECTORY_CHANNEL = "dialog:select-age-directory";
const SELECT_EFFECT_DIRECTORY_CHANNEL = "dialog:select-effect-directory";
const SELECT_EFFECT_FILES_CHANNEL = "dialog:select-effect-files";
const SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL = "dialog:select-effect-title-directory";
const SELECT_SUBTITLE_DIRECTORY_CHANNEL = "dialog:select-subtitle-directory";
const SAVE_SCHEDULE_FILE_CHANNEL = "dialog:save-schedule-file";
const SELECT_ENCODING_SETTINGS_FILE_CHANNEL = "dialog:select-encoding-settings-file";
const SAVE_ENCODING_SETTINGS_FILE_CHANNEL = "dialog:save-encoding-settings-file";
const SERVICE_HEALTH_CHANNEL = "service:get-health";
const SPLASH_DURATION_MS = 5_000;
const loadProductionBuild =
  app.isPackaged || process.argv.includes("--gruber-production");

app.setName("FluxIO");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function desktopIconPath(): string {
  const iconName = process.platform === "darwin" ? "icon-mac.png" : "icon.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, iconName)
    : path.resolve(__dirname, `../build/${iconName}`);
}

function splashFilePath(): string {
  return path.join(__dirname, "splash.html");
}

function createWindow(showStartupSplash = false): void {
  const splashWindow = showStartupSplash
    ? new BrowserWindow({
        width: 1440,
        height: 920,
        show: false,
        frame: false,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#0a0b0d",
        icon: desktopIconPath(),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
    : null;
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "FluxIO",
    backgroundColor: "#0a1015",
    icon: desktopIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let mainWindowReady = false;
  let splashTimeElapsed = splashWindow === null;
  let splashTimer: ReturnType<typeof setTimeout> | null = null;

  const revealMainWindow = () => {
    if (!mainWindowReady || !splashTimeElapsed || window.isDestroyed()) {
      return;
    }

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    window.show();
    window.focus();
  };

  window.once("ready-to-show", () => {
    mainWindowReady = true;
    revealMainWindow();
  });
  window.webContents.once("did-fail-load", () => {
    mainWindowReady = true;
    revealMainWindow();
  });
  window.once("closed", () => {
    if (splashTimer) {
      clearTimeout(splashTimer);
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  });

  if (splashWindow) {
    splashWindow.once("ready-to-show", () => {
      splashWindow.show();
      splashTimer = setTimeout(() => {
        splashTimeElapsed = true;
        revealMainWindow();
      }, SPLASH_DURATION_MS);
    });
    void splashWindow.loadFile(splashFilePath()).catch(() => {
      splashTimeElapsed = true;
      revealMainWindow();
    });
  }

  if (loadProductionBuild) {
    const webEntry = app.isPackaged
      ? path.join(process.resourcesPath, "web", "index.html")
      : path.resolve(__dirname, "../../web/dist/index.html");
    void window.loadFile(webEntry);
  } else {
    void window.loadURL(
      process.env.GRUBER_WEB_DEV_URL ?? "http://127.0.0.1:5173",
    );
  }
}

void app.whenReady().then(() => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(desktopIconPath());
  }
  ipcMain.handle(SELECT_MEDIA_FILES_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      filters: [
        {
          name: "Video files",
          extensions: ["avi", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mxf", "ts", "webm"],
        },
      ],
      properties: ["openFile", "multiSelections"],
      title: "Select media files",
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(SELECT_MEDIA_DIRECTORY_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select media directory",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(SELECT_SCHEDULE_FILE_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "FluxIO schedules", extensions: ["air", "txt"] }],
      properties: ["openFile"],
      title: "Select weekly schedule",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(SELECT_SCHEDULE_LOGO_DIRECTORY_CHANNEL, async () =>
    selectImageDirectory("Select folder with channel logos"));

  ipcMain.handle(SELECT_AGE_DIRECTORY_CHANNEL, async () =>
    selectImageDirectory("Select folder with AGE graphics"));

  ipcMain.handle(SELECT_EFFECT_FILES_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "FluxIO graphic effects", extensions: ["json", "png", "webp", "mov", "mp4", "m4v", "webm"] }],
      properties: ["openFile", "multiSelections"],
      title: "Select graphic effects",
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(SELECT_EFFECT_DIRECTORY_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select folder with graphic effects",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(SELECT_EFFECT_TITLE_DIRECTORY_CHANNEL, async () =>
    selectFileDirectory(
      "Select folder with per-clip alpha titles",
      new Set([".png", ".webp", ".mov", ".mp4", ".m4v", ".webm"]),
    ));

  ipcMain.handle(SELECT_SUBTITLE_DIRECTORY_CHANNEL, async () =>
    selectFileDirectory("Select folder with SRT subtitles", new Set([".srt"])));

  ipcMain.handle(SAVE_SCHEDULE_FILE_CHANNEL, async (_event, value: unknown) => {
    const input = scheduleSaveInput(value);
    const result = await dialog.showSaveDialog({
      defaultPath: input.defaultName,
      filters: [{
        name: input.extension === "air" ? "FluxIO AIR schedule" : "Text schedule",
        extensions: [input.extension],
      }],
      title: "Save edited weekly schedule",
    });
    if (result.canceled || !result.filePath) return null;
    const outputPath = path.extname(result.filePath)
      ? result.filePath
      : `${result.filePath}.${input.extension}`;
    await writeFile(outputPath, input.content, "utf8");
    return outputPath;
  });

  ipcMain.handle(SELECT_ENCODING_SETTINGS_FILE_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "FluxIO encoding settings", extensions: ["txt"] }],
      properties: ["openFile"],
      title: "Import encoding settings",
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const content = await readFile(filePath);
    if (content.byteLength === 0 || content.byteLength > 1024 * 1024) {
      throw new Error("Encoding settings file must be between 1 byte and 1 MB");
    }
    return { content: content.toString("utf8"), filePath };
  });

  ipcMain.handle(SAVE_ENCODING_SETTINGS_FILE_CHANNEL, async (_event, value: unknown) => {
    const input = textFileSaveInput(value);
    const result = await dialog.showSaveDialog({
      defaultPath: input.defaultName,
      filters: [{ name: "FluxIO encoding settings", extensions: ["txt"] }],
      title: "Save encoding settings",
    });
    if (result.canceled || !result.filePath) return null;
    const outputPath = result.filePath.toLowerCase().endsWith(".txt")
      ? result.filePath
      : `${result.filePath}.txt`;
    await writeFile(outputPath, input.content, "utf8");
    return outputPath;
  });

  ipcMain.handle(SELECT_LOGO_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      filters: [
        { name: "Logo images", extensions: ["png", "webp", "jpg", "jpeg"] },
      ],
      properties: ["openFile"],
      title: "Select output logo",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

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

  createWindow(true);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

async function selectImageDirectory(title: string): Promise<{
  directoryPath: string;
  imagePaths: string[];
} | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title,
  });
  const directoryPath = result.filePaths[0];
  if (result.canceled || !directoryPath) return null;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const imagePaths = entries
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
  return { directoryPath, imagePaths };
}

async function selectFileDirectory(
  title: string,
  extensions: Set<string>,
): Promise<{ directoryPath: string; filePaths: string[] } | null> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title });
  const directoryPath = result.filePaths[0];
  if (result.canceled || !directoryPath) return null;
  const filePaths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        filePaths.push(entryPath);
      }
    }
  }
  await visit(directoryPath);
  return {
    directoryPath,
    filePaths: filePaths.sort((left, right) => left.localeCompare(right)),
  };
}

function isSupportedImage(fileName: string): boolean {
  return new Set([".png", ".webp", ".jpg", ".jpeg"]).has(
    path.extname(fileName).toLowerCase(),
  );
}

function scheduleSaveInput(value: unknown): {
  content: string;
  defaultName: string;
  extension: "air" | "txt";
} {
  if (!value || typeof value !== "object") throw new Error("Invalid schedule save request");
  const candidate = value as Record<string, unknown>;
  const extension = candidate.extension;
  const content = candidate.content;
  const defaultName = candidate.defaultName;
  if (extension !== "air" && extension !== "txt") throw new Error("Invalid schedule extension");
  if (typeof content !== "string" || content.length === 0 || content.length > 10 * 1024 * 1024) {
    throw new Error("Schedule content must be between 1 byte and 10 MB");
  }
  if (typeof defaultName !== "string" || !defaultName.trim() || /[\\/:*?\"<>|]/.test(defaultName)) {
    throw new Error("Invalid schedule file name");
  }
  return { content, defaultName, extension };
}

function textFileSaveInput(value: unknown): {
  content: string;
  defaultName: string;
} {
  if (!value || typeof value !== "object") throw new Error("Invalid text file save request");
  const candidate = value as Record<string, unknown>;
  const content = candidate.content;
  const defaultName = candidate.defaultName;
  if (typeof content !== "string" || content.length === 0 || content.length > 1024 * 1024) {
    throw new Error("Encoding settings content must be between 1 byte and 1 MB");
  }
  if (typeof defaultName !== "string" || !defaultName.trim() || /[\\/:*?"<>|]/.test(defaultName)) {
    throw new Error("Invalid encoding settings file name");
  }
  return { content, defaultName };
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
