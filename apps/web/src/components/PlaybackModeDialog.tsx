import { useState, type ReactNode } from "react";
import { CalendarClock, Infinity as InfinityIcon, Timer, X } from "lucide-react";
import type { PlaybackMode } from "@gruber/contracts";
import { airDurationSeconds } from "../clip-duration";
import { useI18n } from "../i18n";
import {
  applyPlaybackDraft,
  formatAirMoment,
  formatClockDuration,
  playbackDraftFrom,
  playbackStart,
  playbackWindow,
  type PlaybackDraft,
  type PlaybackStart,
} from "../playback-mode";
import type { MediaAsset, ScheduleMetadata, ScheduleSlot } from "../types";

/* -------------------------------------------------------------------------- *
 * «Тип воспроизведения».
 *
 * Открывается, когда оператор с загруженными роликами переходит к плейлисту, и
 * по щелчку на строке режима в окне расписания. Выбор нельзя оставить на потом
 * молча: от него зависит, можно ли стартовать с выбранного ролика, и узнавать об
 * этом на нажатии Start — поздно.
 * ------------------------------------------------------------------------- */

type Translate = (russian: string, english: string) => string;

export function PlaybackModeDialog({
  metadata, playlist, slot, onApply, onClose,
}: {
  metadata: ScheduleMetadata | null;
  playlist: MediaAsset[];
  slot: ScheduleSlot;
  onApply: (draft: PlaybackDraft) => void;
  onClose: () => void;
}) {
  const { language, tr } = useI18n();
  const [draft, setDraft] = useState(() => playbackDraftFrom(metadata, playlist));
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isClock = (value: string) => /^\d{2}:\d{2}(?::\d{2})?$/.test(value);
  const complete = isDate(draft.startDate) && isClock(draft.startTime) &&
    (draft.mode !== "planned" || (isDate(draft.endDate) && isClock(draft.endTime)));

  // Окно считается на каждой отрисовке: диалог перерисовывается вместе с
  // опросом статуса, и строка «сейчас по часам» идёт вместе с часами.
  const applied = draft.mode !== "free" && complete ? applyPlaybackDraft(metadata, draft) : null;
  const bounds = applied ? playbackWindow(applied, slot) : null;
  const gate = applied ? playbackStart(playlist, applied, slot) : null;
  const fillSeconds = applied?.targetDurationSeconds ?? 0;
  const listSeconds = playlist.reduce((sum, asset) => sum + airDurationSeconds(asset), 0);
  const valid = draft.mode === "free" || (applied !== null && fillSeconds > 0);

  const options: { mode: PlaybackMode; icon: ReactNode; title: string; hint: string }[] = [
    {
      mode: "free",
      icon: <InfinityIcon size={16} />,
      title: tr("Произвольное", "Free"),
      hint: tr("Старт с любого ролика, плейлист идёт по кругу", "Start from any clip; the playlist loops"),
    },
    {
      mode: "planned",
      icon: <Timer size={16} />,
      title: tr("Планируемое", "Planned"),
      hint: tr(
        "Начало и конец задаёте вы — это время эфир обязан заполнить; старт с любого ролика",
        "You set the start and end — the time air must fill; start from any clip",
      ),
    },
    {
      mode: "weekly",
      icon: <CalendarClock size={16} />,
      title: tr("Недельное", "Weekly"),
      hint: tr(
        "Неделя от дня и времени старта; старт только по часам — с того места, что идёт сейчас по сетке",
        "A week from the start day and time; starts on the clock only — from wherever the grid is now",
      ),
    },
  ];

  return (
    <div className="playback-mode-backdrop">
      <div aria-label={tr("Тип воспроизведения", "Playback type")} className="playback-mode" role="dialog">
        <header>
          <CalendarClock size={15} />
          <div>
            <strong>{tr("Тип воспроизведения", "Playback type")}</strong>
            <small>
              {tr(
                `Как пойдёт в эфир ${slot === "current" ? "Current" : "Future"}. Сменить можно в любой момент — щелчком по строке режима в окне расписания.`,
                `How ${slot === "current" ? "Current" : "Future"} goes to air. Change it any time from the mode line in the schedule window.`,
              )}
            </small>
          </div>
          <button aria-label={tr("Закрыть", "Close")} onClick={onClose} type="button"><X size={14} /></button>
        </header>

        <div className="playback-mode-body">
          <div className="playback-mode-options" role="radiogroup">
            {options.map((option) => (
              <label
                className={`playback-mode-option ${draft.mode === option.mode ? "selected" : ""}`}
                key={option.mode}
              >
                <input
                  checked={draft.mode === option.mode}
                  name="playback-mode"
                  onChange={() => setDraft({ ...draft, mode: option.mode })}
                  type="radio"
                />
                <span className="playback-mode-icon">{option.icon}</span>
                <span>
                  <b>{option.title}</b>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </div>

          {draft.mode !== "free" ? (
            <div className="playback-mode-fields">
              <MomentFields
                date={draft.startDate}
                dateLabel={tr("День начала", "Start day")}
                id="playback-start"
                onChange={(startDate, startTime) => setDraft({ ...draft, startDate, startTime })}
                time={draft.startTime}
                timeLabel={tr("Время начала", "Start time")}
              />
              {draft.mode === "planned" ? (
                <MomentFields
                  date={draft.endDate}
                  dateLabel={tr("День конца", "End day")}
                  id="playback-end"
                  onChange={(endDate, endTime) => setDraft({ ...draft, endDate, endTime })}
                  time={draft.endTime}
                  timeLabel={tr("Время конца", "End time")}
                />
              ) : null}
              {draft.mode === "planned" && applied && fillSeconds <= 0 ? (
                <p className="playback-mode-note warn">{tr("Конец должен быть позже начала.", "The end must be after the start.")}</p>
              ) : null}
              {draft.mode === "planned" && applied && fillSeconds > 0 ? (
                <p className="playback-mode-note">
                  {tr("Заполнить", "To fill")}: <b>{formatClockDuration(fillSeconds)}</b>
                  {" · "}{tr("длина списка", "list length")} <b>{formatClockDuration(listSeconds)}</b>
                  {" — "}{fillNote(listSeconds, fillSeconds, tr)}
                </p>
              ) : null}
              {draft.mode === "weekly" && bounds ? (
                <p className="playback-mode-note">
                  {tr("Неделя", "Week")}: <b>{formatAirMoment(bounds.startsAt, language)}</b>
                  {" → "}<b>{formatAirMoment(bounds.endsAt, language)}</b>
                </p>
              ) : null}
              {gate && gate.kind !== "any-clip" && (draft.mode === "weekly" || gate.kind === "ended") ? (
                <p className={`playback-mode-note ${gate.kind === "on-air" ? "" : "warn"}`}>
                  {gateText(gate, playlist, draft.mode, language, tr)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer>
          <p>
            {draft.mode === "free"
              ? tr("Кнопка «Повтор» в настройках встанет в то же положение и будет заперта, пока выбран этот тип.", "The Repeat button in settings follows this choice and stays locked while it is selected.")
              : draft.mode === "planned"
                ? tr("Старт с любого ролика в любой момент до конца. В заданный конец эфир уходит на Future, а без него — на резервную заставку.", "Start from any clip any time before the end. At the set end air goes to Future, or to the reserve clip if there is none.")
                : tr("Отметка старта и «Взять в эфир» запираются: неделя идёт только по часам.", "Start marker and Take on air are locked: the week runs on the clock only.")}
          </p>
          <div>
            <button className="secondary-button" onClick={onClose} type="button">{tr("Отмена", "Cancel")}</button>
            <button className="primary-button" disabled={!valid} onClick={() => onApply(draft)} type="button">
              {tr("Применить", "Apply")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** День и время одним куском: у начала и конца поля одинаковые. */
function MomentFields({
  id, date, time, dateLabel, timeLabel, onChange,
}: {
  id: string;
  date: string;
  time: string;
  dateLabel: string;
  timeLabel: string;
  onChange: (date: string, time: string) => void;
}) {
  return (
    <>
      <div className="form-field">
        <label htmlFor={`${id}-date`}>{dateLabel}</label>
        <input id={`${id}-date`} onChange={(event) => onChange(event.target.value, time)} type="date" value={date} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-time`}>{timeLabel}</label>
        <input id={`${id}-time`} onChange={(event) => onChange(date, event.target.value)} step={1} type="time" value={time} />
      </div>
    </>
  );
}

/** Что эфир сделает с разницей между списком и временем заполнения. */
function fillNote(listSeconds: number, fillSeconds: number, tr: Translate): string {
  const difference = formatClockDuration(Math.abs(listSeconds - fillSeconds));
  if (Math.abs(listSeconds - fillSeconds) < 1) return tr("список заполняет время ровно.", "the list fills the time exactly.");
  return listSeconds < fillSeconds
    ? tr(`недобор ${difference} доиграет резервная заставка.`, `the ${difference} underrun is filled by the reserve clip.`)
    : tr(`перебор ${difference} отрежется в конце.`, `the ${difference} overrun is cut at the end.`);
}

function gateText(
  gate: Exclude<PlaybackStart, { kind: "any-clip" }>,
  playlist: MediaAsset[],
  mode: PlaybackMode,
  language: "ru" | "en",
  tr: Translate,
): string {
  if (gate.kind === "on-air") {
    const name = playlist[gate.point.itemIndex]?.name ?? "";
    const offset = formatClockDuration(gate.point.itemOffsetSeconds);
    return tr(`Сейчас по часам в эфир пойдёт «${name}» с ${offset}.`, `On the clock right now: “${name}” from ${offset}.`);
  }
  if (gate.kind === "not-started") {
    const at = formatAirMoment(gate.startsAt, language);
    return tr(`Неделя ещё не началась: эфир поднимется не раньше ${at}.`, `The week has not started: playout can start from ${at}.`);
  }
  if (gate.kind === "ended") {
    const at = formatAirMoment(gate.endsAt, language);
    return mode === "planned"
      ? tr(`Это время уже прошло ${at} — старт по нему не разрешён.`, `This time already passed ${at} — it cannot be started.`)
      : tr(`Эта неделя кончилась ${at} — старт по ней не разрешён.`, `This week ended ${at} — it cannot be started.`);
  }
  return tr(
    "Неделя идёт, но ролики расписания кончились раньше неё — поднимать эфир не с чего.",
    "The week is running, but the schedule ran out before it — there is nothing to start from.",
  );
}
