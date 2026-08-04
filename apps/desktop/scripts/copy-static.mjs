import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(desktopRoot, "src", "splash.html");
const destinationDirectory = path.join(desktopRoot, "dist");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, path.join(destinationDirectory, "splash.html"));
