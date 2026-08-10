import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DotLottie } from "@lottiefiles/dotlottie-web";
import {
  graphicEffectAssetSchema,
  lottieEffectMetadataSchema,
  type GraphicEffectAsset,
  type LottieEditableProperty,
  type LottieEffectMetadata,
} from "@gruber/contracts";

type JsonObject = Record<string, unknown>;

const maximumJsonBytes = 20 * 1024 * 1024;
const maximumEmbeddedAssetBytes = 20 * 1024 * 1024;
const maximumDurationSeconds = 60;
const require = createRequire(import.meta.url);
let wasmReady: Promise<void> | null = null;

export async function analyzeLottieEffect(
  sourcePath: string,
  ffmpegPath: string,
  cacheDirectory: string,
): Promise<GraphicEffectAsset> {
  const document = await readLottieDocument(sourcePath);
  const metadata = inspectLottieDocument(document, sourcePath);
  const filePath = await renderLottieMovie(document, metadata, ffmpegPath, cacheDirectory);
  return graphicEffectAssetSchema.parse({
    id: `fx-${createHash("sha256").update(sourcePath).digest("hex").slice(0, 16)}`,
    name: path.basename(sourcePath, path.extname(sourcePath)),
    filePath,
    kind: "video",
    durationSeconds: (metadata.outPoint - metadata.inPoint) / metadata.frameRate,
    width: readPositiveInteger(document.w, "width"),
    height: readPositiveInteger(document.h, "height"),
    lottie: metadata,
  });
}

export async function rerenderLottieEffect(
  effect: GraphicEffectAsset,
  ffmpegPath: string,
  cacheDirectory: string,
): Promise<GraphicEffectAsset> {
  if (!effect.lottie) throw new Error("The selected effect is not a Lottie project");
  const sourcePath = effect.lottie.sourcePath;
  const document = await readLottieDocument(sourcePath);
  const original = inspectLottieDocument(document, sourcePath);
  const requestedById = new Map(effect.lottie.properties.map((property) => [property.id, property]));
  const properties = original.properties.map((property) => {
    const requested = requestedById.get(property.id);
    return requested
      ? { ...property, value: requested.value, overridden: requested.overridden }
      : property;
  });
  const metadata = lottieEffectMetadataSchema.parse({
    ...original,
    backgroundColor: effect.lottie.backgroundColor,
    properties,
  });
  const renderedDocument = applyLottieProperties(document, metadata.properties);
  const filePath = await renderLottieMovie(
    renderedDocument,
    metadata,
    ffmpegPath,
    cacheDirectory,
  );
  return graphicEffectAssetSchema.parse({
    ...effect,
    filePath,
    durationSeconds: (metadata.outPoint - metadata.inPoint) / metadata.frameRate,
    width: readPositiveInteger(document.w, "width"),
    height: readPositiveInteger(document.h, "height"),
    lottie: metadata,
  });
}

export async function readLottieDocument(sourcePath: string): Promise<JsonObject> {
  if (!path.isAbsolute(sourcePath) || path.extname(sourcePath).toLowerCase() !== ".json") {
    throw new Error("Lottie source must be an absolute .json file path");
  }
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size <= 0 || info.size > maximumJsonBytes) {
    throw new Error(`Lottie JSON must be between 1 byte and ${maximumJsonBytes} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid Lottie JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(parsed)) throw new Error("Lottie JSON root must be an object");
  validateLottieDocument(parsed);
  return parsed;
}

export async function readRenderableLottieDocument(sourcePath: string): Promise<JsonObject> {
  return inlineLocalAssets(await readLottieDocument(sourcePath), sourcePath);
}

export async function lottieWasmBytes(): Promise<Buffer> {
  return readFile(require.resolve("@lottiefiles/dotlottie-web/dotlottie-player.wasm"));
}

export function inspectLottieDocument(
  document: JsonObject,
  sourcePath: string,
): LottieEffectMetadata {
  validateLottieDocument(document);
  const frameRate = readPositiveNumber(document.fr, "frame rate");
  const inPoint = readFiniteNumber(document.ip, "in point");
  const outPoint = readFiniteNumber(document.op, "out point");
  const duration = (outPoint - inPoint) / frameRate;
  if (outPoint <= inPoint || duration > maximumDurationSeconds) {
    throw new Error(`Lottie duration must be greater than 0 and no more than ${maximumDurationSeconds} seconds`);
  }
  const properties: LottieEditableProperty[] = [];
  collectLayerProperties(document.layers, "/layers", "Main composition", properties);
  if (Array.isArray(document.assets)) {
    document.assets.forEach((asset, index) => {
      if (!isObject(asset) || !Array.isArray(asset.layers)) return;
      const name = stringValue(asset.nm) || stringValue(asset.id) || `Asset ${index + 1}`;
      collectLayerProperties(asset.layers, `/assets/${index}/layers`, `Precomp · ${name}`, properties);
    });
  }
  const warnings: string[] = [];
  if (properties.some((property) => property.animated)) {
    warnings.push("Animated properties are preserved until an operator explicitly overrides them.");
  }
  if (Array.isArray(document.assets) && document.assets.some((asset) =>
    isObject(asset) && typeof asset.p === "string" && !asset.p.startsWith("data:"))) {
    warnings.push("External image assets will be embedded into the rendered cache file.");
  }
  return lottieEffectMetadataSchema.parse({
    sourcePath,
    version: stringValue(document.v) || "unknown",
    frameRate,
    inPoint,
    outPoint,
    backgroundColor: "transparent",
    properties,
    warnings,
  });
}

export function applyLottieProperties(
  source: JsonObject,
  properties: LottieEditableProperty[],
): JsonObject {
  const document = structuredClone(source);
  for (const property of properties) {
    if (!property.overridden) continue;
    const segments = decodePointer(property.path);
    if (segments.length === 0) continue;
    const key = segments.at(-1)!;
    const parent = resolveParent(document, segments.slice(0, -1));
    if (!parent) continue;
    if (property.type === "boolean") {
      parent[key] = !Boolean(property.value);
    } else if (property.type === "text" || property.path.endsWith("/sc")) {
      parent[key] = String(property.value);
    } else if (property.type === "color") {
      setAnimatableValue(parent[key], hexToRgba(String(property.value)));
    } else if (property.type === "number") {
      setAnimatableValue(parent[key], Number(property.value));
    } else if (property.type === "vector" && Array.isArray(property.value)) {
      setAnimatableValue(parent[key], property.value);
    }
  }
  return document;
}

async function renderLottieMovie(
  sourceDocument: JsonObject,
  metadata: LottieEffectMetadata,
  ffmpegPath: string,
  cacheDirectory: string,
): Promise<string> {
  await ensureWasm();
  const document = await inlineLocalAssets(sourceDocument, metadata.sourcePath);
  const width = readPositiveInteger(document.w, "width");
  const height = readPositiveInteger(document.h, "height");
  const revision = createHash("sha256")
    .update(metadata.sourcePath)
    .update(JSON.stringify({ backgroundColor: metadata.backgroundColor, properties: metadata.properties }))
    .digest("hex")
    .slice(0, 20);
  await mkdir(cacheDirectory, { recursive: true });
  const outputPath = path.join(cacheDirectory, `${safeFileStem(metadata.sourcePath)}-${revision}.mov`);
  try {
    if ((await stat(outputPath)).isFile()) return outputPath;
  } catch {
    // Cache miss.
  }
  const temporaryPath = `${outputPath}.tmp.mov`;
  const player = new DotLottie({
    canvas: { width, height },
    data: document,
    autoplay: false,
    backgroundColor: metadata.backgroundColor,
    loop: false,
    renderConfig: { autoResize: false, devicePixelRatio: 1 },
    useFrameInterpolation: false,
  });
  try {
    await waitForLottieLoad(player);
    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "rawvideo",
      "-pixel_format", "rgba",
      "-video_size", `${width}x${height}`,
      "-framerate", decimal(metadata.frameRate),
      "-i", "pipe:0",
      "-an",
      "-c:v", "qtrle",
      "-pix_fmt", "argb",
      "-movflags", "+faststart",
      temporaryPath,
    ], { shell: false, stdio: ["pipe", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const completed = new Promise<void>((resolve, reject) => {
      ffmpeg.once("error", reject);
      ffmpeg.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg Lottie render failed with ${code ?? signal}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      });
    });
    const frames = Math.max(1, Math.round(player.totalFrames));
    for (let frame = 0; frame < frames; frame += 1) {
      player.setFrame(frame);
      const buffer = player.buffer;
      if (!buffer || buffer.byteLength !== width * height * 4) {
        throw new Error(`Lottie renderer returned an invalid RGBA frame ${frame}`);
      }
      if (!ffmpeg.stdin.write(Buffer.from(buffer))) await once(ffmpeg.stdin, "drain");
    }
    ffmpeg.stdin.end();
    await completed;
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    player.destroy();
  }
}

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const bytes = await lottieWasmBytes();
      DotLottie.setWasmUrl(`data:application/wasm;base64,${bytes.toString("base64")}`);
      await DotLottie.preload();
    })();
  }
  await wasmReady;
}

function waitForLottieLoad(player: DotLottie): Promise<void> {
  if (player.isLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Lottie renderer timed out while loading JSON")), 30_000);
    player.addEventListener("load", () => {
      clearTimeout(timer);
      resolve();
    });
    player.addEventListener("loadError", (event) => {
      clearTimeout(timer);
      reject(event.error);
    });
  });
}

async function inlineLocalAssets(document: JsonObject, sourcePath: string): Promise<JsonObject> {
  if (!Array.isArray(document.assets)) return structuredClone(document);
  const clone = structuredClone(document);
  const baseDirectory = path.dirname(sourcePath);
  let totalBytes = 0;
  for (const asset of clone.assets as unknown[]) {
    if (!isObject(asset) || typeof asset.p !== "string" || asset.p.startsWith("data:")) continue;
    if (/^[a-z]+:/i.test(asset.p)) throw new Error(`Remote Lottie asset is not allowed: ${asset.p}`);
    const assetPath = path.resolve(baseDirectory, stringValue(asset.u), asset.p);
    const bytes = await readFile(assetPath);
    totalBytes += bytes.byteLength;
    if (totalBytes > maximumEmbeddedAssetBytes) {
      throw new Error(`Embedded Lottie assets exceed ${maximumEmbeddedAssetBytes} bytes`);
    }
    asset.p = `data:${imageMimeType(assetPath)};base64,${bytes.toString("base64")}`;
    asset.u = "";
    asset.e = 1;
  }
  return clone;
}

function collectLayerProperties(
  layers: unknown,
  basePath: string,
  compositionName: string,
  target: LottieEditableProperty[],
): void {
  if (!Array.isArray(layers)) return;
  layers.forEach((layer, layerIndex) => {
    if (!isObject(layer)) return;
    const layerName = stringValue(layer.nm) || `Layer ${layerIndex + 1}`;
    const group = `${compositionName} · ${layerName}`;
    const layerPath = `${basePath}/${layerIndex}`;
    pushProperty(target, {
      path: `${layerPath}/hd`,
      group,
      label: "Visible",
      type: "boolean",
      value: layer.hd !== true,
      animated: false,
    });
    if (typeof layer.sc === "string" && /^#[0-9a-fA-F]{6}$/.test(layer.sc)) {
      pushProperty(target, {
        path: `${layerPath}/sc`, group, label: "Solid color", type: "color",
        value: layer.sc.toUpperCase(), animated: false,
      });
    }
    if (isObject(layer.ks)) {
      collectTransformProperty(layer.ks.o, `${layerPath}/ks/o`, group, "Opacity", "number", target, 0, 100);
      collectTransformProperty(layer.ks.r ?? layer.ks.rz, `${layerPath}/ks/${layer.ks.r ? "r" : "rz"}`, group, "Rotation", "number", target, -360, 360);
      collectTransformProperty(layer.ks.p, `${layerPath}/ks/p`, group, "Position", "vector", target);
      collectTransformProperty(layer.ks.s, `${layerPath}/ks/s`, group, "Scale", "vector", target);
    }
    if (isObject(layer.t) && isObject(layer.t.d) && Array.isArray(layer.t.d.k)) {
      const textKeyframes = layer.t.d.k;
      textKeyframes.forEach((keyframe, keyframeIndex) => {
        if (!isObject(keyframe) || !isObject(keyframe.s) || typeof keyframe.s.t !== "string") return;
        pushProperty(target, {
          path: `${layerPath}/t/d/k/${keyframeIndex}/s/t`,
          group,
          label: keyframeIndex === 0 ? "Text" : `Text keyframe ${keyframeIndex + 1}`,
          type: "text",
          value: keyframe.s.t,
          animated: textKeyframes.length > 1,
        });
      });
    }
    collectShapeProperties(layer.shapes, `${layerPath}/shapes`, group, target);
  });
}

function collectShapeProperties(
  shapes: unknown,
  basePath: string,
  group: string,
  target: LottieEditableProperty[],
): void {
  if (!Array.isArray(shapes)) return;
  shapes.forEach((shape, index) => {
    if (!isObject(shape)) return;
    const shapeName = stringValue(shape.nm) || `Shape ${index + 1}`;
    const shapePath = `${basePath}/${index}`;
    if ((shape.ty === "fl" || shape.ty === "st") && isObject(shape.c)) {
      const value = initialAnimatableValue(shape.c);
      if (Array.isArray(value) && value.length >= 3) {
        pushProperty(target, {
          path: `${shapePath}/c`,
          group,
          label: `${shape.ty === "fl" ? "Fill" : "Stroke"} · ${shapeName}`,
          type: "color",
          value: rgbaToHex(value),
          animated: shape.c.a === 1,
        });
      }
    }
    if (shape.ty === "gr") collectShapeProperties(shape.it, `${shapePath}/it`, group, target);
  });
}

function collectTransformProperty(
  property: unknown,
  propertyPath: string,
  group: string,
  label: string,
  type: "number" | "vector",
  target: LottieEditableProperty[],
  min?: number,
  max?: number,
): void {
  if (!isObject(property)) return;
  const value = initialAnimatableValue(property);
  if (type === "number" && typeof value !== "number") return;
  if (type === "vector" && (!Array.isArray(value) || value.length < 2)) return;
  const normalizedValue = type === "vector"
    ? (value as unknown[]).slice(0, 3).map(Number)
    : Number(value);
  pushProperty(target, {
    path: propertyPath,
    group,
    label,
    type,
    value: normalizedValue,
    animated: property.a === 1,
    min,
    max,
  });
}

function initialAnimatableValue(property: JsonObject): unknown {
  if (property.a === 1 && Array.isArray(property.k)) {
    const first = property.k.find((entry) => isObject(entry) && "s" in entry);
    if (isObject(first) && Array.isArray(first.s)) {
      return first.s.length === 1 && typeof first.s[0] === "number" ? first.s[0] : first.s;
    }
  }
  return property.k;
}

function pushProperty(
  target: LottieEditableProperty[],
  input: Omit<LottieEditableProperty, "id" | "overridden">,
): void {
  target.push({
    ...input,
    id: createHash("sha1").update(input.path).digest("hex").slice(0, 16),
    overridden: false,
  });
}

function setAnimatableValue(property: unknown, value: number | number[]): void {
  if (!isObject(property)) return;
  property.a = 0;
  property.k = value;
  delete property.x;
}

function validateLottieDocument(document: JsonObject): void {
  readPositiveNumber(document.fr, "frame rate");
  readFiniteNumber(document.ip, "in point");
  readFiniteNumber(document.op, "out point");
  readPositiveInteger(document.w, "width");
  readPositiveInteger(document.h, "height");
  if (!Array.isArray(document.layers)) throw new Error("Lottie JSON must contain a layers array");
}

function resolveParent(document: JsonObject, segments: string[]): JsonObject | null {
  let current: unknown = document;
  for (const segment of segments) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (isObject(current)) current = current[segment];
    else return null;
  }
  return isObject(current) || Array.isArray(current) ? current as JsonObject : null;
}

function decodePointer(pointer: string): string[] {
  return pointer.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function rgbaToHex(value: unknown[]): string {
  return `#${value.slice(0, 3).map((entry) =>
    Math.round(Math.max(0, Math.min(1, Number(entry))) * 255).toString(16).padStart(2, "0")
  ).join("")}`.toUpperCase();
}

function hexToRgba(value: string): number[] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value.slice(1) : "FFFFFF";
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255).concat(1);
}

function safeFileStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "lottie";
}

function imageMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  return "image/jpeg";
}

function decimal(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid Lottie ${label}`);
  return value;
}

function readPositiveNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);
  if (number <= 0) throw new Error(`Invalid Lottie ${label}`);
  return number;
}

function readPositiveInteger(value: unknown, label: string): number {
  const number = readPositiveNumber(value, label);
  if (!Number.isInteger(number) || number > 4_096) throw new Error(`Invalid Lottie ${label}`);
  return number;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
