import assert from "node:assert/strict";
import test from "node:test";
import {
  launcherPaths,
  mediaServerIsActive,
  normalizeMediaApiUrl,
  terminateProcessTree,
} from "./launch.mjs";

test("desktop launcher resolves relocatable production entries", () => {
  const paths = launcherPaths("/srv/FluxIO Project");
  assert.equal(
    paths.mediaEntry,
    "/srv/FluxIO Project/apps/media-server/dist/index.js",
  );
  assert.equal(
    paths.electronCli,
    "/srv/FluxIO Project/node_modules/electron/cli.js",
  );
});

test("desktop launcher validates and probes the configured media API", async () => {
  assert.equal(
    normalizeMediaApiUrl("http://127.0.0.1:4310/"),
    "http://127.0.0.1:4310",
  );
  assert.throws(() => normalizeMediaApiUrl("ftp://127.0.0.1"), /Unsupported/);
  let requestedUrl = "";
  assert.equal(
    await mediaServerIsActive("http://192.0.2.10:4310", async (url) => {
      requestedUrl = url.toString();
      return { ok: true };
    }),
    true,
  );
  assert.equal(requestedUrl, "http://192.0.2.10:4310/api/health");
});

test("Windows launcher terminates the complete child process tree", async () => {
  const child = { pid: 4321, exitCode: null, signalCode: null };
  const calls = [];
  await terminateProcessTree(child, "win32", (command, args) => {
    calls.push([command, args]);
    child.exitCode = 0;
  });
  assert.deepEqual(calls, [[
    "taskkill.exe",
    ["/PID", "4321", "/T", "/F"],
  ]]);
});
