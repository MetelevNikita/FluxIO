import { AlertTriangle, FileVideo2, LoaderCircle, X } from "lucide-react";
import type { MissingGraphic } from "../missing-graphics";
import { useI18n } from "../i18n";

/**
 * Список графики, на которую ссылается расписание, но которой нет ни на диске,
 * ни в библиотеке проекта. Показывается после восстановления сессии и после
 * импорта чужого расписания — до того, как оператор нажмёт Start.
 */
interface MissingGraphicsDialogProps {
  busy: boolean;
  items: MissingGraphic[];
  resolved: Record<string, string>;
  onLocate: (filePath: string) => void;
  onDropAll: () => void;
  onClose: () => void;
}

export function MissingGraphicsDialog({
  busy,
  items,
  resolved,
  onLocate,
  onDropAll,
  onClose,
}: MissingGraphicsDialogProps) {
  const { tr } = useI18n();
  const pending = items.filter((item) => !resolved[item.filePath]).length;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={tr("Потерянная графика", "Missing graphics")}>
      <div className="missing-graphics-dialog">
        <header>
          <AlertTriangle size={18} />
          <div>
            <strong>{tr("Графика расписания не найдена", "Schedule graphics not found")}</strong>
            <span>
              {tr(
                `Расписание ссылается на ${items.length} элемент(ов) графики, которых нет на диске или в библиотеке эффектов. Укажите файлы или снимите их с роликов — иначе эфир не стартует.`,
                `The schedule references ${items.length} graphic item(s) missing from disk or the effects library. Locate the files or remove them from clips before starting playout.`,
              )}
            </span>
          </div>
          <button aria-label={tr("Закрыть", "Close")} onClick={onClose} type="button"><X size={15} /></button>
        </header>

        <ul>
          {items.map((item) => {
            const replacement = resolved[item.filePath];
            return (
              <li className={replacement ? "resolved" : ""} key={item.filePath}>
                <div>
                  <strong title={item.name}>{item.name}</strong>
                  <small title={item.filePath}>{item.filePath}</small>
                  <em>
                    {item.reason === "file-missing"
                      ? tr("Файл не найден на диске", "File not found on disk")
                      : tr("Эффекта нет в библиотеке проекта", "Effect is missing from the project library")}
                    {" · "}
                    {item.usageCount} {tr("ролик(ов)", "clip(s)")}
                  </em>
                </div>
                {replacement ? (
                  <span className="missing-graphics-resolved" title={replacement}>
                    {tr("Заменён", "Replaced")}
                  </span>
                ) : (
                  <button disabled={busy} onClick={() => onLocate(item.filePath)} type="button">
                    <FileVideo2 size={12} /> {tr("Указать файл", "Locate file")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <footer>
          {busy ? <LoaderCircle className="spin" size={15} /> : null}
          <span>
            {pending === 0
              ? tr("Все элементы заменены.", "All items have been replaced.")
              : tr(`Осталось без замены: ${pending}`, `Still missing: ${pending}`)}
          </span>
          <button disabled={busy || pending === 0} onClick={onDropAll} type="button">
            {tr("Снять оставшиеся с роликов", "Remove remaining from clips")}
          </button>
          <button className="primary" disabled={busy} onClick={onClose} type="button">
            {tr("Готово", "Done")}
          </button>
        </footer>
      </div>
    </div>
  );
}
