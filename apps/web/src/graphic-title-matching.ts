export function matchingNamedAssetPath(
  mediaName: string,
  candidatePaths: string[],
): string | null {
  const mediaStem = fileStem(mediaName).toLocaleLowerCase();
  return candidatePaths.find((filePath) =>
    fileStem(filePath).toLocaleLowerCase() === mediaStem) ?? null;
}

export function fileStem(value: string): string {
  const fileName = value.replaceAll("\\", "/").split("/").at(-1) ?? value;
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
