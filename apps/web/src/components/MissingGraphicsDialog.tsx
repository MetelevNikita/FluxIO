import { AlertTriangle, FileVideo2, LoaderCircle, X } from "lucide-react";
import type { MissingGraphic } from "../missing-graphics";

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
  const pending = items.filter((item) => !resolved[item.filePath]).length;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Потерянная графика">
      <div className="missing-graphics-dialog">
        <header>
          <AlertTriangle size={18} />
          <div>
            <strong>Графика расписания не найдена</strong>
            <span>
              Расписание ссылается на {items.length} элемент(ов) графики, которых нет на диске
              или в библиотеке эффектов. Укажите файлы или снимите их с роликов — иначе эфир
              не стартует.
            </span>
          </div>
          <button aria-label="Закрыть" onClick={onClose} type="button"><X size={15} /></button>
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
                      ? "Файл не найден на диске"
                      : "Эффекта нет в библиотеке проекта"}
                    {" · "}
                    {item.usageCount} ролик(ов)
                  </em>
                </div>
                {replacement ? (
                  <span className="missing-graphics-resolved" title={replacement}>
                    Заменён
                  </span>
                ) : (
                  <button disabled={busy} onClick={() => onLocate(item.filePath)} type="button">
                    <FileVideo2 size={12} /> Указать файл
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
              ? "Все элементы заменены."
              : `Осталось без замены: ${pending}`}
          </span>
          <button disabled={busy || pending === 0} onClick={onDropAll} type="button">
            Снять оставшиеся с роликов
          </button>
          <button className="primary" disabled={busy} onClick={onClose} type="button">
            Готово
          </button>
        </footer>
      </div>
    </div>
  );
}
