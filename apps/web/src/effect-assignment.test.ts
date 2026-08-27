import assert from "node:assert/strict";
import test from "node:test";
import { broadcastEffectDefinitionSchema, type GraphicEffectAsset } from "@gruber/contracts";
import { removeEffectFromLibrary } from "./effect-assignment.js";

test("removing an effect keeps the operator's order of the rest", () => {
  const library = [effect("fx2-a"), effect("fx2-b"), effect("fx2-c")];
  // Порядок в библиотеке задаёт порядок наложения слоёв — перетасовать его
  // удаление не имеет права.
  assert.deepEqual(
    removeEffectFromLibrary(library, "fx2-b").map((entry) => entry.id),
    ["fx2-a", "fx2-c"],
  );
});

test("removing an effect nobody asked about changes nothing", () => {
  const library = [effect("fx2-a")];
  assert.deepEqual(removeEffectFromLibrary(library, "fx2-missing"), library);
});

function effect(id: string): GraphicEffectAsset {
  return {
    durationSeconds: 0,
    filePath: "broadcast://dynamic-title",
    height: 0,
    id,
    kind: "video",
    name: id,
    titleDirectoryPath: null,
    titlePaths: [],
    width: 0,
    // Оформление принадлежит эффекту: отдельной графики, которую надо было бы
    // подчищать следом, больше не существует.
    broadcast: broadcastEffectDefinitionSchema.parse({ kind: "dynamic-title" }),
  };
}
