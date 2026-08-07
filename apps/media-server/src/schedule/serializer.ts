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

  for (const item of schedule.items) {
    if (item.ageTitle?.enabled) {
      lines.push(
        `insertAgeTitle {${item.ageTitle.text}} duration {${item.ageTitle.durationSeconds}}`,
      );
    }
    if (item.logoPath) {
      lines.push(`insertLogoTitle {${item.logoPath}}`);
    }
    lines.push(
      `${item.type} ${formatScheduleTimecode(item.declaredDurationSeconds)} ${item.filePath}`,
    );
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
