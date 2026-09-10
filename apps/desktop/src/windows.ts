import { randomUUID } from "node:crypto";
import { api } from "./session-files.js";
import { app, BrowserWindow, shell, dialog, ipcMain } from "electron";
import path from "node:path";

//

const SPLASH_DURATION_MS = 5_000;
const TELEGRAM_PROFILE_URL = "https://t.me/MetelevNikita";
const loadProductionBuild =
  app.isPackaged || process.argv.includes("--gruber-production");

export interface FluxioInstance {
  id: string;
  name: string;
  apiUrl: string;
  enabled: boolean;
}

let launcherWindow: BrowserWindow | null = null;
const programWindows = new Map<string, BrowserWindow>();
const windowInstances = new Map<number, FluxioInstance>();
let quitting = false;

export function programInstance(webContentsId: number): FluxioInstance | undefined {
  return windowInstances.get(webContentsId);
}

export function reloadProgramWindow(instance: FluxioInstance): void {
  const existing = programWindows.get(instance.id);
  if (existing && !existing.isDestroyed()) existing.reload();
  else openProgramWindow(instance);
}

export function registerShutdown(loadInstances: () => FluxioInstance[]): void {
  let pending = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void confirmProgramShutdown(loadInstances().filter((entry) => entry.enabled)).then((approved) => {
      if (approved) { quitting = true; app.quit(); }
    }).finally(() => { pending = false; });
  });
}

async function confirmProgramShutdown(instances: FluxioInstance[]): Promise<boolean> {
  const owner = BrowserWindow.getFocusedWindow();
  try {
    const active: FluxioInstance[] = [];
    for (const instance of instances) {
      const status = await api(instance, "/api/playout/status");
      if (["starting", "running", "stopping"].includes(String(status.state))) active.push(instance);
    }
    if (active.length) {
      const options = {
        type: "warning" as const, title: "Завершение трансляции",
        message: "Вы уверены, что хотите закрыть и завершить трансляцию программы?",
        detail: active.map((entry) => entry.name).join("\n"),
        buttons: ["Отмена", "Завершить трансляцию и закрыть"], defaultId: 0, cancelId: 0,
      };
      const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
      if (result.response !== 1) return false;
    }
    for (const instance of instances) await saveBeforeClose(instance, owner);
    for (const instance of active) {
      await api(instance, "/api/playout/stop", { method: "POST" });
      const deadline = Date.now() + 15_000;
      while (true) {
        const status = await api(instance, "/api/playout/status");
        if (!["starting", "running", "stopping"].includes(String(status.state))) break;
        if (Date.now() >= deadline) throw new Error(`Не удалось остановить ${instance.name}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // Остановленный чекпоинт сохраняется тоже: закрытие по своей воле — не
    // обрыв, и подниматься после него автостартом приложение не должно.
    for (const instance of active) await saveBeforeClose(instance, owner);
    return true;
  } catch (error) {
    dialog.showErrorBox("Закрытие отменено", String(error));
    return false;
  }
}

/**
 * Сохранение сессии перед закрытием.
 *
 * Несохранённая сессия — повод спросить, а не запрет закрываться: окно, из
 * которого нельзя выйти, потому что интерфейс завис, оператор всё равно снимет
 * силой — только уже вместе со службой и эфиром.
 */
async function saveBeforeClose(
  instance: FluxioInstance,
  owner: BrowserWindow | null,
): Promise<void> {
  const window = programWindows.get(instance.id);
  if (!window || window.isDestroyed()) return;
  try {
    await flushProgram(window);
  } catch (error) {
    const options = {
      type: "warning" as const,
      title: "Сессия не сохранена",
      message: `Не удалось сохранить сессию «${instance.name}». Закрыть всё равно?`,
      detail: String(error),
      buttons: ["Отмена", "Закрыть без сохранения"],
      defaultId: 0,
      cancelId: 0,
    };
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) throw error;
  }
}

function flushProgram(window: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    const timer = setTimeout(() => finish(new Error("Сессия не сохранена: интерфейс не ответил")), 30_000);
    const listener = (event: Electron.IpcMainEvent, responseToken: unknown, error: unknown) => {
      if (event.sender !== window.webContents || responseToken !== token) return;
      finish(error ? new Error(String(error)) : undefined);
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      ipcMain.removeListener("workspace:flush", listener);
      if (error) reject(error); else resolve();
    };
    ipcMain.on("workspace:flush", listener);
    window.webContents.send("workspace:flush", token);
  });
}

export function desktopIconPath(): string {
  const iconName = process.platform === "darwin" ? "icon-mac.png" : "icon.png";

  return app.isPackaged
    ? path.join(process.resourcesPath, iconName)
    : path.resolve(__dirname, `../build/${iconName}`);
}

export function openLauncherWindow(showStartupSplash = false): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show();
    launcherWindow.focus();
    return launcherWindow;
  }
  const splashWindow = showStartupSplash ? createSplashWindow() : null;
  const window = createLauncherWindow();
  launcherWindow = window;
  const startup = new StartupReveal(window, splashWindow);

  window.once("ready-to-show", () => startup.markMainWindowReady());
  window.webContents.once("did-fail-load", () => startup.markMainWindowReady());
  window.once("closed", () => {
    startup.dispose();
    launcherWindow = null;
  });

  if (splashWindow) {
    showSplash(splashWindow, startup);
  }

  void window.loadFile(path.join(__dirname, "launcher.html"));
  return window;
}

export function openProgramWindow(instance: FluxioInstance): BrowserWindow {
  const existing = programWindows.get(instance.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const window = createMainWindow(instance);
  programWindows.set(instance.id, window);
  const contentsId = window.webContents.id;
  windowInstances.set(contentsId, instance);
  let closing = false;
  let closeApproved = false;
  window.on("close", (event) => {
    if (quitting || closeApproved) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void confirmProgramShutdown([instance]).then((approved) => {
      if (approved) { closeApproved = true; window.close(); }
    }).finally(() => { closing = false; });
  });
  window.once("closed", () => {
    programWindows.delete(instance.id);
    windowInstances.delete(contentsId);
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(`FluxIO — ${instance.name}`);
  });
  loadApplicationContent(window);
  return window;
}

//
// Окна
//

function createLauncherWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: "FluxIO — Programs",
    backgroundColor: "#080d12",
    icon: desktopIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "launcher-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

function createMainWindow(instance: FluxioInstance): BrowserWindow {
  return new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: `FluxIO — ${instance.name}`,
    backgroundColor: "#0a1015",
    icon: desktopIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [
        `--fluxio-api=${instance.apiUrl}`,
        `--fluxio-instance-id=${instance.id}`,
        `--fluxio-instance-name=${instance.name}`,
      ],
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

  void splashWindow.loadFile(splashFilePath(), {
    query: { version: app.getVersion() },
  }).catch(() => {
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
