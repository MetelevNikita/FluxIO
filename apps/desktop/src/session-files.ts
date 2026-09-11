/* -------------------------------------------------------------------------- *
 * Файлы программы на рабочем столе.
 *
 * У каждой программы своя папка в «FluxIO Sessions», и в ней лежит то, чем
 * станцию поднимают заново: расписания Current и Future, настройки кодирования
 * и снимок сессии. База данных остаётся источником правды, а папка — тем, что
 * оператор видит, копирует и уносит на другую машину; после переустановки
 * системы восстановиться больше нечем.
 * ------------------------------------------------------------------------- */

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SAVE_WORKSPACE_FILES_CHANNEL, RESTORE_WORKSPACE_CHANNEL } from "./channels.js";
import { programInstance, reloadProgramWindow, type FluxioInstance } from "./windows.js";
import { readTextFile } from "./dialogs.js";

export function sessionDirectory(instance: FluxioInstance): string {
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return path.join(app.getPath("desktop"), "FluxIO Sessions", `${safe(instance.name)} (${safe(instance.id)})`);
}

export async function createSessionDirectories(instances: FluxioInstance[]): Promise<void> {
  await mkdir(path.join(app.getPath("desktop"), "FluxIO Sessions"), { recursive: true, mode: 0o700 });
  for (const instance of instances) await mkdir(sessionDirectory(instance), { recursive: true, mode: 0o700 });
}

export function registerSessionFiles(loadInstances: () => FluxioInstance[]): void {
  ipcMain.handle(SAVE_WORKSPACE_FILES_CHANNEL, async (event, value: unknown) => {
    const instance = programInstance(event.sender.id);
    if (!instance) throw new Error("Unknown program window");
    if (!value || typeof value !== "object") throw new Error("Invalid workspace files");
    const input = value as Record<string, unknown>;
    const files = { current: "current-schedule.txt", future: "future-schedule.txt", configuration: "stream-config.txt", session: "session.json" };
    for (const key of Object.keys(files)) {
      if (typeof input[key] !== "string" || Buffer.byteLength(input[key] as string) > 32 * 1024 * 1024) {
        throw new Error(`Invalid workspace file: ${key}`);
      }
    }
    const session = JSON.parse(input.session as string);
    if (!session?.snapshot || session.snapshot.version !== 2) throw new Error("Invalid session snapshot");
    await createSessionDirectories([instance]);
    // Каждый файл заменяется целиком: недописанный снимок после отключения
    // питания хуже вчерашнего — из него не восстановиться.
    for (const [key, name] of Object.entries(files)) {
      const destination = path.join(sessionDirectory(instance), name);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, input[key] as string, { mode: 0o600 });
      await rename(temporary, destination);
    }
    return sessionDirectory(instance);
  });

  ipcMain.handle(RESTORE_WORKSPACE_CHANNEL, async (event, id: unknown) => {
    const instance = loadInstances().find((entry) => entry.id === id && entry.enabled);
    if (!instance) throw new Error("Unknown program");
    const status = await api(instance, "/api/playout/status");
    if (["starting", "running", "stopping"].includes(String(status.state))) {
      throw new Error("Остановите эфир перед восстановлением сессии");
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { title: "Восстановить сессию", defaultPath: path.join(sessionDirectory(instance), "session.json"), filters: [{ name: "FluxIO Session", extensions: ["json"] }], properties: ["openFile"] as ["openFile"] };
    const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selected.canceled || !selected.filePaths[0]) return;
    const file = JSON.parse(await readTextFile(selected.filePaths[0], 32 * 1024 * 1024, "Session"));
    if (!file?.snapshot) throw new Error("В файле нет сессии FluxIO");
    // Снимок проверяет служба, а не мастер: схема одна, и второй её копии
    // быть не должно. Ручное восстановление эфир не поднимает — оператор
    // выбирает момент старта сам.
    await api(instance, "/api/workspace-session", { method: "PUT", body: JSON.stringify({ snapshot: { ...file.snapshot, settings: { ...file.snapshot.settings, autoResumeOnLaunch: false } } }) });
    reloadProgramWindow(instance);
  });
}

export async function api(instance: FluxioInstance, route: string, init?: RequestInit): Promise<Record<string, unknown>> {
  // Заголовок JSON — только вместе с телом. На пустое тело с этим заголовком
  // Fastify отвечает 400, и остановка эфира при закрытии окна не проходила
  // никогда: закрытие отменялось с «Body cannot be empty when content-type is set».
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const response = await fetch(new URL(route, instance.apiUrl), { ...init, headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as Record<string, unknown>;
}
