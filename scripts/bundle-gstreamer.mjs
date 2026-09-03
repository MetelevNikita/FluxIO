import { existsSync } from "node:fs";
import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Окружение GStreamer для мастера установки.
 *
 * Это **намеренная копия** `gstreamerEnvironment` из
 * `apps/media-server/src/subtitles/gstreamer.ts`. Причина та же, по которой
 * продублированы строки каналов desktop-моста: мастер работает до всякой
 * сборки и не может импортировать скомпилированный TypeScript, а служба в
 * эфире не может зависеть от bootstrap-скриптов.
 *
 * Расхождение ловится тестом `scripts/bundle.test.mjs`: он сверяет обе
 * реализации на одних и тех же входных данных. Правя одну — правь вторую.
 * ------------------------------------------------------------------------- */

export function gstreamerEnvironment({
  environment = process.env,
  exists = existsSync,
  platform = process.platform,
  registryPath = process.env.GSTREAMER_REGISTRY,
  root = process.env.GSTREAMER_ROOT,
} = {}) {
  const result = { ...environment };
  if (registryPath) result.GST_REGISTRY = registryPath;
  if (!root) return result;

  const join = (...parts) => path.join(root, ...parts);
  const pluginPath = join("lib", "gstreamer-1.0");
  if (exists(pluginPath)) {
    result.GST_PLUGIN_SYSTEM_PATH = pluginPath;
    delete result.GST_PLUGIN_PATH;
  }

  const scanner = join(
    "libexec",
    "gstreamer-1.0",
    platform === "win32" ? "gst-plugin-scanner.exe" : "gst-plugin-scanner",
  );
  if (exists(scanner)) result.GST_PLUGIN_SCANNER = scanner;

  const fonts = join("etc", "fonts");
  if (exists(fonts)) result.FONTCONFIG_PATH = fonts;

  const libraryPath = join("lib");
  if (exists(libraryPath)) {
    const variable = platform === "darwin"
      ? "DYLD_LIBRARY_PATH"
      : platform === "win32"
        ? "PATH"
        : "LD_LIBRARY_PATH";
    const separator = platform === "win32" ? ";" : ":";
    const previous = result[variable];
    const prefix = platform === "win32" ? [join("bin"), libraryPath] : [libraryPath];
    result[variable] = [...prefix, previous].filter(Boolean).join(separator);
  }

  return result;
}
