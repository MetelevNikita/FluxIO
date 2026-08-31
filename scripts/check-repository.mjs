import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const rootPackage = readJson("package.json");
const lockfile = readJson("package-lock.json");
const errors = [];

if (lockfile.version !== rootPackage.version) {
  errors.push(`package-lock.json: ${lockfile.version} != ${rootPackage.version}`);
}

for (const pattern of rootPackage.workspaces) {
  const directory = pattern.replace(/\/\*$/, "");
  for (const name of readdirSync(path.join(root, directory))) {
    const packageFile = path.join(directory, name, "package.json");
    if (!existsSync(path.join(root, packageFile))) continue;
    const version = readJson(packageFile).version;
    if (version !== rootPackage.version) {
      errors.push(`${packageFile}: ${version} != ${rootPackage.version}`);
    }
    if (lockfile.packages?.[path.dirname(packageFile)]?.version !== version) {
      errors.push(`package-lock.json: stale version for ${path.dirname(packageFile)}`);
    }
  }
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(file);
    return entry.name.endsWith(".md") ? [file] : [];
  });
}

const markdown = ["README.md", "AGENTS.md", "CLAUDE.md"]
  .map((file) => path.join(root, file))
  .concat(markdownFiles(path.join(root, "docs")));

for (const file of markdown) {
  const body = readFileSync(file, "utf8");
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split("#")[0];
    if (target && !existsSync(path.resolve(path.dirname(file), target))) {
      errors.push(`${path.relative(root, file)}: missing ${match[1]}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Repository metadata and ${markdown.length} Markdown files are valid.`);
}
