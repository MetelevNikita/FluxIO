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
const icoPng = path.join(buildDirectory, "icon-256.png");
const iconset = path.join(buildDirectory, "FluxIO.iconset");

await rm(iconset, { force: true, recursive: true });
await mkdir(iconset, { recursive: true });
await rasterizeSvg(svg, png);
await rasterizeSvg(macSvg, macPng);

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

run("sips", ["-z", "256", "256", png, "--out", icoPng]);
const pngBytes = await readFile(icoPng);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(0, 6);
icoHeader.writeUInt8(0, 7);
icoHeader.writeUInt8(0, 8);
icoHeader.writeUInt8(0, 9);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(pngBytes.length, 14);
icoHeader.writeUInt32LE(22, 18);
await writeFile(path.join(buildDirectory, "icon.ico"), Buffer.concat([icoHeader, pngBytes]));

await rm(icoPng, { force: true });
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

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} exited with ${result.status}`);
  }
}
