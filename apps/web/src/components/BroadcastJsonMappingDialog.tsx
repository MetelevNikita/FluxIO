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
  templateName,
  targets,
}: {
  mapping: BroadcastDataMapping;
  onClose: () => void;
  onSave: (mapping: BroadcastDataMapping) => void;
  open: boolean;
  summary: JsonMappingSummary | null;
  templateName: string;
  targets: JsonMappingTarget[];
}) {
  const [matchSourceKey, setMatchSourceKey] = useState(mapping.matchSourceKey);
  const [sourceByTarget, setSourceByTarget] = useState<Record<string, string>>({});
  const fields = summary?.fields ?? [];
  const firstRecord = summary?.records[0] ?? {};
  // Mapping строится по эталонному первому объекту, как в newsroom/CG
  // системах: оператор видит реальное значение каждого доступного ключа, а
  // затем одна и та же схема применяется ко всем следующим объектам массива.
  const firstObjectSourceKeys = Object.keys(firstRecord);
  const firstObjectSignature = firstObjectSourceKeys.join("|");
  const targetSignature = targets.map((target) => `${target.key}:${target.responsive}`).join("|");
  const bindingSignature = mapping.bindings
    .map((binding) => `${binding.sourceKey}:${binding.targetKey}`)
    .join("|");

  useEffect(() => {
    if (!open) return;
    const sourceKeys = firstObjectSourceKeys;
    setMatchSourceKey(sourceKeys.includes(mapping.matchSourceKey)
      ? mapping.matchSourceKey
      : preferredMatchSourceKey(sourceKeys));
    const existing = Object.fromEntries(mapping.bindings
      .filter((item) => sourceKeys.includes(item.sourceKey))
      .map((item) => [item.targetKey, item.sourceKey]));
    setSourceByTarget(autoMapTargets(sourceKeys, targets, existing));
  }, [open, summary?.filePath, mapping.matchSourceKey, bindingSignature,
    targetSignature, firstObjectSignature]);

  const previewKeys = useMemo(() => {
    const mapped = Object.values(sourceByTarget).filter(Boolean);
    return [...new Set([matchSourceKey, ...mapped])].filter(Boolean).slice(0, 5);
  }, [matchSourceKey, sourceByTarget]);

  if (!open || !summary) return null;
  const mappedCount = Object.values(sourceByTarget).filter(Boolean).length;
  const matchField = fields.find((field) => field.key === matchSourceKey);
  const incompleteBindings = Object.entries(sourceByTarget)
    .filter(([, sourceKey]) => Boolean(sourceKey))
    .map(([targetKey, sourceKey]) => ({
      sourceKey,
      targetKey,
      populatedCount: fields.find((field) => field.key === sourceKey)?.populatedCount ?? 0,
    }))
    .filter((binding) => binding.populatedCount < summary.entryCount);
  return (
    <div className="modal-backdrop json-mapping-backdrop" role="presentation">
      <section aria-label="JSON Parser" aria-modal="true" className="json-mapping-dialog" role="dialog">
        <header>
          <div className="json-mapping-icon"><Link2 size={18} /></div>
          <div>
            <span>DATA WORKSPACE</span>
            <h2>JSON Parser</h2>
            <p>{templateName} · {summary.entryCount} записей · первый объект: {firstObjectSourceKeys.length} полей · {shortPath(summary.filePath)}</p>
          </div>
          <button aria-label="Закрыть" onClick={onClose} type="button"><X size={16} /></button>
        </header>

        <div className="json-mapping-body">
          <section className="json-mapping-source">
            <div className="json-mapping-section-title">
              <span>01</span><div><strong>Как найти ролик</strong><small>Выберите служебное поле первого объекта JSON</small></div>
            </div>
            <label>
              <span>Идентификатор записи</span>
              <select onChange={(event) => setMatchSourceKey(event.target.value)} value={matchSourceKey}>
                {firstObjectSourceKeys.map((key) => (
                  <option key={key} value={key}>
                    {key} · {firstRecord[key]} · {fields.find((field) => field.key === key)?.populatedCount ?? 0}/{summary.entryCount}
                  </option>
                ))}
              </select>
            </label>

            <div className="json-mapping-section-title">
              <span>02</span><div><strong>Ручное присвоение полей</strong><small>Ключ первого объекта JSON → Text Layer плашки</small></div>
              <button
                className="json-auto-map"
                onClick={() => setSourceByTarget(autoMapTargets(firstObjectSourceKeys, targets, {}))}
                type="button"
              ><Sparkles size={12} /> Auto map</button>
            </div>
            <div className="json-binding-list">
              {targets.length === 0 ? (
                <div className="json-empty-targets">Подгрузите Lottie-шаблон с редактируемыми Text Layer.</div>
              ) : targets.map((target) => {
                const sourceKey = sourceByTarget[target.key] ?? "";
                const sample = firstRecord[sourceKey];
                const populatedCount = fields.find((field) => field.key === sourceKey)?.populatedCount ?? 0;
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
                      {firstObjectSourceKeys.filter((key) => key !== matchSourceKey).map((key) => (
                        <option key={key} value={key}>{key} · {firstRecord[key]}</option>
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
                    <small title={sample}>
                      Объект #1: {sample || "нет значения"} · заполнено {populatedCount}/{summary.entryCount}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="json-mapping-preview">
            <div className="json-mapping-section-title">
              <span>03</span><div><strong>Первый объект JSON</strong><small>По нему оператор строит mapping для всего массива</small></div>
            </div>
            <div className="json-first-object">
              {firstObjectSourceKeys.map((key) => (
                <div className={key === matchSourceKey ? "match" : ""} key={key}>
                  <code>{key}</code><span title={firstRecord[key]}>{firstRecord[key] || "—"}</span>
                </div>
              ))}
            </div>

            <div className="json-mapping-section-title">
              <span>04</span><div><strong>Поля плашки</strong><small>{templateName} · Text Layer, доступные для подстановки</small></div>
            </div>
            <div className="json-template-fields">
              {targets.length === 0 ? <p>В шаблоне нет редактируемых Text Layer.</p> : targets.map((target) => (
                <div key={target.key}>
                  <code>{target.key}</code>
                  <span className={target.responsive ? "json-fit-ready" : "json-fit-missing"}>
                    <Maximize2 size={10} /> {target.responsive ? "FIT READY" : "FIXED"}
                  </span>
                </div>
              ))}
            </div>

            <div className="json-mapping-section-title">
              <span>05</span><div><strong>Проверка массива</strong><small>Первые три записи с выбранными полями</small></div>
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
            {firstObjectSourceKeys.length === 0 ? (
              <div className="json-parser-warnings"><p>Первый объект JSON не содержит доступных строковых, числовых или boolean-полей.</p></div>
            ) : null}
            {summary.warnings.length > 0 ? (
              <div className="json-parser-warnings">{summary.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}</div>
            ) : null}
            {matchField && matchField.populatedCount < summary.entryCount ? (
              <div className="json-parser-warnings">
                <p>Идентификатор «{matchSourceKey}» отсутствует в {summary.entryCount - matchField.populatedCount} объекте(ах): эти записи будут пропущены.</p>
              </div>
            ) : null}
            {incompleteBindings.length > 0 ? (
              <div className="json-parser-warnings">
                {incompleteBindings.slice(0, 3).map((binding) => (
                  <p key={binding.targetKey}>
                    {binding.sourceKey} → {binding.targetKey}: значение есть в {binding.populatedCount}/{summary.entryCount} объектах; в остальных останется текст шаблона.
                  </p>
                ))}
              </div>
            ) : null}
          </aside>
        </div>

        <footer>
          <span><Check size={12} /> Сопоставлено {mappedCount} из {targets.length} полей</span>
          <button onClick={onClose} type="button">Отмена</button>
          <button
            className="primary"
            disabled={!matchSourceKey || !firstObjectSourceKeys.includes(matchSourceKey)}
            onClick={() => onSave({
              filePath: summary.filePath,
              matchSourceKey,
              bindings: Object.entries(sourceByTarget)
                .filter(([, sourceKey]) => Boolean(sourceKey))
                .map(([targetKey, sourceKey]) => ({ sourceKey, targetKey })),
            })}
            type="button"
          >Сохранить связи</button>
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

/** Для титровального задания `title` — рекомендуемый идентификатор ролика. */
function preferredMatchSourceKey(sourceKeys: string[]): string {
  const priorities = ["title", "name", "media", "filename", "file", "clip"];
  for (const priority of priorities) {
    const exact = sourceKeys.find((source) => normalizeKey(source) === priority);
    if (exact) return exact;
  }
  const nestedTitle = sourceKeys.find((source) => normalizeKey(source).endsWith("title"));
  return nestedTitle ?? sourceKeys[0] ?? "title";
}

function shortPath(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.at(-1) ?? value;
}
