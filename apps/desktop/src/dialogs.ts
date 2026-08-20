import { dialog } from "electron";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

//

export interface DirectoryImages {
  directoryPath: string;
  imagePaths: string[];
}

export interface DirectoryFiles {
  directoryPath: string;
  filePaths: string[];
}

const imageExtensions = new Set([".png", ".webp", ".jpg", ".jpeg"]);

//
// Выбор файлов и папок
//

export async function selectFiles(
  title: string,
  filters: Electron.FileFilter[],
): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    filters,
    properties: ["openFile", "multiSelections"],
    title,
  });

  return result.canceled ? [] : result.filePaths;
}

export async function selectFile(
  title: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    filters,
    properties: ["openFile"],
    title,
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export async function selectDirectory(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title,
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Папка графики одним уровнем; набор расширений зависит от LOGO или AGE. */
export async function selectImageDirectory(
  title: string,
  extensions: ReadonlySet<string> = imageExtensions,
): Promise<DirectoryImages | null> {
  const directoryPath = await selectDirectory(title);
  if (!directoryPath) return null;

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const imagePaths = entries
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return { directoryPath, imagePaths };
}

/** Папка с материалами: титры и SRT ищутся рекурсивно по расширению. */
export async function selectFileDirectory(
  title: string,
  extensions: Set<string>,
): Promise<DirectoryFiles | null> {
  const directoryPath = await selectDirectory(title);
  if (!directoryPath) return null;

  const filePaths = await collectFiles(directoryPath, extensions);

  return {
    directoryPath,
    filePaths: filePaths.sort((left, right) => left.localeCompare(right)),
  };
}

async function collectFiles(directory: string, extensions: Set<string>): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...await collectFiles(entryPath, extensions));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;

    found.push(entryPath);
  }

  return found;
}

//
// Чтение и запись текстовых файлов
//

export async function readTextFile(
  filePath: string,
  maxBytes: number,
  label: string,
): Promise<string> {
  const content = await readFile(filePath);

  if (content.byteLength === 0 || content.byteLength > maxBytes) {
    throw new Error(`${label} must be between 1 byte and ${formatBytes(maxBytes)}`);
  }

  return content.toString("utf8");
}

export async function saveTextFile(options: {
  content: string;
  defaultName: string;
  extension: string;
  filterName: string;
  keepAnyExtension?: boolean;
  title: string;
}): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultName,
    filters: [{ name: options.filterName, extensions: [options.extension] }],
    title: options.title,
  });

  if (result.canceled || !result.filePath) return null;

  const outputPath = withExtension(
    result.filePath,
    options.extension,
    options.keepAnyExtension ?? false,
  );
  await writeFile(outputPath, options.content, "utf8");

  return outputPath;
}

function withExtension(filePath: string, extension: string, keepAnyExtension: boolean): string {
  if (keepAnyExtension && path.extname(filePath)) return filePath;
  if (filePath.toLowerCase().endsWith(`.${extension}`)) return filePath;

  return `${filePath}.${extension}`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${bytes} bytes`;
}
