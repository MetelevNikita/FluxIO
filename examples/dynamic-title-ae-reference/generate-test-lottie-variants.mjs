import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const source = JSON.parse(await readFile(
  `${directory}/FluxIO_Dynamic_Title_Test.json`,
  "utf8",
));

function cloneSource(name) {
  const document = structuredClone(source);
  document.nm = name;
  return document;
}

function layer(document, name) {
  const result = document.layers.find((candidate) => candidate.nm === name);
  if (!result) throw new Error(`Missing source layer: ${name}`);
  return result;
}

function textDocument(textLayer) {
  const result = textLayer.t?.d?.k?.[0]?.s;
  if (!result) throw new Error(`Missing text document: ${textLayer.nm}`);
  return result;
}

function rectangle(shapeLayer) {
  const result = shapeLayer.shapes?.find((shape) => shape.ty === "rc");
  if (!result) throw new Error(`Missing rectangle: ${shapeLayer.nm}`);
  return result;
}

function setAnimatedPosition(textLayer, start, end) {
  const keyframes = textLayer.ks?.p?.k;
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error(`Missing animated position: ${textLayer.nm}`);
  }
  keyframes[0].s = start;
  keyframes[0].e = end;
  keyframes[1].s = end;
}

function addCaption(document, name, text, y, tracking) {
  const title = layer(document, document.layers.some((candidate) => candidate.nm === "next_title")
    ? "next_title"
    : "clock");
  const caption = structuredClone(title);
  caption.ind = Math.max(...document.layers.map((candidate) => candidate.ind ?? 0)) + 1;
  caption.nm = name;
  const captionText = textDocument(caption);
  captionText.t = text;
  captionText.s = 28;
  captionText.tr = tracking;
  setAnimatedPosition(caption, [304, y, 0], [274, y, 0]);
  document.layers.unshift(caption);
}

function nextProgramPreset() {
  const document = cloneSource("FluxIO Next Program Test");
  const title = layer(document, "status");
  const plate = layer(document, "fit:status");
  title.nm = "next_title";
  plate.nm = "fit:next_title";
  const titleText = textDocument(title);
  titleText.t = "СЛЕДУЮЩАЯ ПРОГРАММА";
  titleText.s = 54;
  titleText.tr = 10;
  setAnimatedPosition(title, [304, 858, 0], [274, 858, 0]);
  rectangle(plate).s.k = [960, 180];
  rectangle(plate).p.k = [650, 820];
  const dot = layer(document, "decor:live-dot").shapes.find((shape) => shape.ty === "el");
  dot.p.k = [244, 820];
  addCaption(document, "next_subtitle", "СМОТРИТЕ ДАЛЕЕ", 790, 120);
  return document;
}

function clockPreset() {
  const document = cloneSource("FluxIO Clock Countdown Test");
  const value = layer(document, "status");
  const plate = layer(document, "fit:status");
  value.nm = "clock";
  plate.nm = "fit:clock";
  const valueText = textDocument(value);
  valueText.t = "00:00:00";
  valueText.s = 64;
  valueText.tr = 30;
  setAnimatedPosition(value, [304, 858, 0], [274, 858, 0]);
  rectangle(plate).s.k = [560, 180];
  rectangle(plate).p.k = [450, 820];
  const dot = layer(document, "decor:live-dot").shapes.find((shape) => shape.ty === "el");
  dot.p.k = [220, 820];
  addCaption(document, "clock_caption", "ЕКАТЕРИНБУРГ", 790, 90);
  return document;
}

await Promise.all([
  writeFile(
    `${directory}/FluxIO_Next_Program_Test.json`,
    `${JSON.stringify(nextProgramPreset(), null, 2)}\n`,
  ),
  writeFile(
    `${directory}/FluxIO_Clock_Countdown_Test.json`,
    `${JSON.stringify(clockPreset(), null, 2)}\n`,
  ),
]);

console.log("Generated FluxIO Next program and Clock / countdown test presets.");

