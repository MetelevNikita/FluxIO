import type { SceneLayoutTarget } from "@gruber/contracts";
import { Check, MonitorPlay } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Выбор раскладочных целей при создании шаблона.
 *
 * Спрашиваем один раз и заранее, потому что от набора целей зависит работа
 * дизайнера: под каждую заявленную цель он обязан проверить раскладку, а
 * незаявленная в эфир не пойдёт вовсе.
 *
 * Канал вещает в одном-двух форматах — предлагать все четыре по умолчанию
 * значит заставить проверять то, чего никогда не будет в линии.
 * ------------------------------------------------------------------------- */

export const layoutCatalog: {
  target: SceneLayoutTarget;
  title: string;
  size: string;
  note: string;
  noteEn: string;
}[] = [
  {
    target: "hd",
    title: "HD 1080",
    size: "1920 × 1080 · 25p",
    note: "Основной формат большинства каналов",
    noteEn: "The usual format for most channels",
  },
  {
    target: "uhd",
    title: "UHD 2160",
    size: "3840 × 2160 · 25p",
    note: "Требует аппаратного кодирования: программное не тянет реальное время",
    noteEn: "Needs hardware encoding: software cannot keep real time",
  },
  {
    target: "sd-16x9",
    title: "SD 16:9",
    size: "720 × 576 · 50i · анаморф",
    note: "Пиксель не квадратный — кадр в эфире шире, чем в файле",
    noteEn: "Non-square pixels — the frame is wider on air than in the file",
  },
  {
    target: "sd-4x3",
    title: "SD 4:3",
    size: "720 × 576 · 50i",
    note: "Раскладка 16:9 сюда не помещается: узлам понадобятся поправки",
    noteEn: "A 16:9 layout does not fit here: nodes will need overrides",
  },
];

export function SceneFormatDialog({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (targets: SceneLayoutTarget[]) => void;
}) {
  const { tr } = useI18n();
  const [chosen, setChosen] = useState<Set<SceneLayoutTarget>>(new Set(["hd"]));

  const toggle = (target: SceneLayoutTarget) => {
    setChosen((current) => {
      const next = new Set(current);
      // Хотя бы одна цель обязана остаться: шаблон без целей в эфир не пойдёт.
      if (next.has(target)) { if (next.size > 1) next.delete(target); }
      else next.add(target);
      return next;
    });
  };

  return (
    <div className="scene-format-backdrop" onClick={onCancel}>
      <div className="scene-format-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <MonitorPlay size={15} />
          <div>
            <strong>{tr("Разрешения шаблона", "Template resolutions")}</strong>
            <small>
              {tr(
                "Один шаблон работает во всех выбранных: раскладка пересчитывается от долей кадра.",
                "One template serves every chosen resolution: the layout scales from frame fractions.",
              )}
            </small>
          </div>
        </header>

        <ul>
          {layoutCatalog.map((entry) => {
            const active = chosen.has(entry.target);
            return (
              <li className={active ? "active" : ""} key={entry.target}>
                <button onClick={() => toggle(entry.target)} type="button">
                  <i>{active ? <Check size={12} /> : null}</i>
                  <span>
                    <b>{entry.title}</b>
                    <code>{entry.size}</code>
                  </span>
                  <em>{tr(entry.note, entry.noteEn)}</em>
                </button>
              </li>
            );
          })}
        </ul>

        <footer>
          <p>
            {tr(
              "Незаявленное разрешение в эфир не пойдёт, а заявленное придётся проверить глазами — берите только то, в чём канал действительно вещает.",
              "An undeclared resolution never reaches air, and a declared one has to be checked by eye.",
            )}
          </p>
          <div>
            <button onClick={onCancel} type="button">{tr("Отмена", "Cancel")}</button>
            <button className="primary" onClick={() => onConfirm([...chosen])} type="button">
              {tr("Создать шаблон", "Create template")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
