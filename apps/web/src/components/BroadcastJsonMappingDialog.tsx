import type { BroadcastDataMapping } from "@gruber/contracts";
import { Check, Link2, Maximize2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface JsonMappingSummary {
  filePath: string;
  entryCount: number;
  fields: { key: string; populatedCount: number; samples: string[] }[];
  records: Record<string, string>[];
  warnings: string[];
}

export interface JsonMappingTarget {
  key: string;
  label: string;
  responsive: boolean;
}

export function BroadcastJsonMappingDialog({
  mapping,
  onClose,
  onSave,
  open,
  summary,
  targets,
}: {
  mapping: BroadcastDataMapping;
  onClose: () => void;
  onSave: (mapping: BroadcastDataMapping) => void;
  open: boolean;
  summary: JsonMappingSummary | null;
  targets: JsonMappingTarget[];
}) {
  const [matchSourceKey, setMatchSourceKey] = useState(mapping.matchSourceKey);
  const [sourceByTarget, setSourceByTarget] = useState<Record<string, string>>({});
  const fields = summary?.fields ?? [];
  const targetSignature = targets.map((target) => `${target.key}:${target.responsive}`).join("|");
  const bindingSignature = mapping.bindings
    .map((binding) => `${binding.sourceKey}:${binding.targetKey}`)
    .join("|");

  useEffect(() => {
    if (!open) return;
    setMatchSourceKey(mapping.matchSourceKey);
    const existing = Object.fromEntries(mapping.bindings.map((item) => [item.targetKey, item.sourceKey]));
    setSourceByTarget(autoMapTargets(fields.map((field) => field.key), targets, existing));
  }, [open, summary?.filePath, mapping.matchSourceKey, bindingSignature, targetSignature]);

  const previewKeys = useMemo(() => {
    const mapped = Object.values(sourceByTarget).filter(Boolean);
    return [...new Set([matchSourceKey, ...mapped])].filter(Boolean).slice(0, 5);
  }, [matchSourceKey, sourceByTarget]);

  if (!open || !summary) return null;
  const mappedCount = Object.values(sourceByTarget).filter(Boolean).length;
  return (
    <div className="modal-backdrop json-mapping-backdrop" role="presentation">
      <section aria-label="JSON Parser" aria-modal="true" className="json-mapping-dialog" role="dialog">
        <header>
          <div className="json-mapping-icon"><Link2 size={18} /></div>
          <div>
            <span>DATA WORKSPACE</span>
            <h2>JSON Parser</h2>
            <p>{summary.entryCount} записей · {fields.length} полей · {shortPath(summary.filePath)}</p>
          </div>
          <button aria-label="Закрыть" onClick={onClose} type="button"><X size={16} /></button>
        </header>

        <div className="json-mapping-body">
          <section className="json-mapping-source">
            <div className="json-mapping-section-title">
              <span>01</span><div><strong>Как найти ролик</strong><small>Поле JSON должно совпадать с именем материала в плейлисте</small></div>
            </div>
            <label>
              <span>Идентификатор записи</span>
              <select onChange={(event) => setMatchSourceKey(event.target.value)} value={matchSourceKey}>
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>{field.key} · {field.populatedCount}/{summary.entryCount}</option>
                ))}
              </select>
            </label>

            <div className="json-mapping-section-title">
              <span>02</span><div><strong>Связи с шаблоном</strong><small>Слева данные JSON, справа Text Layer шаблона</small></div>
              <button
                className="json-auto-map"
                onClick={() => setSourceByTarget(autoMapTargets(fields.map((field) => field.key), targets, {}))}
                type="button"
              ><Sparkles size={12} /> Auto map</button>
            </div>
            <div className="json-binding-list">
              {targets.length === 0 ? (
                <div className="json-empty-targets">Подгрузите Lottie-шаблон с редактируемыми Text Layer.</div>
              ) : targets.map((target) => {
                const sourceKey = sourceByTarget[target.key] ?? "";
                const sample = fields.find((field) => field.key === sourceKey)?.samples[0];
                return (
                  <div className="json-binding-row" key={target.key}>
                    <select
                      aria-label={`Источник для ${target.key}`}
                      onChange={(event) => setSourceByTarget((current) => ({
                        ...current,
                        [target.key]: event.target.value,
                      }))}
                      value={sourceKey}
                    >
                      <option value="">— оставить значение шаблона —</option>
                      {fields.filter((field) => field.key !== matchSourceKey).map((field) => (
                        <option key={field.key} value={field.key}>{field.key}</option>
                      ))}
                    </select>
                    <span className="json-binding-arrow">→</span>
                    <div>
                      <strong>{target.label}</strong>
                      <code>{target.key}</code>
                    </div>
                    <span className={target.responsive ? "json-fit-ready" : "json-fit-missing"}>
                      <Maximize2 size={11} /> {target.responsive ? "FIT READY" : "FIXED"}
                    </span>
                    <small title={sample}>{sample || "Нет примера"}</small>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="json-mapping-preview">
            <div className="json-mapping-section-title">
              <span>03</span><div><strong>Проверка данных</strong><small>Первые три записи после разбора</small></div>
            </div>
            <div className="json-preview-table">
              <table>
                <thead><tr>{previewKeys.map((key) => <th key={key}>{key}</th>)}</tr></thead>
                <tbody>{summary.records.slice(0, 3).map((record, index) => (
                  <tr key={index}>{previewKeys.map((key) => <td key={key}>{record[key] || "—"}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
            <div className="json-fit-explainer">
              <Maximize2 size={14} />
              <div><strong>Отзывчивая подложка</strong><p><b>FIT READY</b> означает, что в Lottie найден Shape Layer <code>fit:&lt;Text Layer&gt;</code>. Его ширина автоматически пересчитывается под каждое значение JSON.</p></div>
            </div>
            {summary.warnings.length > 0 ? (
              <div className="json-parser-warnings">{summary.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}</div>
            ) : null}
          </aside>
        </div>

        <footer>
          <span><Check size={12} /> Сопоставлено {mappedCount} из {targets.length} полей</span>
          <button onClick={onClose} type="button">Отмена</button>
          <button
            className="primary"
            disabled={!matchSourceKey}
            onClick={() => onSave({
              filePath: summary.filePath,
              matchSourceKey,
              bindings: Object.entries(sourceByTarget)
                .filter(([, sourceKey]) => Boolean(sourceKey))
                .map(([targetKey, sourceKey]) => ({ sourceKey, targetKey })),
            })}
            type="button"
          >Сохранить mapping</button>
        </footer>
      </section>
    </div>
  );
}

function autoMapTargets(
  sourceKeys: string[],
  targets: JsonMappingTarget[],
  existing: Record<string, string>,
): Record<string, string> {
  const result = { ...existing };
  for (const target of targets) {
    if (result[target.key]) continue;
    const normalizedTarget = normalizeKey(target.key);
    const exact = sourceKeys.find((source) => normalizeKey(source) === normalizedTarget);
    const suffix = sourceKeys.find((source) => normalizeKey(source).endsWith(normalizedTarget));
    result[target.key] = exact ?? suffix ?? "";
  }
  return result;
}

function normalizeKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function shortPath(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.at(-1) ?? value;
}
