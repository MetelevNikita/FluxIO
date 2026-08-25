import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { DotLottie } from "@lottiefiles/dotlottie-web";
import { measureTextWidth, readFontMetrics, type FontMetrics } from "./font-metrics.js";
import {
  graphicEffectAssetSchema,
  type LottieFitSample,
  lottieEffectMetadataSchema,
  lottieTextBoxSchema,
  type GraphicEffectAsset,
  type LottieTextBox,
  type LottieEditableProperty,
  type LottieEffectMetadata,
} from "@gruber/contracts";

type JsonObject = Record<string, unknown>;

const maximumJsonBytes = 20 * 1024 * 1024;
const maximumEmbeddedAssetBytes = 20 * 1024 * 1024;
const maximumDurationSeconds = 60;
/** Максимум, на который рендер вправе занять цикл событий, не отдавая его API. */
const maximumBlockingMs = 16;
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
    if (!requested) return property;
    // Образец для плашки приходит и у неизменённого поля: часы уходят в эфир
    // пустым текстом, а мерить подложку всё равно надо.
    const withSample = { ...property, fitSample: requested.fitSample ?? null };
    return requested.overridden
      ? { ...withSample, value: requested.value, overridden: true }
      : withSample;
  });
  const metadata = lottieEffectMetadataSchema.parse({
    ...original,
    backgroundColor: effect.lottie.backgroundColor,
    properties,
  });
  const renderedDocument = applyLottieProperties(document, metadata.properties);
  metadata.warnings = [
    ...metadata.warnings,
    ...(await fitPlatesToText(renderedDocument, document, metadata.properties)),
  ].slice(0, 100);
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
  const fluxExport = readFluxExportMetadata(document);
  const properties: LottieEditableProperty[] = [];
  collectLayerProperties(
    document.layers,
    "/layers",
    "Main composition",
    properties,
    document.slots,
    document,
    fluxExport?.editableTextKeys ?? null,
  );
  if (Array.isArray(document.assets)) {
    document.assets.forEach((asset, index) => {
      if (!isObject(asset) || !Array.isArray(asset.layers)) return;
      const name = stringValue(asset.nm) || stringValue(asset.id) || `Asset ${index + 1}`;
      collectLayerProperties(
        asset.layers,
        `/assets/${index}/layers`,
        `Precomp · ${name}`,
        properties,
        document.slots,
        null,
        fluxExport?.editableTextKeys ?? null,
      );
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
  if (properties.some((property) => property.type === "text") && Array.isArray(document.chars)) {
    warnings.push("This Lottie embeds font glyphs. New characters render only when those glyphs were exported from After Effects.");
  }
  warnings.push(...(fluxExport?.warnings ?? []));
  return lottieEffectMetadataSchema.parse({
    sourcePath,
    version: stringValue(document.v) || "unknown",
    frameRate,
    inPoint,
    outPoint,
    backgroundColor: "transparent",
    properties,
    responsiveTextKeys: collectResponsiveTextKeys(document.layers),
    dataSourceName: fluxExport?.dataSourceName ?? null,
    matchSourceKey: fluxExport?.matchSourceKey ?? null,
    dataBindings: fluxExport?.dataBindings ?? [],
    warnings,
  });
}

interface FluxExportMetadata {
  editableTextKeys: Set<string>;
  dataSourceName: string | null;
  matchSourceKey: string | null;
  dataBindings: { sourceKey: string; targetKey: string }[];
  warnings: string[];
}

/**
 * Метаданные панели Flux Title Exporter необязательны: обычный Bodymovin JSON
 * по-прежнему показывает все Text Layer. Если дизайнер явно выбрал поля в AE,
 * остальные текстовые слои остаются частью картинки, но не засоряют редактор
 * оператора и JSON Parser.
 */
function readFluxExportMetadata(document: JsonObject): FluxExportMetadata | null {
  const meta = isObject(document.meta) ? document.meta : null;
  const flux = meta && isObject(meta.flux) ? meta.flux : null;
  if (!flux || flux.schemaVersion !== 1 || !Array.isArray(flux.fields)) return null;
  const editableTextKeys = new Set<string>();
  for (const field of flux.fields) {
    if (!isObject(field) || field.type !== "text") continue;
    const layerName = stringValue(field.layerName) || stringValue(field.key);
    if (layerName) editableTextKeys.add(layerName);
  }
  const warnings = Array.isArray(flux.warnings)
    ? flux.warnings.filter((value): value is string => typeof value === "string")
      .map((value) => value.slice(0, 512))
      .slice(0, 50)
    : [];
  const dataSourceName = typeof flux.dataSourceName === "string"
    ? flux.dataSourceName.slice(0, 512)
    : null;
  const matchSourceKey = typeof flux.matchSourceKey === "string" && flux.matchSourceKey.trim()
    ? flux.matchSourceKey.trim().slice(0, 256)
    : null;
  const dataBindings = Array.isArray(flux.dataBindings)
    ? flux.dataBindings.flatMap((binding) => {
        if (!isObject(binding)) return [];
        const sourceKey = stringValue(binding.sourceKey).trim();
        const targetKey = stringValue(binding.targetKey).trim();
        return sourceKey && targetKey
          ? [{ sourceKey: sourceKey.slice(0, 256), targetKey: targetKey.slice(0, 128) }]
          : [];
      }).slice(0, 128)
    : [];
  return { dataBindings, dataSourceName, editableTextKeys, matchSourceKey, warnings };
}

/** Связи `fit:` верхней композиции, которые можно безопасно показать оператору. */
function collectResponsiveTextKeys(layers: unknown): string[] {
  if (!Array.isArray(layers)) return [];
  return [...new Set(layers
    .filter(isObject)
    .map(fitTargetName)
    .filter((value): value is string => Boolean(value)))];
}

/**
 * Плашка, которая обязана сесть по тексту.
 *
 * В Lottie нет раскладки: ширина прямоугольника — обычное число в файле, и
 * подставленный оператором текст её не двигает. Поэтому слой-подложку помечают
 * в After Effects именем `fit:<имя текстового слоя>` — тогда перед рендером
 * прямоугольник пересчитывается под реальный текст.
 *
 * Отступы не задаются отдельно: они берутся из самого шаблона как разница между
 * нарисованной шириной плашки и шириной шаблонного текста. Что нарисовал
 * дизайнер, то и сохраняется.
 *
 * Растёт плашка в ту сторону, куда выключен текст: у левой выключки правый край
 * уезжает вправо, у правой — левый влево, у центральной обе стороны поровну.
 */
export async function fitPlatesToText(
  rendered: JsonObject,
  template: JsonObject,
  properties: LottieEditableProperty[],
): Promise<string[]> {
  const warnings: string[] = [];
  const samples = collectFitSamples(rendered, properties);
  const fonts = new FontCache(rendered);
  const renderedLayers = Array.isArray(rendered.layers) ? rendered.layers : [];
  const templateLayers = Array.isArray(template.layers) ? template.layers : [];
  const height = readPositiveInteger(rendered.h, "height");

  for (const layer of renderedLayers) {
    if (!isObject(layer)) continue;
    const target = fitTargetName(layer);
    if (!target) continue;
    const textLayer = renderedLayers.find(
      (candidate) => isObject(candidate) && stringValue(candidate.nm) === target,
    );
    const templateLayer = templateLayers.find(
      (candidate) => isObject(candidate) && stringValue(candidate.nm) === target,
    );
    if (!isObject(textLayer) || !isObject(templateLayer)) {
      warnings.push(`Plate "${stringValue(layer.nm)}" points at a missing text layer "${target}"`);
      continue;
    }
    const current = firstTextDocument(textLayer.t);
    const original = firstTextDocument(templateLayer.t);
    if (!current || !original) {
      warnings.push(`Layer "${target}" is not a text layer, so its plate was left as designed`);
      continue;
    }
    const rectangle = findRectangle(layer.shapes);
    if (!rectangle) {
      warnings.push(`Plate "${stringValue(layer.nm)}" has no rectangle to resize`);
      continue;
    }

    const sample = samples.get(target) ?? null;
    const templateFont = await fonts.forTextDocument(original);
    const sampleFont = sample?.fontFilePath
      ? await fonts.forFile(sample.fontFilePath)
      : templateFont;
    // Flux Title Exporter не встраивает лицензируемый font binary в JSON.
    // Для гибридной надписи оператор всё равно выбирает конкретный font file;
    // им можно честно измерить и исходный sample, и новое эфирное значение.
    const templateMeasureFont = templateFont ?? sampleFont;
    if (!templateMeasureFont || !sampleFont) {
      warnings.push(
        `The font of "${target}" is neither embedded nor selected, so its plate was left as designed`,
      );
      continue;
    }

    const templateSize = numberValue(original.s) ?? 0;
    const sampleSize = sample?.fontSizePercent != null
      ? (sample.fontSizePercent / 100) * height
      : templateSize;
    if (templateSize <= 0 || sampleSize <= 0) continue;

    const templateWidth = measureTextWidth(
      templateMeasureFont,
      stringValue(original.t),
      templateSize,
      numberValue(original.tr) ?? 0,
    );
    const text = sample ? sample.text : stringValue(current.t);
    const currentWidth = measureTextWidth(
      sampleFont,
      text,
      sampleSize,
      numberValue(current.tr) ?? 0,
    );
    const delta = currentWidth - templateWidth;
    if (Math.abs(delta) < 0.5) continue;
    const resized = fitRectangleToText(rectangle, delta, numberValue(current.j) ?? 0);
    if (!resized) {
      warnings.push(
        `Plate "${stringValue(layer.nm)}" has an animated size, so it was left as designed`,
      );
    }
  }
  return warnings;
}

/** `fit:<имя текстового слоя>` в имени слоя; регистр и пробелы не важны. */
function fitTargetName(layer: JsonObject): string | null {
  const name = stringValue(layer.nm).trim();
  if (!name.toLowerCase().startsWith("fit:")) return null;
  const target = name.slice(4).trim();
  return target.length > 0 ? target : null;
}

function collectFitSamples(
  document: JsonObject,
  properties: LottieEditableProperty[],
): Map<string, LottieFitSample> {
  const layers = Array.isArray(document.layers) ? document.layers : [];
  const samples = new Map<string, LottieFitSample>();
  for (const property of properties) {
    if (property.type !== "text" || !property.fitSample) continue;
    const segments = decodePointer(property.path);
    if (segments[0] !== "layers") continue;
    const layer = layers[Number(segments[1])];
    if (!isObject(layer)) continue;
    const name = stringValue(layer.nm).trim();
    if (name) samples.set(name, property.fitSample);
  }
  return samples;
}

/** Первый прямоугольник слоя, как бы глубоко он ни лежал в группах. */
function findRectangle(shapes: unknown): JsonObject | null {
  if (!Array.isArray(shapes)) return null;
  for (const shape of shapes) {
    if (!isObject(shape)) continue;
    if (shape.ty === "rc") return shape;
    const nested = findRectangle(shape.it);
    if (nested) return nested;
  }
  return null;
}

/** Ширина прямоугольника плюс `delta`; false — размер анимирован, трогать нельзя. */
export function fitRectangleToText(rectangle: JsonObject, delta: number, justification: number): boolean {
  const size = isObject(rectangle.s) ? rectangle.s : null;
  if (!size || size.a === 1 || !Array.isArray(size.k)) return false;
  const width = Number(size.k[0]);
  const heightValue = Number(size.k[1]);
  if (!Number.isFinite(width) || !Number.isFinite(heightValue)) return false;
  size.k = [Math.max(1, width + delta), heightValue];

  // Центр прямоугольника уезжает на половину прибавки, поэтому неподвижным
  // остаётся тот край, от которого набирается текст.
  const shift = justification === 2 ? 0 : justification === 1 ? -delta / 2 : delta / 2;
  const position = isObject(rectangle.p) ? rectangle.p : null;
  if (shift !== 0 && position && position.a !== 1 && Array.isArray(position.k)) {
    const x = Number(position.k[0]);
    const y = Number(position.k[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) position.k = [x + shift, y];
  }
  return true;
}

/** Шрифты документа: встроенные в `fonts.list` и выбранные оператором файлы. */
class FontCache {
  readonly #document: JsonObject;
  readonly #byName = new Map<string, FontMetrics | null>();
  readonly #byFile = new Map<string, FontMetrics | null>();

  constructor(document: JsonObject) {
    this.#document = document;
  }

  async forFile(filePath: string): Promise<FontMetrics | null> {
    const cached = this.#byFile.get(filePath);
    if (cached !== undefined) return cached;
    const metrics = await readFile(filePath)
      .then((bytes) => readFontMetrics(bytes))
      .catch(() => null);
    this.#byFile.set(filePath, metrics);
    return metrics;
  }

  async forTextDocument(textDocument: JsonObject): Promise<FontMetrics | null> {
    const name = stringValue(textDocument.f);
    if (!name) return null;
    const cached = this.#byName.get(name);
    if (cached !== undefined) return cached;
    const metrics = this.#embedded(name);
    this.#byName.set(name, metrics);
    return metrics;
  }

  /** Шрифт, вшитый в проект как `data:`; путь на диске отдаётся отдельным методом. */
  #embedded(name: string): FontMetrics | null {
    const fonts = isObject(this.#document.fonts) ? this.#document.fonts : null;
    const list = fonts && Array.isArray(fonts.list) ? fonts.list : [];
    for (const entry of list) {
      if (!isObject(entry) || stringValue(entry.fName) !== name) continue;
      const source = stringValue(entry.fPath);
      const comma = source.indexOf(",");
      if (!source.startsWith("data:") || comma < 0) return null;
      return readFontMetrics(Buffer.from(source.slice(comma + 1), "base64"));
    }
    return null;
  }
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
    let lastYieldAt = Date.now();
    for (let frame = 0; frame < frames; frame += 1) {
      player.setFrame(frame);
      const buffer = player.buffer;
      if (!buffer || buffer.byteLength !== width * height * 4) {
        throw new Error(`Lottie renderer returned an invalid RGBA frame ${frame}`);
      }
      if (!ffmpeg.stdin.write(Buffer.from(buffer))) await once(ffmpeg.stdin, "drain");
      // Рендер кадра DotLottie — тяжёлая синхронная операция, особенно на UHD.
      // Пока она идёт, сервис не отвечает ни на один запрос, и оператор видит
      // это как замерший интерфейс. Уступаем цикл событий по времени, а не
      // через каждые два кадра: длительность кадра зависит от проекта, и на
      // тяжёлом шаблоне пара кадров успевала занять сотни миллисекунд.
      if (Date.now() - lastYieldAt >= maximumBlockingMs) {
        await yieldToEventLoop();
        lastYieldAt = Date.now();
      }
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
  slots: unknown,
  /** Корневой документ: из него берутся размер кадра и границы времени. */
  composition: JsonObject | null = null,
  /** null сохраняет историческое поведение: редактируются все Text Layer. */
  editableTextKeys: Set<string> | null = null,
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
    if (
      isObject(layer.t) &&
      isObject(layer.t.d) &&
      (editableTextKeys == null || editableTextKeys.has(layerName))
    ) {
      collectTextProperties(layer.t.d, layerPath, group, slots, target, () =>
        composition ? readTextBox(composition, layers, layer, firstTextDocument(layer.t)) : null);
    }
    collectShapeProperties(layer.shapes, `${layerPath}/shapes`, group, target);
  });
}

function collectTextProperties(
  textDocument: JsonObject,
  layerPath: string,
  group: string,
  slots: unknown,
  target: LottieEditableProperty[],
  textBox: () => LottieTextBox | null = () => null,
): void {
  const slotId = stringValue(textDocument.sid);
  if (slotId && isObject(slots)) {
    const slot = slots[slotId];
    if (isObject(slot) && isObject(slot.p) && collectTextKeyframes(
      slot.p,
      `/slots/${encodePointerSegment(slotId)}/p`,
      `${group} · Slot ${slotId}`,
      target,
      textBox,
    )) return;
  }
  collectTextKeyframes(textDocument, `${layerPath}/t/d`, group, target, textBox);
}

function collectTextKeyframes(
  textDocument: JsonObject,
  documentPath: string,
  group: string,
  target: LottieEditableProperty[],
  textBox: () => LottieTextBox | null = () => null,
): boolean {
  if (!Array.isArray(textDocument.k)) return false;
  const textKeyframes = textDocument.k;
  let found = false;
  textKeyframes.forEach((keyframe, keyframeIndex) => {
    if (!isObject(keyframe) || !isObject(keyframe.s) || typeof keyframe.s.t !== "string") return;
    found = true;
    pushProperty(target, {
      path: `${documentPath}/k/${keyframeIndex}/s/t`,
      group,
      label: keyframeIndex === 0 ? "Text" : `Text keyframe ${keyframeIndex + 1}`,
      type: "text",
      value: keyframe.s.t,
      animated: textKeyframes.length > 1,
      textBox: textBox(),
    });
  });
  return found;
}

/* -------------------------------------------------------------------------- *
 * Геометрия текстового слоя
 * -------------------------------------------------------------------------- */

interface LayerTransform {
  position: [number, number];
  anchor: [number, number];
  scale: [number, number];
  rotationDegrees: number;
}

/**
 * Где на кадре стоит текстовый слой и чем он нарисован.
 *
 * Нужно, чтобы значение эффекта — Dynamic title, часы, отсчёт, бегущая строка —
 * встало ровно на место слоя шаблона: Lottie рендерится один раз в файл, а
 * реальный текст поверх него рисует FFmpeg.
 *
 * Позиция считается на середине композиции: у слоя или его родителя анимация
 * входа в первом кадре могла ещё не отыграть (масштаб 0 — и координата уехала
 * бы в ноль). Ключевые кадры не интерполируются — берётся значение действующего
 * кадра; для статичной плашки это то же самое, а для анимированной даёт
 * положение «в покое».
 */
function readTextBox(
  document: JsonObject,
  layers: unknown[],
  layer: JsonObject,
  textDocument: JsonObject,
): LottieTextBox | null {
  const width = readPositiveInteger(document.w, "width");
  const height = readPositiveInteger(document.h, "height");
  const time = (readFiniteNumber(document.ip, "in point") +
    readFiniteNumber(document.op, "out point")) / 2;

  let x = 0;
  let y = 0;
  let scaleX = 1;
  let scaleY = 1;
  let current: JsonObject | null = layer;
  const visited = new Set<unknown>();
  // Позиция слоя задана в системе координат родителя, поэтому поднимаемся по
  // цепочке до корня. `visited` страхует от циклической ссылки в битом файле.
  while (current && !visited.has(current)) {
    visited.add(current);
    const transform = readTransform(current, time);
    const anchorX = transform.anchor[0] * transform.scale[0];
    const anchorY = transform.anchor[1] * transform.scale[1];
    x = transform.position[0] + x * transform.scale[0] - anchorX;
    y = transform.position[1] + y * transform.scale[1] - anchorY;
    scaleX *= transform.scale[0];
    scaleY *= transform.scale[1];
    const parentIndex: unknown = current.parent;
    const parent = typeof parentIndex === "number"
      ? layers.find((candidate) => isObject(candidate) && candidate.ind === parentIndex)
      : undefined;
    current = isObject(parent) ? parent : null;
  }

  const fontSize = numberValue(textDocument.s) ?? 0;
  if (fontSize <= 0) return null;
  return lottieTextBoxSchema.parse({
    align: justificationAlign(numberValue(textDocument.j) ?? 0),
    color: fillColor(textDocument.fc),
    fontSizePercent: Math.abs(fontSize * scaleY) / height * 100,
    xPercent: x / width * 100,
    yPercent: y / height * 100,
  });
}

function readTransform(layer: JsonObject, time: number): LayerTransform {
  const ks = isObject(layer.ks) ? layer.ks : {};
  return {
    anchor: readVector(ks.a, time, [0, 0]),
    position: readVector(ks.p, time, [0, 0]),
    rotationDegrees: readVector(ks.r ?? ks.rz, time, [0, 0])[0],
    scale: readVector(ks.s, time, [100, 100]).map((value) => value / 100) as [number, number],
  };
}

/** Первый текстовый документ слоя — из него берутся кегль, цвет и выключка. */
function firstTextDocument(text: unknown): JsonObject {
  if (!isObject(text) || !isObject(text.d) || !Array.isArray(text.d.k)) return {};
  const first = text.d.k.find((keyframe) => isObject(keyframe) && isObject(keyframe.s));
  return isObject(first) && isObject(first.s) ? first.s : {};
}

/** Значение свойства на момент `time`: статическое либо действующий ключевой кадр. */
function readVector(
  property: unknown,
  time: number,
  fallback: [number, number],
): [number, number] {
  if (!isObject(property)) return fallback;
  const raw = property.k;
  if (typeof raw === "number") return [raw, raw];
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === "number")) {
    return [raw[0] ?? fallback[0], raw[1] ?? fallback[1]];
  }
  if (!Array.isArray(raw)) return fallback;
  let value: number[] | null = null;
  for (const keyframe of raw) {
    if (!isObject(keyframe)) continue;
    const keyTime = numberValue(keyframe.t) ?? 0;
    const start = keyframe.s;
    if (Array.isArray(start) && start.every((entry) => typeof entry === "number")) {
      if (value === null || keyTime <= time) value = start as number[];
    }
    if (keyTime > time && value !== null) break;
  }
  return value ? [value[0] ?? fallback[0], value[1] ?? fallback[1]] : fallback;
}

function justificationAlign(justification: number): LottieTextBox["align"] {
  if (justification === 1) return "right";
  if (justification === 2) return "center";
  return "left";
}

function fillColor(value: unknown): string {
  if (!Array.isArray(value) || value.length < 3) return "#FFFFFF";
  return `#${[0, 1, 2]
    .map((index) => Math.round(Math.min(1, Math.max(0, Number(value[index]) || 0)) * 255)
      .toString(16)
      .padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  input: Omit<LottieEditableProperty, "id" | "overridden" | "textBox" | "fitSample"> &
    { textBox?: LottieTextBox | null },
): void {
  if (target.some((property) => property.path === input.path)) return;
  target.push({
    ...input,
    id: createHash("sha1").update(input.path).digest("hex").slice(0, 16),
    originalValue: structuredClone(input.value),
    overridden: false,
    textBox: input.textBox ?? null,
    // Образец для подгонки плашки приходит от интерфейса вместе с рендером,
    // при разборе документа его ещё нет.
    fitSample: null,
  });
}

function encodePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
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
