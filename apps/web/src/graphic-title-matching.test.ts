import assert from "node:assert/strict";
import test from "node:test";
import { matchingNamedAssetPath } from "./graphic-title-matching.js";

test("per-clip graphic title uses an exact case-insensitive basename match", () => {
  const paths = [
    "C:\\FluxIO\\titles\\Programme 01 [16+].png",
    "C:\\FluxIO\\titles\\Programme 010 [16+].mov",
  ];
  assert.equal(
    matchingNamedAssetPath("Programme 01 [16+].mp4", paths),
    paths[0],
  );
  assert.equal(
    matchingNamedAssetPath("programme 01 [16+].MXF", paths),
    paths[0],
  );
  assert.equal(matchingNamedAssetPath("Programme 01.mp4", paths), null);
});
