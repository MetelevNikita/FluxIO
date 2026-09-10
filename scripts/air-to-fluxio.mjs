#!/usr/bin/env node
/* -------------------------------------------------------------------------- *
 * Перенос расписания AirSheet (`.air`) в разметку FluxIO (`.txt`).
 *
 * Файлы AirSheet приходят в windows-1251 и несут вперемешку то, что FluxIO
 * выражает разметкой (ролики, возрастная маркировка), и то, что у него живёт
 * в другом слое или не живёт вовсе (метки ожидания оператора, служебные
 * комментарии, титры «смотрите далее»).
 *
 * Две вещи здесь важнее остального.
 *
 * 1. **Разрезанный ролик собирается обратно.** AirSheet режет передачу на две
 *    строки — `<0> 18:35` и `<18:35> 2:00`, — чтобы повесить титр на хвост.
 *    Строка расписания FluxIO точки входа не несёт: перенеси такую пару как
 *    есть, и вторая часть пойдёт в эфир с начала файла — зритель увидит начало
 *    серии вместо финала. Части одного файла, сходящиеся встык, склеиваются в
 *    один ролик; разошедшиеся не склеиваются и попадают в отчёт.
 *
 * 2. **Титр «смотрите далее» не переносится, и это не потеря.** В AirSheet его
 *    ставили руками перед каждым хвостом, в FluxIO это эффект второго уровня:
 *    он сам знает, что идёт следующим, и сам ставит показ в конце ролика.
 *    Перенесённые построчно, эти титры мешали бы ему работать.
 *
 * Использование:
 *   node scripts/air-to-fluxio.mjs <файл.air> [файл.txt]
 * ------------------------------------------------------------------------- */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Тайм-код AirSheet `HH:MM:SS.ff` в секунды. */
export function airSeconds(value) {
  const match = value.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Некорректный тайм-код: ${value}`);
  const [, hours, minutes, seconds, centiseconds = "0"] = match;
  return Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds) +
    Number(centiseconds.padEnd(2, "0")) / 100;
}

/** Секунды в тайм-код расписания. Тот же формат, что у сериализатора FluxIO. */
export function airTimecode(seconds) {
  const total = Math.max(0, Math.round(seconds * 100));
  const parts = [Math.floor(total / 360_000), Math.floor(total / 6_000) % 60, Math.floor(total / 100) % 60];
  return `${parts.map((value) => String(value).padStart(2, "0")).join(":")}.${String(total % 100).padStart(2, "0")}`;
}

/**
 * Разбор `.air` в строки расписания.
 *
 * Возвращает и сам результат, и отчёт: перенос недельного расписания вслепую
 * проверить нечем, а «пропало сорок роликов» замечают уже в эфире.
 */
export function convertAirSchedule(text, { chopSeconds = 60, clipSeconds = 180 } = {}) {
  const items = [];
  const report = {
    startTime: null,
    sourceRows: 0,
    joined: 0,
    unjoined: [],
    ageTitles: 0,
    nextTitles: 0,
    comments: 0,
    days: [],
    skipped: new Map(),
  };
  let pendingAge = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const start = line.match(/^wait\s+time\s+([\d:.]+)/i);
    if (start) {
      // Первая метка времени — время выхода расписания в эфир. Вторая стоит в
      // конце файла и означает переход на следующее, у FluxIO это Future.
      report.startTime ??= start[1];
      continue;
    }

    const age = line.match(/^titleObjOn\s*\{\s*Возраст[_\s]*(\d+)\s*\}/i);
    if (age) {
      pendingAge = `${age[1]}+`;
      report.ageTitles += 1;
      continue;
    }

    if (/^titleObjOn/i.test(line)) {
      report.nextTitles += 1;
      continue;
    }

    const comment = line.match(/^comment\s+\d+\s+(.*)$/i);
    if (comment) {
      report.comments += 1;
      // Дни недели — единственное, что оператор писал для себя; они остаются
      // комментарием и в FluxIO.
      const day = comment[1].trim();
      if (day && !day.startsWith("#$")) report.days.push({ day, index: items.length });
      continue;
    }

    const media = line.match(/^(movie|clip|chop)\s+(?:<([\d:.]+)>\s+)?([\d:.]+)\s+(.+)$/i);
    if (media) {
      report.sourceRows += 1;
      const [, , inPoint, duration, filePath] = media;
      const item = {
        inSeconds: inPoint ? airSeconds(inPoint) : 0,
        durationSeconds: airSeconds(duration),
        filePath: filePath.trim(),
        ageTitle: pendingAge,
      };
      pendingAge = null;

      // Хвост той же передачи прирастает к её началу — иначе он пойдёт в эфир
      // с первого кадра файла.
      const previous = items.at(-1);
      if (item.inSeconds > 0 && previous?.filePath === item.filePath) {
        const previousEnd = previous.inSeconds + previous.durationSeconds;
        if (Math.abs(previousEnd - item.inSeconds) < 0.005) {
          previous.durationSeconds += item.durationSeconds;
          previous.ageTitle ??= item.ageTitle;
          report.joined += 1;
          continue;
        }
        report.unjoined.push({ filePath: item.filePath, expected: previousEnd, found: item.inSeconds });
      }
      items.push(item);
      continue;
    }

    const directive = line.split(/\s+/)[0];
    report.skipped.set(directive, (report.skipped.get(directive) ?? 0) + 1);
  }

  const lines = [`start on ${report.startTime ?? "00:00:00.00"} - delay 0`];
  const dayAt = new Map(report.days.map((entry) => [entry.index, entry.day]));
  items.forEach((item, index) => {
    const day = dayAt.get(index);
    if (day) lines.push(`# ${day}`);
    if (item.ageTitle) lines.push(`insertAgeTitle {${item.ageTitle}} duration {10}`);
    const type = item.durationSeconds < chopSeconds
      ? "chop"
      : item.durationSeconds < clipSeconds ? "clip" : "movie";
    lines.push(`${type} ${airTimecode(item.durationSeconds)} ${item.filePath}`);
  });

  return { content: `${lines.join("\r\n")}\r\n`, items, report };
}

async function main() {
  const [source, target] = process.argv.slice(2);
  if (!source) throw new Error("Использование: node scripts/air-to-fluxio.mjs <файл.air> [файл.txt]");
  // AirSheet пишет в windows-1251: прочитанный как UTF-8, файл превращается в
  // путь из вопросительных знаков, и заметно это только при попытке открыть его.
  const raw = await readFile(source);
  const text = new TextDecoder("windows-1251").decode(raw);
  const { content, items, report } = convertAirSchedule(text);
  const output = target ?? `${source.replace(/\.air$/i, "")}.txt`;
  await writeFile(output, content, "utf8");

  const total = items.reduce((sum, item) => sum + item.durationSeconds, 0);
  const byType = items.reduce((counts, item) => {
    const type = item.durationSeconds < 60 ? "chop" : item.durationSeconds < 180 ? "clip" : "movie";
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`Готово: ${output}`);
  console.log(`Старт расписания: ${report.startTime}`);
  console.log(`Строк в исходнике: ${report.sourceRows} → роликов: ${items.length} (склеено хвостов: ${report.joined})`);
  console.log(`  chop <1 мин: ${byType.chop ?? 0} · clip <3 мин: ${byType.clip ?? 0} · movie: ${byType.movie ?? 0}`);
  console.log(`Возрастных маркировок: ${report.ageTitles}`);
  console.log(`Общий хронометраж: ${airTimecode(total)} из 168:00:00.00`);
  console.log(`Не перенесено: титров «далее» ${report.nextTitles}, комментариев ${report.comments}` +
    `${[...report.skipped].map(([name, count]) => `, ${name} ${count}`).join("")}`);
  if (report.unjoined.length > 0) {
    console.log(`Внимание: ${report.unjoined.length} хвостов не сошлись встык и остались отдельными роликами:`);
    for (const entry of report.unjoined.slice(0, 5)) {
      console.log(`  ${path.basename(entry.filePath)}: ожидалось ${airTimecode(entry.expected)}, в файле ${airTimecode(entry.found)}`);
    }
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Ошибка переноса: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
