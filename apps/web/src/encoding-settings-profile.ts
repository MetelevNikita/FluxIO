import {
  encodingSettingsFileSchema,
  portableEncodingSettingsSchema,
  type EncodingSettingsFile,
  type PortableEncodingSettings,
} from "@gruber/contracts";
import type { BroadcastSettings } from "./types.js";

export function createEncodingSettingsProfile(
  settings: BroadcastSettings,
  applicationVersion: string,
  exportedAt = new Date(),
): EncodingSettingsFile {
  return encodingSettingsFileSchema.parse({
    format: "fluxio-encoding-settings",
    formatVersion: 1,
    applicationVersion,
    exportedAt: exportedAt.toISOString(),
    secretsOmitted: ["streamKey", "srtPassphrase", "rtmpStreamKey"],
    settings: portableEncodingSettings(settings),
  });
}

export function serializeEncodingSettingsProfile(profile: EncodingSettingsFile): string {
  return `${JSON.stringify(encodingSettingsFileSchema.parse(profile), null, 2)}\n`;
}

export function parseEncodingSettingsProfile(content: string): EncodingSettingsFile {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Encoding settings file is not valid JSON text");
  }
  return encodingSettingsFileSchema.parse(decoded);
}

export function applyEncodingSettingsProfile(
  profile: EncodingSettingsFile,
  defaults: BroadcastSettings,
): BroadcastSettings {
  return {
    ...defaults,
    ...profile.settings,
    streamKey: "",
    srtPassphrase: "",
    rtmpStreamKey: "",
  };
}

function portableEncodingSettings(settings: BroadcastSettings): PortableEncodingSettings {
  const candidate: Record<string, unknown> = { ...settings };
  delete candidate.streamKey;
  delete candidate.srtPassphrase;
  delete candidate.rtmpStreamKey;
  // Автостарт — настройка станции, а не кодирования: возить её между машинами
  // значит поднять чужой эфир на чужой машине после первой же перезагрузки.
  delete candidate.autoResumeOnLaunch;
  return portableEncodingSettingsSchema.parse(candidate);
}
