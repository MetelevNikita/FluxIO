import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

const SELECT_LOGO_CHANNEL = "dialog:select-logo";
const SELECT_MEDIA_DIRECTORY_CHANNEL = "dialog:select-media-directory";
const SELECT_MEDIA_FILES_CHANNEL = "dialog:select-media-files";
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
    const response = await fetch(new URL("/api/health", baseUrl));

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
