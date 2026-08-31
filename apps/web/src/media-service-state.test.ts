import assert from "node:assert/strict";
import test from "node:test";
import {
  failedConnection,
  mediaServerAddress,
  preferredUdpLocalAddress,
  readyConnection,
} from "./use-media-service.js";

test("health payload becomes a validated ready connection", () => {
  const connection = readyConnection({
    apiVersion: "v1",
    service: "gruber-media-server",
    startedAt: "2026-08-28T08:00:00.000Z",
    status: "ready",
    version: "8.0.1",
  });

  assert.equal(connection.kind, "ready");
  if (connection.kind === "ready") assert.equal(connection.health.version, "8.0.1");
});

test("connection errors preserve useful Error messages", () => {
  assert.deepEqual(failedConnection(new Error("connection refused")), {
    kind: "error",
    message: "connection refused",
  });
  assert.deepEqual(failedConnection("offline"), {
    kind: "error",
    message: "Unknown error",
  });
});

test("UDP defaults to the first external IPv4 interface", () => {
  const address = preferredUdpLocalAddress([
    {
      address: "::1",
      cidr: "::1/128",
      family: "IPv6",
      internal: true,
      mac: "00:00:00:00:00:00",
      name: "lo0",
      netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    },
    {
      address: "192.0.2.20",
      cidr: "192.0.2.20/24",
      family: "IPv4",
      internal: false,
      mac: "00:11:22:33:44:55",
      name: "en0",
      netmask: "255.255.255.0",
    },
  ]);

  assert.equal(address, "192.0.2.20");
});

test("status bar address handles browser, valid and partially configured URLs", () => {
  assert.equal(mediaServerAddress(undefined, "localhost:5173"), "localhost:5173");
  assert.equal(mediaServerAddress("http://127.0.0.1:4310", ""), "127.0.0.1:4310");
  assert.equal(mediaServerAddress("media-service.local:4310/", ""), "media-service.local:4310");
});
