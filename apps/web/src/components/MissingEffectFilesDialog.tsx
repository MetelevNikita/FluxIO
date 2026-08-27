import { AlertTriangle, FolderSearch, X } from "lucide-react";
import type { MissingEffectFile } from "../missing-graphics";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * «Потерян файл эффекта — найдите».
 *
 * Проект хранит абсолютные пути, а не сами файлы. После переноса на другую
 * машину или переустановки файл может исчезнуть, и раньше это всплывало
 * отказом на Start — то есть в самый неподходящий момент.
 *
 * Окно показывается сразу после восстановления сессии, до того как оператор
 * соберётся в эфир.
 * ------------------------------------------------------------------------- */

const roleTitles: Record<MissingEffectFile["role"], [string, string]> = {
  decoration: ["оформление эффекта", "effect design"],
  stinger: ["файл перехода", "transition file"],
  "scene-media": ["подложка сцены", "scene backdrop"],
};

export function MissingEffectFilesDialog({
  busy, items, onClose, onLocate,
}: {
  busy: boolean;
  items: MissingEffectFile[];
  onClose: () => void;
  onLocate: (filePath: string) => void;
}) {
  const { tr } = useI18n();
  return (
    <div className="missing-files-backdrop">
      <div className="missing-files">
        <header>
          <AlertTriangle size={15} />
          <div>
            <strong>{tr("Потеряны файлы эффектов", "Effect files are missing")}</strong>
            <small>
              {tr(
                "Проект хранит пути, а не сами файлы. Найдите их сейчас — иначе эфир откажет на старте.",
                "The project stores paths, not files. Locate them now, or playout will refuse to start.",
              )}
            </small>
          </div>
          <button onClick={onClose} type="button"><X size={14} /></button>
        </header>

        <ul>
          {items.map((item) => (
            <li key={`${item.effectId}:${item.filePath}`}>
              <div>
                <b>{item.effectName}</b>
                <span>
                  {tr(...roleTitles[item.role])}
                  {item.nodeName ? ` · ${item.nodeName}` : ""}
                </span>
                <code>{item.filePath}</code>
              </div>
              <button disabled={busy} onClick={() => onLocate(item.filePath)} type="button">
                <FolderSearch size={12} /> {tr("Найти", "Locate")}
              </button>
            </li>
          ))}
        </ul>

        <footer>
          <p>
            {tr(
              "Найденный файл подставляется во все места сразу: один и тот же путь может использоваться несколькими эффектами.",
              "A located file is substituted everywhere at once: the same path can serve several effects.",
            )}
          </p>
          <button onClick={onClose} type="button">{tr("Разобраться позже", "Deal with it later")}</button>
        </footer>
      </div>
    </div>
  );
}
