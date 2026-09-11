import { Fragment, useState } from "react";
import { Scissors, X } from "lucide-react";
import {
  evenSplitDraft,
  formatSplitTimecode,
  maximumPartsFor,
  moveSplitPoint,
  parseSplitTimecode,
  splitDraftIssues,
  splitRange,
  type SplitDraft,
} from "../clip-split";
import { useI18n } from "../i18n";
import type { MediaAsset } from "../types";

/* -------------------------------------------------------------------------- *
 * «Разделение ролика».
 *
 * Фильм режут под рекламу: оператор выбирает число частей, получает их поровну
 * и двигает точки среза. Конец части сразу становится началом следующей, а
 * поля зажаты длиной ролика — срез за соседний или за конец файла не поставить.
 * Между частями встаёт пометка, по умолчанию «Рекламный блок».
 * ------------------------------------------------------------------------- */

export function ClipSplitDialog({ asset, onCancel, onSplit }: {
  asset: MediaAsset;
  onCancel: () => void;
  onSplit: (draft: SplitDraft) => void;
}) {
  const { tr } = useI18n();
  const range = splitRange(asset);
  const [count, setCount] = useState(2);
  const [draft, setDraft] = useState<SplitDraft | null>(null);
  const issues = draft ? splitDraftIssues(draft, range) : [];

  return (
    <div className="playback-mode-backdrop">
      <div aria-label={tr("Разделение ролика", "Split clip")} className="playback-mode clip-split" role="dialog">
        <header>
          <Scissors size={15} />
          <div>
            <strong>{tr("Разделение ролика", "Split clip")}</strong>
            <small>
              {asset.name} · {formatSplitTimecode(range.endSeconds - range.startSeconds)}.{" "}
              {tr(
                "Конец части становится началом следующей; между частями встаёт пометка под рекламу.",
                "A part's end becomes the next part's start; a break marker goes between parts.",
              )}
            </small>
          </div>
          <button aria-label={tr("Закрыть", "Close")} onClick={onCancel} type="button"><X size={14} /></button>
        </header>

        <div className="playback-mode-body">
          <div className="clip-split-count">
            <div className="form-field">
              <label htmlFor="clip-split-count">{tr("Частей", "Parts")}</label>
              <select id="clip-split-count" onChange={(event) => setCount(Number(event.target.value))} value={count}>
                {Array.from({ length: Math.max(0, maximumPartsFor(range) - 1) }, (_, index) => index + 2).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <button
              className="secondary-button"
              onClick={() => setDraft(evenSplitDraft(asset, count, draft ?? undefined))}
              type="button"
            >
              {tr("Применить разделение", "Apply split")}
            </button>
          </div>

          {draft ? (
            <div className="clip-split-parts">
              {draft.parts.map((part, index) => (
                <Fragment key={index}>
                  <div className="clip-split-part">
                    <b>{tr("Часть", "Part")} #{index + 1}</b>
                    <TimeField
                      label={tr("Начало", "Start")}
                      onCommit={(seconds) => setDraft(moveSplitPoint(draft, range, index, "start", seconds))}
                      value={part.startSeconds}
                    />
                    <TimeField
                      label={tr("Конец", "End")}
                      onCommit={(seconds) => setDraft(moveSplitPoint(draft, range, index, "end", seconds))}
                      value={part.endSeconds}
                    />
                    <div className="form-field">
                      <label>{tr("Название", "Name")}</label>
                      <input
                        aria-label={`${tr("Название части", "Part name")} ${index + 1}`}
                        onChange={(event) => setDraft({
                          ...draft,
                          parts: draft.parts.map((item, position) => (
                            position === index ? { ...item, name: event.target.value } : item
                          )),
                        })}
                        value={part.name}
                      />
                    </div>
                  </div>
                  {index < draft.comments.length ? (
                    <div className="clip-split-comment">
                      <label htmlFor={`clip-split-comment-${index}`}>{tr("Комментарий", "Comment")}</label>
                      <input
                        id={`clip-split-comment-${index}`}
                        onChange={(event) => setDraft({
                          ...draft,
                          comments: draft.comments.map((item, position) => (
                            position === index ? event.target.value : item
                          )),
                        })}
                        value={draft.comments[index]}
                      />
                    </div>
                  ) : null}
                </Fragment>
              ))}
            </div>
          ) : (
            <p className="playback-mode-note">
              {tr(
                "Выберите число частей и нажмите «Применить разделение»: части встанут поровну, а точки среза правятся вручную.",
                "Choose the number of parts and press Apply split: parts are laid out evenly, then adjust the cut points.",
              )}
            </p>
          )}
          {issues.length > 0 ? <p className="playback-mode-note warn">{issues.join(" · ")}</p> : null}
        </div>

        <footer>
          <p>
            {tr(
              "Части идут в эфир отрезками одного файла и отмечаются розовым; пометка между ними хронометража не занимает.",
              "Parts air as ranges of one file and are marked pink; the marker between them takes no air time.",
            )}
          </p>
          <div>
            <button className="secondary-button" onClick={onCancel} type="button">{tr("Отмена", "Cancel")}</button>
            <button
              className="primary-button"
              disabled={!draft || issues.length > 0}
              onClick={() => draft && onSplit(draft)}
              type="button"
            >
              {tr("Создать разделение", "Create split")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Поле времени части. Держит черновик строки и отдаёт наружу только законченное
 * время: недописанное «01:» не имеет права утянуть срез в ноль.
 */
function TimeField({ label, value, onCommit }: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const seconds = parseSplitTimecode(text);
    setText(null);
    if (seconds !== null) onCommit(seconds);
  };
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        aria-label={label}
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        value={text ?? formatSplitTimecode(value)}
      />
    </div>
  );
}
