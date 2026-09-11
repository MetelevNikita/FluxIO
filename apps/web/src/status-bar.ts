import type { PlayoutStatus } from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Что строка состояния внизу говорит об эфире.
 *
 * После остановки служба отдаёт `idle`, но оставляет в статусе поля последней
 * сессии — имя ролика, прогресс, скорость. Строка брала их как есть и рисовала
 * остановленную станцию с «×1.00 скорость» и отсчётом «осталось», ровно как
 * идущий эфир. Оператору, который смотрит на неё мельком, это говорило, что
 * эфир есть, когда его нет. Поэтому всё, что описывает ход эфира, берётся
 * только у идущего эфира, и решает это состояние, а не наличие имени ролика.
 * ------------------------------------------------------------------------- */

export interface StatusBarView {
  /** Эфир идёт: запуск, работа или остановка. */
  onAir: boolean;
  /** Ролик в эфире; у стоящего эфира — `null`, даже если служба помнит последний. */
  clipName: string | null;
  /** Последний ролик остановленной сессии — только для подсказки. */
  lastClipName: string | null;
  progressPercent: number;
  /** Сколько осталось; у стоящего эфира отсчёта нет. */
  remainingSeconds: number | null;
  /** Скорость выдачи; у стоящего эфира её нет. */
  speed: number | null;
}

export function statusBarView(status: PlayoutStatus | null): StatusBarView {
  if (!status || !["starting", "running", "stopping"].includes(status.state)) {
    return {
      onAir: false,
      clipName: null,
      lastClipName: status?.currentItemName ?? null,
      progressPercent: 0,
      remainingSeconds: null,
      speed: null,
    };
  }
  return {
    onAir: true,
    clipName: status.currentItemName,
    lastClipName: null,
    progressPercent: status.progressPercent,
    remainingSeconds: Math.max(
      0,
      (status.totalDurationSeconds - status.outTimeSeconds) / Math.max(status.speed, 1),
    ),
    speed: status.speed,
  };
}
