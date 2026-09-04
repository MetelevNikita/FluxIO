import assert from "node:assert/strict";
import test from "node:test";
import { airDurationSeconds, playableClips } from "./clip-duration.js";

test("air duration is the shorter of the file and the schedule", () => {
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 90, durationSeconds: 120 }), 90);
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 150, durationSeconds: 120 }), 120);
});

test("a clip whose file is not analysed yet keeps its scheduled duration", () => {
  // Ноль означает «файл ещё не разобран», а не «ролик нулевой длины». Раньше
  // Math.min давал ноль, и всё, что отсчитывается от конца ролика, уезжало
  // в самое начало.
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 3_600, durationSeconds: 0 }), 3_600);
});

test("without a schedule the analysed file wins, and an empty clip stays zero", () => {
  assert.equal(airDurationSeconds({ declaredDurationSeconds: null, durationSeconds: 42 }), 42);
  assert.equal(airDurationSeconds({ durationSeconds: 42 }), 42);
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 0, durationSeconds: 0 }), 0);
});

test("a clip whose file is missing holds no air time", () => {
  // Строка расписания остаётся — сетку собирал оператор, — но минут за собой
  // не держит: в эфире этого ролика не будет, и всё, что стоит ниже, выйдет
  // раньше. Иначе недобор недели прячется за длительностью, которой нет.
  assert.equal(
    airDurationSeconds({ durationSeconds: 150, declaredDurationSeconds: 150, status: "error" }),
    0,
  );
  assert.equal(
    airDurationSeconds({ durationSeconds: 0, declaredDurationSeconds: 150, status: "error" }),
    0,
  );
  // Разобранный ролик считается как раньше — статус на него не влияет.
  assert.equal(
    airDurationSeconds({ durationSeconds: 150, declaredDurationSeconds: 120, status: "analyzed" }),
    120,
  );
});

test("playout skips the rows whose file is missing, without dropping them from the grid", () => {
  const playlist = [
    { id: "one", status: "analyzed" },
    { id: "gone", status: "error" },
    { id: "two", status: "pending" },
  ];
  // В эфир уходит всё, кроме нечитаемого: FFmpeg упал бы на нём и увёл бы
  // линию, а строка расписания при этом остаётся у оператора на месте.
  assert.deepEqual(playableClips(playlist).map((asset) => asset.id), ["one", "two"]);
  assert.equal(playlist.length, 3);
  // Расписание без единого читаемого ролика — законный пустой список: линия
  // поднимется на цветных полосах, и файлы можно подставить под живым эфиром.
  assert.deepEqual(playableClips([{ id: "gone", status: "error" }]), []);
});
