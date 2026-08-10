import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Icon regeneration requires macOS sips and iconutil; generated assets are committed for all target platforms.");
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(desktopRoot, "build");
const png = path.join(buildDirectory, "icon.png");
const macPng = path.join(buildDirectory, "icon-mac.png");
const svg = path.join(buildDirectory, "icon.svg");
const macSvg = path.join(buildDirectory, "icon-mac.svg");
const iconset = path.join(buildDirectory, "FluxIO.iconset");

await rm(iconset, { force: true, recursive: true });
await mkdir(iconset, { recursive: true });
await rasterizeSvg(svg, png);
await rasterizeSvg(macSvg, macPng);
await removeWhiteQuickLookMatte(png);
await removeWhiteQuickLookMatte(macPng);

const sizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];

for (const [size, filename] of sizes) {
  run("sips", ["-z", String(size), String(size), macPng, "--out", path.join(iconset, filename)]);
}
const icnsEntries = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];
const icnsChunks = [];
for (const [type, filename] of icnsEntries) {
  const image = await readFile(path.join(iconset, filename));
  const chunk = Buffer.alloc(8 + image.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  image.copy(chunk, 8);
  icnsChunks.push(chunk);
}
const icnsSize = 8 + icnsChunks.reduce((sum, chunk) => sum + chunk.length, 0);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(icnsSize, 4);
await writeFile(
  path.join(buildDirectory, "icon.icns"),
  Buffer.concat([icnsHeader, ...icnsChunks], icnsSize),
);

await buildWindowsIco(png, path.join(buildDirectory, "icon.ico"));
await rm(iconset, { force: true, recursive: true });
console.log("Generated FluxIO PNG, ICNS and ICO assets from the committed SVG sources");

async function rasterizeSvg(source, destination) {
  const rasterDirectory = await mkdtemp(path.join(tmpdir(), "fluxio-icon-"));
  try {
    run("qlmanage", ["-t", "-s", "1024", "-o", rasterDirectory, source]);
    await copyFile(
      path.join(rasterDirectory, `${path.basename(source)}.png`),
      destination,
    );
  } finally {
    await rm(rasterDirectory, { force: true, recursive: true });
  }
}

async function removeWhiteQuickLookMatte(filePath) {
  const transparentPath = `${filePath}.transparent.png`;
  try {
    run(process.env.FFMPEG_PATH || "ffmpeg", [
      "-v", "error",
      "-y",
      "-i", filePath,
      "-vf", "colorkey=0xFFFFFF:0.18:0.02,format=rgba",
      transparentPath,
    ]);
    await copyFile(transparentPath, filePath);
  } finally {
    await rm(transparentPath, { force: true });
  }
}

async function buildWindowsIco(sourcePng, destination) {
  const icoDirectory = await mkdtemp(path.join(tmpdir(), "fluxio-ico-"));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  try {
    const images = [];
    for (const size of sizes) {
      const destinationPng = path.join(icoDirectory, `icon-${size}.png`);
      run("sips", ["-z", String(size), String(size), sourcePng, "--out", destinationPng]);
      images.push({ size, bytes: await readFile(destinationPng) });
    }
    const headerSize = 6 + images.length * 16;
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = headerSize;
    images.forEach(({ size, bytes }, index) => {
      const entry = 6 + index * 16;
      header.writeUInt8(size === 256 ? 0 : size, entry);
      header.writeUInt8(size === 256 ? 0 : size, entry + 1);
      header.writeUInt8(0, entry + 2);
      header.writeUInt8(0, entry + 3);
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(bytes.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += bytes.length;
    });
    await writeFile(destination, Buffer.concat([header, ...images.map(({ bytes }) => bytes)]));
  } finally {
    await rm(icoDirectory, { force: true, recursive: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} exited with ${result.status}`);
  }
}
