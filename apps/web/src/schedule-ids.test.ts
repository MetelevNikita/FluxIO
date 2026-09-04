import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumSceneShowIdLength, sceneShowId, shortHash, withValidSceneShowIds,
} from "./schedule-ids.js";

test("a scene show id never outgrows the contract", () => {
  // Расписание склеивает опознаватель показа из номера строки и опознавателя
  // эффекта, а тот сам по себе `fx2-<вид>-<uuid>`: вместе выходило 75 знаков
  // при потолке 64, и снимок сессии отвергался целиком.
  const effectId = "fx2-stinger-transition-2b0f5a1c-4a4e-4f0f-9a2b-7f1c6d3e5a09";
  const id = sceneShowId("schedule-scene", "12", effectId);
  assert.ok(id.length <= maximumSceneShowIdLength, `${id.length} > ${maximumSceneShowIdLength}`);

  // Короткая склейка остаётся читаемой: обрезать её незачем.
  assert.equal(sceneShowId("scene", "a1b2"), "scene-a1b2");
});

test("different shows keep different ids after shortening", () => {
  const effectId = "fx2-stinger-transition-2b0f5a1c-4a4e-4f0f-9a2b-7f1c6d3e5a09";
  const first = sceneShowId("schedule-scene", "1", effectId);
  const second = sceneShowId("schedule-scene", "2", effectId);
  assert.notEqual(first, second);
  assert.notEqual(shortHash("a"), shortHash("b"));
});

test("an asset saved by an older version is repaired, not rejected", () => {
  const long = `schedule-scene-3-fx2-dynamic-title-${"a".repeat(40)}`;
  const asset = {
    id: "row-1",
    scenes: [{ id: long }, { id: "scene-short" }],
  };
  const repaired = withValidSceneShowIds(asset);
  assert.ok((repaired.scenes[0]?.id.length ?? 0) <= maximumSceneShowIdLength);
  // Короткий опознаватель не трогаем: он уже годится, и менять его значит
  // терять связь показа с тем, что на него ссылается.
  assert.equal(repaired.scenes[1]?.id, "scene-short");
  // Ассет без показов возвращается тем же объектом — лишних перерисовок нет.
  const untouched = { id: "row-2", scenes: undefined };
  assert.equal(withValidSceneShowIds(untouched), untouched);
});
