import type { WorkspaceSessionSnapshot } from "@gruber/contracts";
import type { MediaAsset } from "./types.js";

export type InputProfile = NonNullable<WorkspaceSessionSnapshot["inputProfile"]>;

const codecKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^h265$/, "hevc");
const formatFamilies: Record<string, string> = {
  m4v: "mov", mov: "mov", mp4: "mov", mkv: "matroska", webm: "matroska",
  m2ts: "mpegts", ts: "mpegts", mpg: "mpeg", mpeg: "mpeg",
};

export function inputProfileMismatch(asset: MediaAsset, profile: InputProfile | null): string[] {
  if (!profile || asset.status !== "analyzed" || asset.rowKind === "comment") return [];
  const actualContainer = asset.filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  const container = profile.container.toLowerCase().replace(/^\./, "");
  const expectedFormat = formatFamilies[container] ?? container;
  const actualFormats = asset.containerFormat?.toLowerCase().split(",") ?? [];
  const actualCodec = asset.codecFamily.toLowerCase();
  const actualResolution = asset.resolution.replace("×", "x");
  return [
    actualContainer !== container || actualFormats.length > 0 && !actualFormats.includes(expectedFormat)
      ? `контейнер ${actualContainer || "?"} (${asset.containerFormat ?? "неизвестен"}) ≠ ${container}` : "",
    codecKey(actualCodec) !== codecKey(profile.codec) ? `кодек ${actualCodec} ≠ ${profile.codec}` : "",
    actualResolution !== `${profile.width}x${profile.height}`
      ? `разрешение ${actualResolution} ≠ ${profile.width}x${profile.height}` : "",
  ].filter(Boolean);
}
