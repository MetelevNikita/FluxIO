import { app, BrowserWindow } from "electron";

//

import { registerIpcHandlers } from "./ipc.js";
import { desktopIconPath, openMainWindow } from "./windows.js";

app.setName("FluxIO");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

//

void app.whenReady().then(() => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(desktopIconPath());
  }

  registerIpcHandlers();
  openMainWindow(true);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
