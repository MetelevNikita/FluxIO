import type {
  SceneField, SceneLayoutTarget, SceneNode, SceneTemplate, SystemFont,
} from "@gruber/contracts";
import { FolderOpen, KeyRound, Link2, Link2Off, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { clearLayoutOverride, nodeKindTitle } from "../scene-edit";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Инспектор свойств узла.
 *
 * Числовые поля держат локальный черновик строки: `input[type=number]` отдаёт
 * пустую строку для незавершённого ввода — «1.», «-», «1e», — и прямое
 * приведение к числу возвращало бы поле назад, делая дробный ввод невозможным.
 * ------------------------------------------------------------------------- */

interface SceneInspectorProps {
  template: SceneTemplate;
  node: SceneNode | null;
  /** Выбранная раскладка или `null` — правим общую сцену. */
  target: SceneLayoutTarget | null;
  fonts: SystemFont[];
  onChange: (node: SceneNode) => void;
  onDeclareField: (nodeId: string, label: string) => void;
  onRemoveField: (key: string) => void;
  onFieldChange: (key: string, patch: Partial<SceneField>) => void;
  onPickMedia: (nodeId: string) => void;
}

export function SceneInspector({
  template, node, target, fonts, onChange, onDeclareField, onRemoveField, onFieldChange, onPickMedia,
}: SceneInspectorProps) {
  const { tr } = useI18n();
  if (!node) {
    return (
      <aside className="scene-inspector">
        <p className="scene-inspector-empty">
          {tr("Выберите узел на холсте или в списке слоёв.", "Select a node on the canvas or in the layer list.")}
        </p>
      </aside>
    );
  }

  const override = target ? node.overrides[target] : undefined;
  const hasOverride = Boolean(override && Object.values(override).some((value) => value !== null));

  const patchTransform = (key: "x" | "y" | "width" | "height", value: number) => {
    onChange({
      ...node,
      transform: { ...node.transform, [key]: { ...node.transform[key], value } },
    });
  };

  const boundKey = node.text?.kind === "field" ? node.text.fieldKey : null;
  const field = boundKey
    ? template.fields.find((entry) => entry.key === boundKey) ?? null
    : null;

  return (
    <aside className="scene-inspector">
      <header className="scene-inspector-head">
        <strong>{node.name}</strong>
        <span>{nodeKindTitle(node.kind)}</span>
      </header>

      {target ? (
        <div className={`scene-target-note ${hasOverride ? "active" : ""}`}>
          <span>
            {hasOverride
              ? tr(`Правки идут поправкой для ${target}`, `Edits land as a ${target} override`)
              : tr(`Правки лягут поправкой для ${target}`, `Edits will land as a ${target} override`)}
          </span>
          {hasOverride ? (
            <button
              onClick={() => onChange(clearLayoutOverride(node, target))}
              title={tr("Вернуть «как в общей сцене»", "Reset to the shared scene")}
              type="button"
            >
              <RotateCcw size={11} /> {tr("Сбросить", "Reset")}
            </button>
          ) : null}
        </div>
      ) : null}

      <Section title={tr("Положение", "Position")}>
        <Grid>
          <Num label="X" value={override?.x ?? node.transform.x.value} unit="%"
            onCommit={(v) => patchTransform("x", v)} />
          <Num label="Y" value={override?.y ?? node.transform.y.value} unit="%"
            onCommit={(v) => patchTransform("y", v)} />
          <Num label={tr("Ширина", "Width")} value={override?.width ?? node.transform.width.value} unit="%"
            onCommit={(v) => patchTransform("width", v)} />
          <Num label={tr("Высота", "Height")} value={override?.height ?? node.transform.height.value} unit="%"
            onCommit={(v) => patchTransform("height", v)} />
        </Grid>
        <p className="scene-hint">
          {tr(
            "Доли кадра. X и ширина считаются от ширины кадра, Y и высота — от высоты: так узел стоит на месте при смене раскладки.",
            "Fractions of the frame. X and width come from the width, Y and height from the height.",
          )}
        </p>
      </Section>

      <Section title={tr("Вид", "Appearance")}>
        <Grid>
          <Num label={tr("Прозрачность", "Opacity")} value={node.transform.opacity.value} unit="%"
            onCommit={(v) => onChange({
              ...node,
              transform: { ...node.transform, opacity: { ...node.transform.opacity, value: clamp(v, 0, 1) } },
            })} />
          <Num label={tr("Поворот", "Rotation")} value={node.transform.rotationDegrees.value} unit="°" raw
            onCommit={(v) => onChange({
              ...node,
              transform: { ...node.transform, rotationDegrees: { ...node.transform.rotationDegrees, value: v } },
            })} />
        </Grid>
      </Section>

      {node.kind === "rect" || node.kind === "ellipse" ? (
        <Section title={tr("Заливка", "Fill")}>
          <Grid>
            <Color label={tr("Цвет", "Colour")} value={node.rectStyle.fill}
              onChange={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, fill: v } })} />
            <Num label={tr("Непрозрачность", "Opacity")} value={node.rectStyle.fillOpacity} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, fillOpacity: clamp(v, 0, 1) } })} />
            <Num label={tr("Скругление", "Radius")} value={node.rectStyle.cornerRadius} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, cornerRadius: clamp(v, 0, 0.5) } })} />
            <Num label={tr("Обводка", "Stroke")} value={node.rectStyle.strokeWidth} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, strokeWidth: clamp(v, 0, 0.05) } })} />
          </Grid>
        </Section>
      ) : null}

      {node.kind === "text" ? (
        <TextSection
          field={field} fonts={fonts} node={node} tr={tr}
          onChange={onChange} onDeclareField={onDeclareField} onRemoveField={onRemoveField}
          onFieldChange={onFieldChange}
        />
      ) : null}

      {node.kind === "video" || node.kind === "image" ? (
        <Section title={tr("Подложка", "Media")}>
          <button className="scene-declare" onClick={() => onPickMedia(node.id)} type="button">
            <FolderOpen size={12} />
            {node.media.filePath
              ? tr("Заменить файл", "Replace file")
              : tr("Выбрать видео или .png", "Choose a video or .png")}
          </button>
          {node.media.filePath ? (
            <>
              <p className="scene-hint">{shortPath(node.media.filePath)}</p>
              <Grid>
                <label className="scene-row">
                  <span>{tr("Длина", "Length")}</span>
                  <input readOnly value={`${node.media.durationSeconds.toFixed(2)} с`} />
                </label>
                <label className="scene-row">
                  <span>{tr("Вписать", "Fit")}</span>
                  <select
                    onChange={(event) => onChange({
                      ...node,
                      media: { ...node.media, fit: event.target.value as "contain" | "cover" | "stretch" },
                    })}
                    value={node.media.fit}
                  >
                    <option value="contain">{tr("целиком", "contain")}</option>
                    <option value="cover">{tr("с обрезкой", "cover")}</option>
                    <option value="stretch">{tr("растянуть", "stretch")}</option>
                  </select>
                </label>
              </Grid>
              {!node.media.hasAlpha ? (
                <p className="scene-hint scene-hint-warn">
                  {tr(
                    "У файла нет альфа-канала — подложка закроет собой всё, что под ней, включая картинку ролика.",
                    "The file has no alpha channel — this will cover everything beneath it.",
                  )}
                </p>
              ) : null}
              <p className="scene-hint">
                {tr(
                  "Подложку кладёт FFmpeg отдельным слоем под сценой: декодировать видео в том же процессе, что считает титр, значит не успеть к кадру.",
                  "Media goes through FFmpeg as its own layer beneath the scene.",
                )}
              </p>
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title={tr("Привязка к тексту", "Bind to text")}>
        <label className="scene-row">
          <span>{tr("Тянуться по узлу", "Grow with node")}</span>
          <select
            value={node.fitToText?.nodeId ?? ""}
            onChange={(event) => onChange({
              ...node,
              fitToText: event.target.value
                ? {
                    nodeId: event.target.value,
                    padX: node.fitToText?.padX ?? 0.02,
                    padY: node.fitToText?.padY ?? 0.01,
                    axis: node.fitToText?.axis ?? "x",
                    anchor: node.fitToText?.anchor ?? "grow",
                  }
                : null,
            })}
          >
            <option value="">{tr("— не привязан —", "— not bound —")}</option>
            {template.nodes
              .filter((entry) => entry.id !== node.id &&
                (node.fitToText?.anchor === "follow" || entry.kind === "text"))
              .map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {node.fitToText ? (
          <>
            <label className="scene-row">
              <span>{tr("Как ведёт себя", "Behaviour")}</span>
              <select
                onChange={(event) => onChange({
                  ...node,
                  fitToText: { ...node.fitToText!, anchor: event.target.value as "grow" | "follow" },
                })}
                value={node.fitToText.anchor}
              >
                <option value="grow">{tr("тянется по тексту", "grows with the text")}</option>
                <option value="follow">{tr("примыкает справа", "sits at the right edge")}</option>
              </select>
            </label>
            <Grid>
              <Num label={tr("Отступ X", "Pad X")} value={node.fitToText.padX} unit="%"
                onCommit={(v) => onChange({ ...node, fitToText: { ...node.fitToText!, padX: clamp(v, 0, 0.5) } })} />
              <Num label={tr("Отступ Y", "Pad Y")} value={node.fitToText.padY} unit="%"
                onCommit={(v) => onChange({ ...node, fitToText: { ...node.fitToText!, padY: clamp(v, 0, 0.5) } })} />
            </Grid>
            <p className="scene-hint">
              {node.fitToText.anchor === "follow"
                ? tr(
                  "Узел сохраняет свою ширину и едет за правым краем источника — так держится хвост плашки. Источником может быть и сама подложка.",
                  "The node keeps its width and follows the source's right edge — that is how a plate tail stays attached.",
                )
                : tr(
                  "Ширина считается по образцу поля, а не по текущему значению: у часов оно меняется каждую секунду, и плашка дёргалась бы вместе с цифрами.",
                  "Width is measured from the field's sample, not its current value.",
                )}
            </p>
          </>
        ) : null}
      </Section>

      <Section title={tr("Тень", "Shadow")}>
        <label className="scene-row scene-row-check">
          <input
            checked={node.shadow.enabled}
            onChange={(event) => onChange({ ...node, shadow: { ...node.shadow, enabled: event.target.checked } })}
            type="checkbox"
          />
          <span>{tr("Включить", "Enabled")}</span>
        </label>
        {node.shadow.enabled ? (
          <Grid>
            <Color label={tr("Цвет", "Colour")} value={node.shadow.color}
              onChange={(v) => onChange({ ...node, shadow: { ...node.shadow, color: v } })} />
            <Num label={tr("Размытие", "Blur")} value={node.shadow.blur} unit="%"
              onCommit={(v) => onChange({ ...node, shadow: { ...node.shadow, blur: clamp(v, 0, 0.2) } })} />
            <Num label={tr("Сдвиг вниз", "Offset Y")} value={node.shadow.offsetY} unit="%"
              onCommit={(v) => onChange({ ...node, shadow: { ...node.shadow, offsetY: clamp(v, -0.2, 0.2) } })} />
          </Grid>
        ) : null}
      </Section>
    </aside>
  );
}

/* ------------------------------ текст узла -------------------------------- */

function TextSection({
  node, field, fonts, tr, onChange, onDeclareField, onRemoveField, onFieldChange,
}: {
  node: SceneNode;
  field: SceneField | null;
  fonts: SystemFont[];
  tr: (ru: string, en: string) => string;
  onChange: (node: SceneNode) => void;
  onDeclareField: (nodeId: string, label: string) => void;
  onRemoveField: (key: string) => void;
  onFieldChange: (key: string, patch: Partial<SceneField>) => void;
}) {
  const source = node.text;
  return (
    <>
      <Section title={tr("Текст", "Text")}>
        <label className="scene-row">
          <span>{tr("Источник", "Source")}</span>
          <select
            value={source?.kind ?? "static"}
            onChange={(event) => {
              const kind = event.target.value;
              if (kind === "static") onChange({ ...node, text: { kind: "static", text: "" } });
              if (kind === "clock") onChange({ ...node, text: { kind: "clock", format: "HH:MM:SS", timezoneOffsetMinutes: 0 } });
              if (kind === "countdown") onChange({ ...node, text: { kind: "countdown", format: "MM:SS", source: "fixed", seconds: 60 } });
              if (kind === "ticker") onChange({ ...node, text: { kind: "ticker", items: [], separator: "   •   ", speed: 0.06, direction: "left" } });
            }}
          >
            <option value="static">{tr("Постоянный текст", "Static text")}</option>
            <option value="field" disabled={source?.kind !== "field"}>{tr("Поле шаблона", "Template field")}</option>
            <option value="clock">{tr("Часы", "Clock")}</option>
            <option value="countdown">{tr("Обратный отсчёт", "Countdown")}</option>
            <option value="ticker">{tr("Бегущая строка", "Ticker")}</option>
          </select>
        </label>

        {source?.kind === "static" ? (
          <>
            <label className="scene-row">
              <span>{tr("Значение", "Value")}</span>
              <input
                onChange={(event) => onChange({ ...node, text: { kind: "static", text: event.target.value } })}
                value={source.text}
              />
            </label>
            <button
              className="scene-declare"
              onClick={() => onDeclareField(node.id, node.name)}
              type="button"
            >
              <KeyRound size={12} /> {tr("Сделать полем шаблона", "Turn into a template field")}
            </button>
            <p className="scene-hint">
              {tr(
                "Поле — это то, что подставляет эфир. Ключ создаёт редактор: набранный руками промах не виден, и плашка молча выходит в эфир с образцом.",
                "A field is what playout fills in. The editor derives the key: a hand-typed miss is invisible until air.",
              )}
            </p>
          </>
        ) : null}

        {source?.kind === "field" && field ? (
          <div className="scene-field-bound">
            <div>
              <Link2 size={12} />
              <b>{field.label}</b>
              <code>{field.key}</code>
            </div>
            <label className="scene-row">
              <span>{tr("Образец", "Sample")}</span>
              {/* Образец живёт в объявлении поля, а не в узле: им меряется
                  привязанная плашка, и он общий для всех её потребителей. */}
              <input
                onChange={(event) => onFieldChange(field.key, { sample: event.target.value })}
                value={field.sample}
              />
            </label>
            <button onClick={() => onRemoveField(field.key)} type="button">
              <Link2Off size={12} /> {tr("Отвязать", "Unbind")}
            </button>
          </div>
        ) : null}

        {source?.kind === "clock" ? (
          <Grid>
            <label className="scene-row">
              <span>{tr("Формат", "Format")}</span>
              <select
                onChange={(event) => onChange({ ...node, text: { ...source, format: event.target.value as typeof source.format } })}
                value={source.format}
              >
                {["HH:MM:SS", "HH:MM", "MM:SS", "SS"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <Num label={tr("Пояс, мин", "TZ, min")} value={source.timezoneOffsetMinutes} raw
              onCommit={(v) => onChange({ ...node, text: { ...source, timezoneOffsetMinutes: Math.round(v) } })} />
          </Grid>
        ) : null}

        {source?.kind === "countdown" ? (
          <Grid>
            <label className="scene-row">
              <span>{tr("Отсчёт", "Counts")}</span>
              <select
                onChange={(event) => onChange({ ...node, text: { ...source, source: event.target.value as typeof source.source } })}
                value={source.source}
              >
                <option value="fixed">{tr("от заданного", "from a fixed value")}</option>
                <option value="clip-remaining">{tr("до конца ролика", "to the end of the clip")}</option>
              </select>
            </label>
            <Num label={tr("Секунд", "Seconds")} value={source.seconds} raw
              onCommit={(v) => onChange({ ...node, text: { ...source, seconds: Math.max(1, v) } })} />
          </Grid>
        ) : null}

        {source?.kind === "ticker" ? (
          <>
            <label className="scene-row">
              <span>{tr("Сообщения", "Messages")}</span>
              <textarea
                onChange={(event) => onChange({
                  ...node,
                  text: { ...source, items: event.target.value.split("\n").filter(Boolean) },
                })}
                rows={4}
                value={source.items.join("\n")}
              />
            </label>
            <Grid>
              <Num label={tr("Скорость", "Speed")} value={source.speed} unit="%"
                onCommit={(v) => onChange({ ...node, text: { ...source, speed: clamp(v, 0.001, 2) } })} />
              <label className="scene-row">
                <span>{tr("Направление", "Direction")}</span>
                <select
                  onChange={(event) => onChange({ ...node, text: { ...source, direction: event.target.value as "left" | "right" } })}
                  value={source.direction}
                >
                  <option value="left">←</option>
                  <option value="right">→</option>
                </select>
              </label>
            </Grid>
          </>
        ) : null}
      </Section>

      <Section title={tr("Шрифт", "Font")}>
        <label className="scene-row">
          <span>{tr("Файл", "File")}</span>
          <select
            onChange={(event) => {
              const font = fonts.find((entry) => entry.filePath === event.target.value);
              onChange({
                ...node,
                textStyle: {
                  ...node.textStyle,
                  fontFilePath: font?.filePath ?? null,
                  fontFamily: font?.family ?? "",
                },
              });
            }}
            value={node.textStyle.fontFilePath ?? ""}
          >
            <option value="">{tr("— не выбран —", "— none —")}</option>
            {fonts.map((font) => (
              <option key={font.filePath} value={font.filePath}>
                {font.family}{font.cyrillic ? "" : tr("  · без кириллицы", "  · no Cyrillic")}
              </option>
            ))}
          </select>
        </label>
        {!node.textStyle.fontFilePath ? (
          <p className="scene-hint scene-hint-warn">
            {tr(
              "Шрифт задаётся файлом, а не именем семейства. Без него кириллица может выйти в эфир пустыми прямоугольниками — и заметно это только на выходе.",
              "The font is a file, not a family name. Without one, Cyrillic can reach air as empty boxes.",
            )}
          </p>
        ) : null}
        <Grid>
          <Num label={tr("Кегль", "Size")} value={node.textStyle.size} unit="%"
            onCommit={(v) => onChange({ ...node, textStyle: { ...node.textStyle, size: clamp(v, 0.001, 0.4) } })} />
          <Color label={tr("Цвет", "Colour")} value={node.textStyle.color}
            onChange={(v) => onChange({ ...node, textStyle: { ...node.textStyle, color: v } })} />
          <label className="scene-row">
            <span>{tr("Выключка", "Align")}</span>
            <select
              onChange={(event) => onChange({ ...node, textStyle: { ...node.textStyle, align: event.target.value as "left" | "center" | "right" } })}
              value={node.textStyle.align}
            >
              <option value="left">{tr("влево", "left")}</option>
              <option value="center">{tr("по центру", "centre")}</option>
              <option value="right">{tr("вправо", "right")}</option>
            </select>
          </label>
          <Num label={tr("Обводка", "Stroke")} value={node.textStyle.strokeWidth} unit="%"
            onCommit={(v) => onChange({ ...node, textStyle: { ...node.textStyle, strokeWidth: clamp(v, 0, 0.02) } })} />
        </Grid>
      </Section>
    </>
  );
}

/* ------------------------------- примитивы -------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="scene-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="scene-grid">{children}</div>;
}

/**
 * Число с локальным черновиком.
 *
 * `input[type=number]` отдаёт пустую строку для незавершённого ввода — «1.»,
 * «-», «1e». Прямое `Number(value)` даёт ноль и возвращает поле назад: набрать
 * дробное значение становится невозможно.
 */
function Num({
  label, value, unit, raw, onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  /** Показывать как есть, а не долей в процентах. */
  raw?: boolean;
  onCommit: (value: number) => void;
}) {
  const shown = raw ? value : value * 100;
  const [draft, setDraft] = useState(String(round(shown)));
  useEffect(() => { setDraft(String(round(raw ? value : value * 100))); }, [value, raw]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) { setDraft(String(round(shown))); return; }
    onCommit(raw ? parsed : parsed / 100);
  };

  return (
    <label className="scene-row scene-row-num">
      <span>{label}</span>
      <input
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        value={draft}
      />
      {unit ? <i>{unit}</i> : null}
    </label>
  );
}

/**
 * Цвет. Регистр не трогаем ни на входе, ни на выходе: `input[type=color]`
 * возвращает значение строчными буквами, и приведение к верхнему регистру
 * расходится с DOM — React возвращает поле назад, и пипетка перестаёт слушаться.
 */
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="scene-row scene-row-color">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} type="color" value={value} />
    </label>
  );
}

/** Хвост пути: целиком он не помещается и мешает читать остальное. */
function shortPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
