import assert from "node:assert/strict";
import test from "node:test";
import { mediaRequestTimeoutMs } from "./media-request-timeout.js";
import {
  deleteWorkspaceSession, getNetworkInterfaces, stopClipPreview,
  updateCurrentPlayoutPlaylist, verifyGraphicEffectPaths,
} from "./media-api.js";

test("weekly playout preparation does not inherit the ten-second API timeout", () => {
  assert.equal(mediaRequestTimeoutMs("/api/playout/start"), 30 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/playout/take"), 30 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/media/probe"), 10 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/playout/status"), 10_000);
});

test("API requests preserve JSON, bodyless methods, validation and server errors", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { gruberDesktop: { mediaApiBaseUrl: "http://localhost:4310/" } },
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let response = Response.json({ items: [] });
  let options: RequestInit = {};
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    options = init ?? {};
    assert.ok(options.signal instanceof AbortSignal);
    return response;
  });

  assert.deepEqual(await getNetworkInterfaces(), []);
  assert.equal(fetchMock.mock.calls[0]!.arguments[0], "http://localhost:4310/api/system/network-interfaces");
  assert.equal(options.method, "GET");
  assert.equal(options.body, undefined);
  assert.equal(options.headers, undefined);

  const paths = ["/титры/плашка.mov"];
  response = Response.json({ missing: paths });
  assert.deepEqual(await verifyGraphicEffectPaths(paths), paths);
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(String(options.body)), { paths });
  assert.equal(new Headers(options.headers).get("content-type"), "application/json");

  response = Response.json({ stopped: true });
  await stopClipPreview();
  assert.equal(options.method, "POST");
  assert.equal(options.body, undefined);
  assert.equal(options.headers, undefined);

  response = Response.json({ invalid: true });
  await assert.rejects(updateCurrentPlayoutPlaylist([]), { name: "ZodError" });
  assert.equal(options.method, "PUT");
  assert.deepEqual(JSON.parse(String(options.body)), { playlist: [] });

  response = new Response(null, { status: 204 });
  await deleteWorkspaceSession();
  assert.equal(options.method, "DELETE");
  assert.equal(options.body, undefined);

  response = Response.json({ error: "Database is unavailable" }, { status: 503 });
  await assert.rejects(deleteWorkspaceSession(), /Database is unavailable/);
  response = new Response("Unavailable", { status: 502 });
  await assert.rejects(deleteWorkspaceSession(), /Media service returned 502/);
});
