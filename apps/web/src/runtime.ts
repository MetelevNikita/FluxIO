export function mediaPath(filename: string): string {
  return `${import.meta.env.BASE_URL}media/${filename}`;
}

export function mediaApiUrl(apiPath: string): string {
  const baseUrl = window.gruberDesktop?.mediaApiBaseUrl?.replace(/\/$/, "") ?? "";
  return `${baseUrl}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
}
