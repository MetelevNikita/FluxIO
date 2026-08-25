import type { BroadcastDataMapping } from "@gruber/contracts";
import { Check, Link2, Maximize2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";

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
  const { tr } = useI18n();
  const [matchSourceKey, setMatchSourceKey] = useState(mapping.matchSourceKey);
  const [sourceByTarget, setSourceByTarget] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const fields = summary?.fields ?? [];
  const firstRecord = summary?.records[0] ?? {};
  // Выбирать можно любое поле массива, а не только ключи первой записи: в
  // реальных rundown-файлах необязательный заголовок нередко появляется со
  // второй или третьей строки.
  const sourceKeys = fields.map((field) => field.key);
  const firstObjectSourceKeys = Object.keys(firstRecord);
  const sourceSignature = sourceKeys.join("|");
  const targetSignature = targets.map((target) => `${target.key}:${target.responsive}`).join("|");
  const bindingSignature = mapping.bindings
    .map((binding) => `${binding.sourceKey}:${binding.targetKey}`)
    .join("|");

  useEffect(() => {
    if (!open) return;
    setMatchSourceKey(sourceKeys.includes(mapping.matchSourceKey)
      ? mapping.matchSourceKey
      : preferredMatchSourceKey(sourceKeys));
    const existing = Object.fromEntries(mapping.bindings
      .filter((item) => sourceKeys.includes(item.sourceKey))
      .map((item) => [item.targetKey, item.sourceKey]));
    setSourceByTarget(autoMapTargets(sourceKeys, targets, existing));
  }, [open, summary?.filePath, mapping.matchSourceKey, bindingSignature,
    targetSignature, sourceSignature]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("select, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), input:not([disabled])",
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
    <div
      className="modal-backdrop json-mapping-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="presentation"
    >
      <section aria-label="JSON Parser" aria-modal="true" className="json-mapping-dialog" ref={dialogRef} role="dialog">
        <header>
          <div className="json-mapping-icon"><Link2 size={18} /></div>
          <div>
            <span>{tr("РАБОТА С ДАННЫМИ", "DATA WORKSPACE")}</span>
            <h2>JSON Parser</h2>
            <p>{templateName} · {summary.entryCount} {tr("записей", "records")} · {tr("всего полей", "total fields")}: {sourceKeys.length} · {shortPath(summary.filePath)}</p>
          </div>
          <button aria-label={tr("Закрыть", "Close")} onClick={onClose} type="button"><X size={16} /></button>
        </header>

        <div className="json-mapping-body">
          <section className="json-mapping-source">
            <div className="json-mapping-section-title">
              <span>01</span><div><strong>{tr("Как найти ролик", "How to find a clip")}</strong><small>{tr("Выберите служебное поле массива JSON", "Choose the JSON array lookup field")}</small></div>
            </div>
            <label>
              <span>{tr("Идентификатор записи", "Record identifier")}</span>
              <select onChange={(event) => setMatchSourceKey(event.target.value)} value={matchSourceKey}>
                {sourceKeys.map((key) => (
                  <option key={key} value={key}>
                    {key} · {fieldSample(fields, firstRecord, key, tr("нет значения", "no value"))} · {fields.find((field) => field.key === key)?.populatedCount ?? 0}/{summary.entryCount}
                  </option>
                ))}
              </select>
            </label>

            <div className="json-mapping-section-title">
              <span>02</span><div><strong>{tr("Ручное присвоение полей", "Manual field mapping")}</strong><small>{tr("Поле массива JSON → Text Layer плашки", "JSON array field → title Text Layer")}</small></div>
              <button
                className="json-auto-map"
                onClick={() => setSourceByTarget(autoMapTargets(sourceKeys, targets, {}))}
                type="button"
              ><Sparkles size={12} /> {tr("Автосвязь", "Auto map")}</button>
            </div>
            <div className="json-binding-list">
              {targets.length === 0 ? (
                <div className="json-empty-targets">{tr("Подгрузите Lottie-шаблон с редактируемыми Text Layer.", "Load a Lottie template with editable Text Layers.")}</div>
              ) : targets.map((target) => {
                const sourceKey = sourceByTarget[target.key] ?? "";
                const sample = fieldSample(fields, firstRecord, sourceKey, tr("нет значения", "no value"));
                const populatedCount = fields.find((field) => field.key === sourceKey)?.populatedCount ?? 0;
                return (
                  <div className="json-binding-row" key={target.key}>
                    <select
                      aria-label={tr(`Источник для ${target.key}`, `Source for ${target.key}`)}
                      onChange={(event) => setSourceByTarget((current) => ({
                        ...current,
                        [target.key]: event.target.value,
                      }))}
                      value={sourceKey}
                    >
                      <option value="">— {tr("оставить значение шаблона", "keep template value")} —</option>
                      {sourceKeys.filter((key) => key !== matchSourceKey).map((key) => (
                        <option key={key} value={key}>{key} · {fieldSample(fields, firstRecord, key, tr("нет значения", "no value"))}</option>
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
                      {tr("Объект", "Object")} #1: {sample} · {tr("заполнено", "populated")} {populatedCount}/{summary.entryCount}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="json-mapping-preview">
            <div className="json-mapping-section-title">
              <span>03</span><div><strong>{tr("Первый объект JSON", "First JSON object")}</strong><small>{tr("По нему оператор строит связи для всего массива", "Used to build mappings for the entire array")}</small></div>
            </div>
            <div className="json-first-object">
              {firstObjectSourceKeys.map((key) => (
                <div className={key === matchSourceKey ? "match" : ""} key={key}>
                  <code>{key}</code><span title={firstRecord[key]}>{firstRecord[key] || "—"}</span>
                </div>
              ))}
            </div>

            <div className="json-mapping-section-title">
              <span>04</span><div><strong>{tr("Поля плашки", "Title fields")}</strong><small>{templateName} · {tr("Text Layer, доступные для подстановки", "Text Layers available for substitution")}</small></div>
            </div>
            <div className="json-template-fields">
              {targets.length === 0 ? <p>{tr("В шаблоне нет редактируемых Text Layer.", "The template has no editable Text Layers.")}</p> : targets.map((target) => (
                <div key={target.key}>
                  <code>{target.key}</code>
                  <span className={target.responsive ? "json-fit-ready" : "json-fit-missing"}>
                    <Maximize2 size={10} /> {target.responsive ? "FIT READY" : "FIXED"}
                  </span>
                </div>
              ))}
            </div>

            <div className="json-mapping-section-title">
              <span>05</span><div><strong>{tr("Проверка массива", "Array check")}</strong><small>{tr("Первые три записи с выбранными полями", "First three records with selected fields")}</small></div>
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
              <div><strong>{tr("Отзывчивая подложка", "Responsive plate")}</strong><p><b>FIT READY</b> {tr("означает, что в Lottie найден Shape Layer", "means that Lottie contains a Shape Layer")} <code>fit:&lt;Text Layer&gt;</code>. {tr("Его ширина автоматически пересчитывается под каждое значение JSON.", "Its width is recalculated automatically for every JSON value.")}</p></div>
            </div>
            {sourceKeys.length === 0 ? (
              <div className="json-parser-warnings"><p>{tr("JSON не содержит доступных строковых, числовых или boolean-полей.", "JSON has no usable string, number, or boolean fields.")}</p></div>
            ) : null}
            {summary.warnings.length > 0 ? (
              <div className="json-parser-warnings">{summary.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}</div>
            ) : null}
            {matchField && matchField.populatedCount < summary.entryCount ? (
              <div className="json-parser-warnings">
                <p>{tr(
                  `Идентификатор «${matchSourceKey}» отсутствует в ${summary.entryCount - matchField.populatedCount} объекте(ах): эти записи будут пропущены.`,
                  `Identifier “${matchSourceKey}” is missing from ${summary.entryCount - matchField.populatedCount} object(s); those records will be skipped.`,
                )}</p>
              </div>
            ) : null}
            {incompleteBindings.length > 0 ? (
              <div className="json-parser-warnings">
                {incompleteBindings.slice(0, 3).map((binding) => (
                  <p key={binding.targetKey}>
                    {binding.sourceKey} → {binding.targetKey}: {tr(
                      `значение есть в ${binding.populatedCount}/${summary.entryCount} объектах; в остальных останется текст шаблона.`,
                      `value exists in ${binding.populatedCount}/${summary.entryCount} objects; the remaining objects keep the template text.`,
                    )}
                  </p>
                ))}
              </div>
            ) : null}
          </aside>
        </div>

        <footer>
          <span><Check size={12} /> {tr("Сопоставлено", "Mapped")} {mappedCount} {tr("из", "of")} {targets.length} {tr("полей", "fields")}</span>
          <button onClick={onClose} type="button">{tr("Отмена", "Cancel")}</button>
          <button
            className="primary"
            disabled={!matchSourceKey || !sourceKeys.includes(matchSourceKey)}
            onClick={() => onSave({
              filePath: summary.filePath,
              matchSourceKey,
              bindings: Object.entries(sourceByTarget)
                .filter(([, sourceKey]) => Boolean(sourceKey))
                .map(([targetKey, sourceKey]) => ({ sourceKey, targetKey })),
            })}
            type="button"
          >{tr("Сохранить связи", "Save mappings")}</button>
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

function fieldSample(
  fields: JsonMappingSummary["fields"],
  firstRecord: Record<string, string>,
  key: string,
  missingValue: string,
): string {
  return firstRecord[key] ?? fields.find((field) => field.key === key)?.samples[0] ?? missingValue;
}

function shortPath(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.at(-1) ?? value;
}
