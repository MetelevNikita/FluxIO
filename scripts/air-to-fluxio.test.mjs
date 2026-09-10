import assert from "node:assert/strict";
import test from "node:test";
import { airSeconds, airTimecode, convertAirSchedule } from "./air-to-fluxio.mjs";

test("разрезанная передача собирается обратно в один ролик", () => {
  // AirSheet режет передачу на две строки ради титра на хвосте. Строка FluxIO
  // точки входа не несёт, и перенесённый как есть хвост пошёл бы в эфир с
  // первого кадра файла — зритель увидел бы начало серии вместо финала.
  const { items, report } = convertAirSchedule([
    "wait time 09:50:00.00 [5] active",
    "titleObjOn {Возраст_16} 0",
    "comment 0 #$ До конца осталось:",
    "movie <00:00:00.00> 00:18:35.00 \\\\utv2\\аниме\\152 серия.mp4",
    "titleObjOn {Боевой_континент_далее} 0",
    "movie <00:18:35.00> 00:02:00.00 \\\\utv2\\аниме\\152 серия.mp4",
  ].join("\r\n"));

  assert.equal(items.length, 1);
  assert.equal(items[0].durationSeconds, 20 * 60 + 35);
  assert.equal(items[0].ageTitle, "16+");
  assert.equal(report.joined, 1);
  // Титр «смотрите далее» в FluxIO ставит эффект второго уровня, а не строка
  // расписания: перенесённый построчно, он мешал бы эффекту работать.
  assert.equal(report.nextTitles, 1);
});

test("хвост, не сошедшийся встык, остаётся отдельным роликом и попадает в отчёт", () => {
  // Склеить его молча значит вернуть в эфир вырезанные минуты.
  const { items, report } = convertAirSchedule([
    "wait time 06:00:00.00 [5] active",
    "movie <00:00:00.00> 00:10:00.00 \\\\utv2\\фильм.mp4",
    "movie <00:12:00.00> 00:05:00.00 \\\\utv2\\фильм.mp4",
  ].join("\r\n"));

  assert.equal(items.length, 2);
  assert.equal(report.joined, 0);
  assert.equal(report.unjoined.length, 1);
  assert.equal(report.unjoined[0].expected, 600);
  assert.equal(report.unjoined[0].found, 720);
});

test("тип строки берётся из длительности, а не из слова в исходнике", () => {
  const { content } = convertAirSchedule([
    "wait time 06:00:00.00 [5] active",
    "movie 00:00:59.00 \\\\utv2\\отбивка.mp4",
    "movie 00:01:00.00 \\\\utv2\\анонс.mp4",
    "movie 00:02:59.00 \\\\utv2\\трейлер.mp4",
    "movie 00:03:00.00 \\\\utv2\\передача.mp4",
  ].join("\r\n"));

  const rows = content.split("\r\n").filter((line) => /^(chop|clip|movie) /.test(line));
  assert.deepEqual(rows.map((line) => line.split(" ")[0]), ["chop", "clip", "clip", "movie"]);
});

test("время старта берётся из первой метки ожидания, а не из последней", () => {
  // Вторая метка стоит в конце файла и означает переход на следующее
  // расписание — у FluxIO это Future, а не время выхода в эфир.
  const { content } = convertAirSchedule([
    "wait operator 0 * * * * *",
    "wait time 09:50:00.00 [5] active",
    "movie 00:00:10.00 \\\\utv2\\заставка.mp4",
    "wait time 06:00:00.00 [5]",
    "switch shedule",
  ].join("\r\n"));

  assert.match(content, /^start on 09:50:00\.00 - delay 0/);
  assert.doesNotMatch(content, /switch|wait/);
});

test("тайм-код переживает круговой рейс без потери сотых", () => {
  for (const value of ["00:00:05.00", "00:18:35.50", "01:30:00.99"]) {
    assert.equal(airTimecode(airSeconds(value)), value);
  }
});
