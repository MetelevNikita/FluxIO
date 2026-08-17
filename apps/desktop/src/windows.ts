import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

//

const SPLASH_DURATION_MS = 5_000;
const TELEGRAM_PROFILE_URL = "https://t.me/MetelevNikita";
const loadProductionBuild =
  app.isPackaged || process.argv.includes("--gruber-production");

export function desktopIconPath(): string {
  const iconName = process.platform === "darwin" ? "icon-mac.png" : "icon.png";

  return app.isPackaged
    ? path.join(process.resourcesPath, iconName)
    : path.resolve(__dirname, `../build/${iconName}`);
}

export function openMainWindow(showStartupSplash = false): void {
  const splashWindow = showStartupSplash ? createSplashWindow() : null;
  const window = createMainWindow();
  const startup = new StartupReveal(window, splashWindow);

  window.once("ready-to-show", () => startup.markMainWindowReady());
  window.webContents.once("did-fail-load", () => startup.markMainWindowReady());
  window.once("closed", () => startup.dispose());

  if (splashWindow) {
    showSplash(splashWindow, startup);
  }

  loadApplicationContent(window);
}

//
// Окна
//

function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
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
}

function createSplashWindow(): BrowserWindow {
  return new BrowserWindow({
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
  });
}

function loadApplicationContent(window: BrowserWindow): void {
  if (!loadProductionBuild) {
    void window.loadURL(process.env.GRUBER_WEB_DEV_URL ?? "http://127.0.0.1:5173");
    return;
  }

  const webEntry = app.isPackaged
    ? path.join(process.resourcesPath, "web", "index.html")
    : path.resolve(__dirname, "../../web/dist/index.html");
  void window.loadFile(webEntry);
}

//
// Стартовый экран
//

function showSplash(splashWindow: BrowserWindow, startup: StartupReveal): void {
  splashWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === TELEGRAM_PROFILE_URL) void shell.openExternal(url);
    return { action: "deny" };
  });

  splashWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== TELEGRAM_PROFILE_URL) return;

    event.preventDefault();
    void shell.openExternal(url);
  });

  splashWindow.once("ready-to-show", () => {
    splashWindow.show();
    startup.startSplashTimer(SPLASH_DURATION_MS);
  });

  void splashWindow.loadFile(splashFilePath()).catch(() => {
    startup.markSplashElapsed();
  });
}

function splashFilePath(): string {
  return path.join(__dirname, "splash.html");
}

/**
 * Главное окно показывается только когда сошлись оба условия: контент готов
 * и splash отработал свои пять секунд. Порядок событий не гарантирован.
 */
class StartupReveal {
  #window: BrowserWindow;
  #splashWindow: BrowserWindow | null;
  #mainWindowReady = false;
  #splashTimeElapsed: boolean;
  #splashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(window: BrowserWindow, splashWindow: BrowserWindow | null) {
    this.#window = window;
    this.#splashWindow = splashWindow;
    this.#splashTimeElapsed = splashWindow === null;
  }

  markMainWindowReady(): void {
    this.#mainWindowReady = true;
    this.#reveal();
  }

  markSplashElapsed(): void {
    this.#splashTimeElapsed = true;
    this.#reveal();
  }

  startSplashTimer(durationMs: number): void {
    this.#splashTimer = setTimeout(() => this.markSplashElapsed(), durationMs);
  }

  dispose(): void {
    if (this.#splashTimer) {
      clearTimeout(this.#splashTimer);
      this.#splashTimer = null;
    }

    this.#closeSplash();
  }

  #reveal(): void {
    if (!this.#mainWindowReady) return;
    if (!this.#splashTimeElapsed) return;
    if (this.#window.isDestroyed()) return;

    this.#closeSplash();
    this.#window.show();
    this.#window.focus();
  }

  #closeSplash(): void {
    if (!this.#splashWindow) return;
    if (this.#splashWindow.isDestroyed()) return;

    this.#splashWindow.close();
  }
}
