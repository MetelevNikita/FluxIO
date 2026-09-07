import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationDirectory = path.join(desktopRoot, "dist");

await mkdir(destinationDirectory, { recursive: true });
const launcherRenderer = await readFile(
  path.join(destinationDirectory, "launcher-renderer.js"),
  "utf8",
);
if (/\b(?:exports|require)\b/.test(launcherRenderer)) {
  throw new Error("launcher-renderer.js must be a browser script, not CommonJS");
}
for (const name of ["launcher.html", "splash.html"]) {
  await copyFile(path.join(desktopRoot, "src", name), path.join(destinationDirectory, name));
}
