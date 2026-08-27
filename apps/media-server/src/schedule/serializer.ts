import {
  serializeScheduleRequestSchema,
  serializedScheduleSchema,
  type SerializeScheduleRequest,
  type SerializedSchedule,
} from "@gruber/contracts";

export function serializeSchedule(input: SerializeScheduleRequest): SerializedSchedule {
  const schedule = serializeScheduleRequestSchema.parse(input);
  const lines = [
    `start on ${schedule.startTime} - delay ${formatNumber(schedule.delaySeconds)}`,
  ];

  // Определения эфирных эффектов идут заголовком, до первого ролика: один титр
  // на двухстах роликах иначе означал бы двести копий своей сцены в файле.
  for (const effect of schedule.broadcastEffects) {
    lines.push(
      `defineBroadcastEffect {${effect.effectId}} ` +
        `name {${effect.name}} kind {${effect.kind}} data {${effect.data}}`,
    );
  }

  for (const item of schedule.items) {
    if (item.ageTitle?.enabled) {
      lines.push(
        `insertAgeTitle {${item.ageTitle.text}} duration {${item.ageTitle.durationSeconds}}`,
      );
    }
    if (item.logoPath) {
      lines.push(`insertLogoTitle {${item.logoPath}}`);
    }
    for (const element of item.graphicElements) {
      const namedTitles = element.titlePaths
        .map((value, index) => `titlePath#${index + 1} {${value}} `)
        .join("");
      // Пустой `titlePath {}` в файл не пишем: у эффектов с папкой титры живут в
      // нумерованных `titlePath#N`, а безымянная директива остаётся пустой
      // всегда и только засоряет расписание.
      const pairedTitle = element.titlePath ? `titlePath {${element.titlePath}} ` : "";
      lines.push(
        `insertGraphicElement_{${element.name}} ` +
          `backgroundPath {${element.backgroundPath ?? ""}} ` +
          pairedTitle +
          namedTitles +
          `duration {${formatScheduleTimecode(element.durationSeconds)}} ` +
          `startOn {${formatScheduleTimecode(element.startOnSeconds)}} ` +
          `endOn {${formatScheduleTimecode(element.endOnSeconds)}}`,
      );
    }
    // Показ эффекта — ссылка на определение плюс окно и значения полей.
    for (const show of item.broadcastShows) {
      lines.push(
        `insertBroadcastEffect {${show.effectId}} ` +
          `startOn {${formatScheduleTimecode(show.startOnSeconds)}} ` +
          `endOn {${formatScheduleTimecode(show.endOnSeconds)}}` +
          (show.fields ? ` fields {${show.fields}}` : ""),
      );
    }
    if (item.srtPath) {
      // Явное состояние: оператор мог отключить burn-in, оставив путь в расписании.
      lines.push(`insertSRT {${item.srtPath}} state {${item.srtEnabled === false ? "off" : "on"}}`);
    }
    lines.push(
      `${item.type} ${formatScheduleTimecode(item.declaredDurationSeconds)} ${item.filePath}`,
    );
    // Звуковые дорожки идут под роликом: графика сверху, звук снизу.
    for (const track of item.audioTracks ?? []) {
      lines.push(`insertAudioTrack_{${track.language}} {${track.filePath}}`);
    }
  }

  return serializedScheduleSchema.parse({
    extension: schedule.extension,
    content: `${lines.join("\r\n")}\r\n`,
  });
}

export function formatScheduleTimecode(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const wholeSeconds = totalSeconds % 60;
  return [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":") + `.${String(centiseconds).padStart(2, "0")}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
