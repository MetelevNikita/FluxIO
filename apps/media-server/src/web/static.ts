import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Раздача интерфейса оператора.
 *
 * В профиле рабочего места интерфейс отдаёт Electron из своих ресурсов. На
 * сервере без монитора его открывают браузером, и отдавать файлы приходится
 * самой службе.
 *
 * Раздача написана руками, без плагина: комплект ставится без сети, и лишняя
 * зависимость означала бы ещё один пакет, который надо тащить и обновлять.
 * Цена — обход каталога, поэтому путь разбирается здесь и проверяется тестом.
 * ------------------------------------------------------------------------- */

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export function contentTypeFor(filePath: string): string {
  return contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

/**
 * Файл интерфейса по адресу запроса — или `null`, если адрес ведёт наружу.
 *
 * Наружу ведёт не только `..`: закодированный `%2e%2e`, обратный слэш на
 * Windows и абсолютный путь в адресе. Поэтому путь сначала раскодируется,
 * потом нормализуется, и только после этого сверяется с корнем — проверка «нет
 * ли двух точек в строке» ловит лишь первый из этих случаев.
 */
export function resolveWebAsset(rootDirectory: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    // Битая процентная последовательность — не адрес файла.
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(root, relative === "" ? "index.html" : relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/**
 * Заголовки кеширования.
 *
 * У сборки Vite имя файла ресурса содержит хеш содержимого, поэтому его можно
 * кешировать надолго. `index.html` — нельзя: он ссылается на эти имена, и
 * закешированный он оставил бы оператора на прошлой версии интерфейса после
 * обновления.
 */
export function cacheControlFor(filePath: string): string {
  const name = path.basename(filePath);
  if (name === "index.html") return "no-store";
  return /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";
}

/**
 * Адрес, который надо отдать как `index.html`.
 *
 * Интерфейс — одностраничное приложение: по прямой ссылке на внутренний экран
 * файла на диске нет, но отдавать 404 нельзя — оператор увидел бы пустую
 * страницу вместо приложения. Запросы к `/api` сюда не попадают, их разбирают
 * маршруты службы.
 */
export function isApplicationRoute(urlPath: string): boolean {
  const value = urlPath.split("?")[0] ?? "";
  if (value.startsWith("/api/")) return false;
  return !path.extname(value);
}
