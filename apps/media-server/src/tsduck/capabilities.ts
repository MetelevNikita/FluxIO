import path from "node:path";
import { runCommand } from "../ffmpeg/process.js";

export class TsdDuckCapabilitiesService {
  readonly tspPath: string;
  #version: Promise<string> | null = null;

  constructor(tspPath = process.env.TSDUCK_PATH ?? "tsp") {
    this.tspPath = tspPath;
  }

  getVersion(): Promise<string> {
    this.#version ??= this.#detectVersion();
    return this.#version;
  }

  async assertSrtSupport(): Promise<void> {
    const tsversionPath = path.isAbsolute(this.tspPath)
      ? path.join(path.dirname(this.tspPath), process.platform === "win32" ? "tsversion.exe" : "tsversion")
      : "tsversion";
    try {
      await runCommand(tsversionPath, ["--support", "srt"]);
    } catch {
      throw new Error("Installed TSDuck was built without SRT support");
    }
  }

  async #detectVersion(): Promise<string> {
    try {
      const result = await runCommand(this.tspPath, ["--version"]);
      return result.stdout.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TSDuck tsp is required for SCTE-35 injection: ${message}`);
    }
  }
}
