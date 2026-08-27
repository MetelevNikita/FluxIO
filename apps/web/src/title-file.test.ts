import assert from "node:assert/strict";
import test from "node:test";
import { sceneTemplateSchema, type SceneTemplate } from "@gruber/contracts";
import { addNode, createSceneNode, declareField, updateNode } from "./scene-edit.js";
import {
  TitleFileError,
  adoptTitleTemplate,
  packTitleFile,
  parseTitleFile,
  summarizeTitleFile,
  titleFileName,
} from "./title-file.js";

function template(): SceneTemplate {
  let scene = sceneTemplateSchema.parse({ id: "scene-1", name: "Нижняя треть", targets: ["hd"] });
  const title = { ...createSceneNode(scene, "text"), text: { kind: "static" as const, text: "Гость" } };
  scene = addNode(scene, title);
  const plate = createSceneNode(scene, "rect");
  scene = addNode(scene, plate);
  scene = updateNode(scene, plate.id, (node) => ({
    ...node, fitToText: { nodeId: title.id, padX: 0.02, padY: 0.01, axis: "x" as const, anchor: "grow" as const },
  }));
  return declareField(scene, title.id, "Имя гостя");
}

test("a packed title round-trips through text without losing the template", () => {
  const packed = packTitleFile(template(), "8.0.0", { author: "Оператор", description: "Плашка гостя" });
  const restored = parseTitleFile(JSON.stringify(packed));
  assert.equal(restored.template.name, "Нижняя треть");
  assert.equal(restored.template.nodes.length, 2);
  assert.equal(restored.template.fields[0]?.key, "imya_gostya");
  assert.equal(restored.author, "Оператор");
});

test("a file without the marker is refused by name, not by a parse crash", () => {
  // Оператор выбрал файл в диалоге: без объяснения он решит, что сломалось
  // приложение, а не что файл чужой.
  assert.throws(
    () => parseTitleFile(JSON.stringify({ hello: "world" })),
    (error: unknown) => error instanceof TitleFileError && /не файл титра/i.test(String(error)),
  );
});

test("a newer format version says so instead of half-parsing", () => {
  const packed = { ...packTitleFile(template(), "8.0.0"), formatVersion: 2 };
  assert.throws(
    () => parseTitleFile(JSON.stringify(packed)),
    (error: unknown) => error instanceof TitleFileError && /версии 2/.test(String(error)),
  );
});

test("broken JSON is refused as such", () => {
  assert.throws(() => parseTitleFile("{ не json"), TitleFileError);
});

test("a damaged template names the field that broke", () => {
  const packed = packTitleFile(template(), "8.0.0") as unknown as Record<string, unknown>;
  (packed.template as { nodes: unknown[] }).nodes = [{ id: "" }];
  assert.throws(
    () => parseTitleFile(JSON.stringify(packed)),
    (error: unknown) => error instanceof TitleFileError && /повреждён/.test(String(error)),
  );
});

test("the summary carries what the picker shows without opening the file", () => {
  const packed = packTitleFile(template(), "8.0.0", { description: "Плашка гостя" });
  const summary = summarizeTitleFile("/titles/guest.fto", packed);
  assert.equal(summary.name, "Нижняя треть");
  assert.equal(summary.nodeCount, 2);
  assert.deepEqual(summary.targets, ["hd"]);
  assert.deepEqual(summary.fieldKeys, ["imya_gostya"]);
});

test("the file name keeps Cyrillic and drops only what the filesystem rejects", () => {
  // Оператор ищет файл глазами в проводнике: `plashka_1` ему ничего не скажет.
  assert.equal(titleFileName("Нижняя треть"), "Нижняя треть.fto");
  assert.equal(titleFileName('Плашка: "гость"/эфир'), "Плашка гость эфир.fto");
  assert.equal(titleFileName("   "), "Титр.fto");
});

test("an adopted template gets fresh ids and keeps its internal bindings", () => {
  // Два эффекта с одним id — это потерянная привязка плашки к тексту, и
  // заметно это только в эфире.
  const source = template();
  let counter = 0;
  const adopted = adoptTitleTemplate(source, () => String(++counter));

  assert.notEqual(adopted.id, source.id);
  for (const node of adopted.nodes) {
    assert.ok(!source.nodes.some((original) => original.id === node.id), "id узла не поменялся");
  }
  const plate = adopted.nodes.find((node) => node.fitToText);
  const titleNode = adopted.nodes.find((node) => node.kind === "text");
  assert.equal(plate?.fitToText?.nodeId, titleNode?.id, "привязка не переехала на новый id");
});
