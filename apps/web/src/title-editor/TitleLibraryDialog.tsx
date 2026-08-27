import type { TitleFileSummary } from "@gruber/contracts";
import { AlertTriangle, FolderOpen, Layers3, RefreshCw, X } from "lucide-react";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Каталог готовых титров.
 *
 * Смысл окна — не собирать плашку заново каждый раз. Показываем то, по чему
 * титр узнают, не открывая: имя, раскладки, поля и подпись автора.
 *
 * Нечитаемые файлы показываются отдельным списком, а не проглатываются: молча
 * пропущенный титр выглядит как «папка пустая».
 * ------------------------------------------------------------------------- */

export function TitleLibraryDialog({
  busy, directoryPath, items, issues,
  onClose, onPick, onPickFile, onRefresh, onSelectFolder,
}: {
  busy: boolean;
  directoryPath: string;
  items: TitleFileSummary[];
  issues: { filePath: string; message: string }[];
  onClose: () => void;
  onPick: (filePath: string) => void;
  onPickFile: () => void;
  onRefresh: () => void;
  onSelectFolder: () => void;
}) {
  const { tr } = useI18n();
  return (
    <div className="title-library-backdrop" onClick={onClose}>
      <div className="title-library" onClick={(event) => event.stopPropagation()}>
        <header>
          <Layers3 size={15} />
          <div>
            <strong>{tr("Готовые титры", "Saved titles")}</strong>
            <small>{directoryPath || tr("папка не выбрана", "no folder selected")}</small>
          </div>
          <button onClick={onRefresh} title={tr("Перечитать папку", "Re-read the folder")} type="button">
            <RefreshCw size={13} />
          </button>
          <button onClick={onSelectFolder} title={tr("Другая папка", "Another folder")} type="button">
            <FolderOpen size={13} />
          </button>
          <button onClick={onClose} type="button"><X size={14} /></button>
        </header>

        {items.length === 0 ? (
          <p className="title-library-empty">
            {tr(
              "В папке нет титров. Соберите плашку в редакторе и сохраните её кнопкой «Сохранить как» — она появится здесь.",
              "No titles in this folder. Build one in the editor and use “Save as” — it will show up here.",
            )}
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.filePath}>
                <button disabled={busy} onClick={() => onPick(item.filePath)} type="button">
                  <div className="title-library-head">
                    <b>{item.name}</b>
                    <span>{item.targets.join(" · ")}</span>
                  </div>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="title-library-meta">
                    <span>{tr(`узлов: ${item.nodeCount}`, `${item.nodeCount} nodes`)}</span>
                    {item.fieldKeys.length > 0 ? (
                      <span className="title-library-fields">
                        {tr("поля", "fields")}: {item.fieldKeys.join(", ")}
                      </span>
                    ) : (
                      <span>{tr("без полей", "no fields")}</span>
                    )}
                    {item.author ? <span>{item.author}</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {issues.length > 0 ? (
          <div className="title-library-issues">
            <p><AlertTriangle size={11} /> {tr("Не удалось прочитать", "Could not read")}:</p>
            <ul>
              {issues.map((issue) => (
                <li key={issue.filePath}>
                  <code>{issue.filePath.split(/[\\/]/).pop()}</code> — {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <footer>
          <button onClick={onPickFile} type="button">
            <FolderOpen size={12} /> {tr("Открыть файл .fto…", "Open a .fto file…")}
          </button>
        </footer>
      </div>
    </div>
  );
}
