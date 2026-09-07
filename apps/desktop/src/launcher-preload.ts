import { contextBridge, ipcRenderer } from "electron";

const INSTANCES_OVERVIEW_CHANNEL = "instances:overview";
const OPEN_INSTANCE_CHANNEL = "instances:open";
const ADD_INSTANCE_CHANNEL = "instances:add";
const RENAME_INSTANCE_CHANNEL = "instances:rename";
const DELETE_INSTANCE_CHANNEL = "instances:delete";

contextBridge.exposeInMainWorld("fluxioLauncher", {
  overview: (): Promise<unknown> => ipcRenderer.invoke(INSTANCES_OVERVIEW_CHANNEL),
  open: (id: string): Promise<void> => ipcRenderer.invoke(OPEN_INSTANCE_CHANNEL, id),
  add: (name: string): Promise<void> => ipcRenderer.invoke(ADD_INSTANCE_CHANNEL, name),
  rename: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(RENAME_INSTANCE_CHANNEL, id, name),
  delete: (id: string): Promise<void> => ipcRenderer.invoke(DELETE_INSTANCE_CHANNEL, id),
});
