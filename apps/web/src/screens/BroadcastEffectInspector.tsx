import type {
  BroadcastEffectKind,
  BroadcastEffectSettings,
  BroadcastTextStyle,
  EffectPlacement,
  GraphicEffectAsset,
  SystemFont,
} from "@gruber/contracts";
import {
  FileJson2,
  FileVideo2,
  FolderOpen,
  KeyRound,
  Layers3,
  Rss,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  effectGraphicPolicies,
  fileOnlyEffectKinds,
  mapBroadcastTaskRecords,
  summarizeBroadcastTaskMatches,
} from "../broadcast-effects";
import {
  BroadcastJsonMappingDialog,
  type JsonMappingSummary,
  type JsonMappingTarget,
} from "../components/BroadcastJsonMappingDialog";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useI18n, type Translate } from "../i18n";

/**
 * Настройки эфирного эффекта второго уровня. У каждого вида — своё поведение,
 * поэтому у каждого свой набор полей; общее здесь только оформление текста и
 * оформление эффекта: сцена либо готовое alpha-медиа.
 */

export type BroadcastTaskSummary = JsonMappingSummary;

interface BroadcastEffectInspectorProps {
  busy: boolean;
  effect: GraphicEffectAsset;
  taskSummary: BroadcastTaskSummary | null;
  fonts: SystemFont[];
  onChange: (effect: GraphicEffectAsset) => void;
  onSelectTaskFile: () => void;
  onSelectTickerSource: () => void;
  onSelectStingerFile: () => void;
  onSelectDecorationFile: () => void;
  /** Открыть редактор титров: оформление сценой правится только там. */
  onEditScene: () => void;
  onSelectStingerSequence: () => void;
  onLoadTickerFeed: () => void;
  onApplyChanges: () => void;
  onApplyTaskToProject: () => void;
  assignedClipCount: number;
  clips: { id: string; name: string }[];
}

export const broadcastEffectCatalog: {
  kind: BroadcastEffectKind;
  title: string;
  titleRu: string;
  summary: string;
  summaryEn: string;
}[] = [
  {
    kind: "animation-in-out",
    summary: "Входная и выходная анимация ролика с привязкой файлом задания",
    summaryEn: "Clip intro and outro animation driven by a task file",
    title: "Animation in/out",
    titleRu: "Анимация входа/выхода",
  },
  {
    kind: "dynamic-title",
    summary: "Плашка с произвольным текстом из интерфейса или файла задания",
    summaryEn: "Lower third with text from the interface or a task file",
    title: "Dynamic title",
    titleRu: "Динамическая плашка",
  },
  {
    kind: "next-program",
    summary: "Плашка «Смотрите далее» с названием следующего материала",
    summaryEn: "Up-next title with the name of the following programme item",
    title: "Next program",
    titleRu: "Следующая программа",
  },
  {
    kind: "ticker-crawl",
    summary: "Бегущая строка с постоянной скоростью при любой длине текста",
    summaryEn: "Ticker crawl with constant speed for any text length",
    title: "Ticker crawl",
    titleRu: "Бегущая строка",
  },
  {
    kind: "clock-countdown",
    summary: "Экранные часы по эфирному времени или обратный отсчёт",
    summaryEn: "On-screen air-time clock or countdown",
    title: "Clock / countdown",
    titleRu: "Часы / отсчёт",
  },
  {
    kind: "stinger-transition",
    summary: "Брендированный переход, закрывающий стык двух роликов",
    summaryEn: "Branded transition covering the cut between two clips",
    title: "Stinger transition",
    titleRu: "Стингер-переход",
  },
];

export function broadcastEffectTitle(
  kind: BroadcastEffectKind,
  tr?: (russian: string, english: string) => string,
): string {
  const entry = broadcastEffectCatalog.find((candidate) => candidate.kind === kind);
  if (!entry) return kind;
  return tr ? tr(entry.titleRu, entry.title) : entry.titleRu;
}

export function BroadcastEffectInspector({
  busy,
  effect,
  taskSummary,
  fonts,
  onChange,
  onSelectTaskFile,
  onSelectTickerSource,
  onSelectStingerFile,
  onSelectStingerSequence,
  onSelectDecorationFile,
  onEditScene,
  onLoadTickerFeed,
  onApplyChanges,
  onApplyTaskToProject,
  assignedClipCount,
  clips,
}: BroadcastEffectInspectorProps) {
  const { tr } = useI18n();
  const definition = effect.broadcast;
  if (!definition) return null;
  const settings = definition.settings;
  // Правило простое и объяснимое: если сцена объявила поля — их можно
  // заполнить из JSON. Раньше список видов был зашит, и собранный титр с
  // полями всё равно не принимал файл задания.
  /**
   * Нужен ли файл задания **здесь**.
   *
   * У титра со сценой файл выбирается внизу, среди способов применения: там же,
   * где по нему раскладывают. Два места выбора одного и того же файла — верный
   * способ выбрать его не там, где потом ищут.
   */
  const usesTaskData = definition.kind === "animation-in-out";

  const updateSettings = <K extends keyof BroadcastEffectSettings>(
    key: K,
    patch: Partial<BroadcastEffectSettings[K]>,
  ) => {
    onChange({
      ...effect,
      broadcast: {
        ...definition,
        settings: { ...settings, [key]: { ...settings[key], ...patch } },
      },
    });
  };

  const updatePlacement = (placement: EffectPlacement) => {
    onChange({ ...effect, broadcast: { ...definition, placement } });
  };

  // Поля шаблона объявляет сама сцена: набрать ключ руками нельзя.
  const presetKeys = definition.scene?.fields.map((field) => field.key) ?? [];
  const responsiveKeys = new Set<string>();
  const logicalTarget =
    definition.kind === "dynamic-title"
      ? settings.dynamicTitle.dynamicKey || settings.dynamicTitle.taskKey
      : definition.kind === "next-program"
        ? settings.nextProgram.titleKey
        : definition.kind === "ticker-crawl"
          ? settings.tickerCrawl.dynamicKey
          : definition.kind === "clock-countdown"
            ? settings.clockCountdown.dynamicKey
            : "";
  const mappingTargets: JsonMappingTarget[] = (
    presetKeys.length > 0 ? presetKeys : logicalTarget ? [logicalTarget] : []
  ).map((key) => ({ key, label: key, responsive: responsiveKeys.has(key) }));
  const taskEntries = useMemo(
    () =>
      taskSummary && definition.dataMapping.filePath
        ? mapBroadcastTaskRecords(taskSummary.records, definition.dataMapping)
        : [],
    [taskSummary, definition.dataMapping],
  );
  const taskMatchSummary = useMemo(
    () => summarizeBroadcastTaskMatches(taskEntries, clips),
    [taskEntries, clips],
  );
  const [mappingOpen, setMappingOpen] = useState(false);
  const lastOpenedTaskPath = useRef<string | null>(null);
  useEffect(() => {
    if (!taskSummary?.filePath || taskSummary.filePath === lastOpenedTaskPath.current) return;
    lastOpenedTaskPath.current = taskSummary.filePath;
    setMappingOpen(true);
  }, [taskSummary?.filePath]);

  /**
   * Оформление эффекта.
   *
   * У видов со сценой оформление живёт внутри неё и правится редактором титров.
   * У Animation in/out и Stinger оформление — готовое alpha-медиа: там всё
   * решает выбранный файл.
   */
  const scene = definition.scene;
  const fileOnly = fileOnlyEffectKinds.has(definition.kind);
  const policy = effectGraphicPolicies[definition.kind];

  const decorationPicker = (label: string) => (
    <div className="broadcast-field broadcast-field-wide broadcast-preset-picker">
      <span>{label}</span>
      <div className="broadcast-decoration">
        {scene ? (
          <>
            <div className="broadcast-decoration-file">
              <span className="chosen">{scene.name}</span>
              <span className="broadcast-scene-count">
                {tr(`узлов: ${scene.nodes.length}`, `${scene.nodes.length} nodes`)}
              </span>
            </div>
            <button
              className="broadcast-edit-scene"
              disabled={busy}
              onClick={onEditScene}
              type="button"
            >
              <Layers3 size={12} /> {tr("Править в редакторе титров", "Open the title editor")}
            </button>
            <p className="broadcast-decoration-hint">
              {tr(
                "Оформление задаётся сценой: плашка, текст и анимация живут одним деревом с общим временем — поэтому текст не может появиться раньше своей подложки.",
                "The design is a scene: plate, text, and animation share one tree and one clock.",
              )}
            </p>
          </>
        ) : (
          <>
            <div className="broadcast-decoration-file">
              <button
                disabled={busy}
                onClick={onSelectDecorationFile}
                type="button"
              >
                <FolderOpen size={12} />
                {definition.decorationFilePath
                  ? tr("Заменить файл", "Replace file")
                  : tr("Выбрать файл", "Choose file")}
              </button>
              <span className={definition.decorationFilePath ? "chosen" : "missing"}>
                {definition.decorationFilePath
                  ? shortPath(definition.decorationFilePath)
                  : tr(
                      "Файл не выбран — эффект не применится",
                      "No file chosen; the effect will not apply",
                    )}
              </span>
              {fileOnly ? null : (
                <span className="broadcast-scene-count">
                  {tr("оформление файлом", "file design")}
                </span>
              )}
            </div>
            <p className="broadcast-decoration-hint">
              {tr(
                `Принимается ${policy.accepts} (${policy.extensions.join(", ")}).`,
                `Accepts ${policy.extensions.join(", ")} with an alpha channel.`,
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );

  return (
    <section className="broadcast-inspector">
      <div className="broadcast-inspector-heading">
        <span className="broadcast-tier-badge">{tr("Уровень 2", "Tier 2")}</span>
        <strong>{broadcastEffectTitle(definition.kind, tr)}</strong>
        {/* Настройки правятся после назначения, поэтому нужен явный перенос
            изменений в уже размеченные ролики. */}
        <button
          className="broadcast-save-button"
          disabled={busy || assignedClipCount === 0}
          onClick={() => {
            if (
              window.confirm(
                tr(
                  `Сохранить настройки «${effect.name}» и перенести их в ${assignedClipCount} ролик(ов)?\n\nПрежние слои этого эффекта будут заменены новыми.`,
                  `Save settings for “${effect.name}” and apply them to ${assignedClipCount} clip(s)?\n\nExisting layers of this effect will be replaced.`,
                ),
              )
            )
              onApplyChanges();
          }}
          title={
            assignedClipCount === 0
              ? tr(
                  "Эффект ещё не назначен ни одному ролику",
                  "The effect has not been assigned to any clips",
                )
              : tr(
                  `Перенести настройки в ${assignedClipCount} ролик(ов)`,
                  `Apply settings to ${assignedClipCount} clip(s)`,
                )
          }
          type="button"
        >
          <Save size={12} /> {tr("Обновить назначения", "Update assignments")}
          {assignedClipCount > 0 ? <i>{assignedClipCount}</i> : null}
        </button>
      </div>

      <div className="broadcast-workflow-rail" aria-label={tr("Настройка эффекта", "Effect setup")}>
        <span className={definition.scene || definition.decorationFilePath ? "done" : "active"}>
          <b>01</b> {tr("Оформление", "Design")}
        </span>
        <span
          className={
            !usesTaskData ? "disabled" : definition.dataMapping.filePath ? "done" : "active"
          }
        >
          <b>02</b> {tr("Данные", "Data")}
        </span>
        <span className="active">
          <b>03</b> {tr("Эфир", "Playout")}
        </span>
        <span>
          <b>04</b> {tr("Оформление", "Style")}
        </span>
      </div>

      {definition.kind === "stinger-transition" ? null : (
        <section className="broadcast-studio-card">
          <header>
            <span>01</span>
            <div>
              <strong>{tr("Шаблон и данные", "Template and data")}</strong>
              <small>
                {tr(
                  "Выберите оформление, затем свяжите JSON с Text Layer",
                  "Choose the design, then map JSON to Text Layers",
                )}
              </small>
            </div>
          </header>
          {decorationPicker(tr("Оформление", "Design"))}
          <PresetFieldsHint effect={effect} />
          {usesTaskData ? (
            <>
              <TaskFileField
                busy={busy}
                filePath={definition.dataMapping.filePath}
                mappedCount={definition.dataMapping.bindings.length}
                onClear={() =>
                  onChange({
                    ...effect,
                    broadcast: {
                      ...definition,
                      dataMapping: {
                        filePath: null,
                        matchSourceKey: definition.kind === "animation-in-out" ? "title" : "name",
                        bindings: [],
                      },
                      settings: {
                        ...settings,
                        ...(definition.kind === "animation-in-out"
                          ? {
                              animationInOut: {
                                ...settings.animationInOut,
                                taskFilePath: null,
                              },
                            }
                          : definition.kind === "dynamic-title"
                            ? {
                                dynamicTitle: {
                                  ...settings.dynamicTitle,
                                  taskFilePath: null,
                                },
                              }
                            : {
                                nextProgram: {
                                  ...settings.nextProgram,
                                  taskFilePath: null,
                                },
                              }),
                      },
                    },
                  })
                }
                onConfigure={() => setMappingOpen(true)}
                onSelect={onSelectTaskFile}
                summary={taskSummary}
              />
              <p className="broadcast-hint">
                {tr(
                  "JSON можно подключить к любому текстовому шаблону. Метка",
                  "JSON can be connected to any text template. The",
                )}{" "}
                <code>FIT READY</code>{" "}
                {tr(
                  "в Parser означает, что подложка будет менять ширину вместе с текстом.",
                  "badge in Parser means the plate changes width with the text.",
                )}
              </p>
            </>
          ) : (
            <p className="broadcast-hint">
              {definition.scene && definition.scene.fields.length > 0
                ? tr(
                    "Значения полей задаются ниже. Файл задания подключается там же, где по нему раскладывают, — в «Применении».",
                    "Field values are set below. The task file is chosen where it is used — in “Assignment”.",
                  )
                : tr(
                    "Этот эффект получает данные из собственных настроек; общий файл задания ему не нужен.",
                    "This effect reads data from its own settings and does not need a shared task file.",
                  )}
            </p>
          )}
          {definition.kind === "animation-in-out" ? (
            <div className="broadcast-task-apply">
              <div>
                <span>{tr("СОВПАДЕНИЯ ПРОЕКТА", "PROJECT MATCH")}</span>
                <strong>
                  {taskMatchSummary.matchedClipCount} {tr("ролик(ов)", "clip(s)")} ·{" "}
                  {taskMatchSummary.matchedRecordCount} {tr("записей", "records")}
                </strong>
                <small>
                  {tr("Не найдено в расписании", "Not found in schedule")}:{" "}
                  {taskMatchSummary.unmatchedRecordCount} · {tr("без JSON", "without JSON")}:{" "}
                  {taskMatchSummary.unmatchedClipCount}
                </small>
              </div>
              <button
                disabled={
                  busy ||
                  !definition.scene ||
                  !definition.dataMapping.filePath ||
                  taskMatchSummary.matchedClipCount === 0 ||
                  taskMatchSummary.duplicateTitles.length > 0
                }
                onClick={() => {
                  if (
                    window.confirm(
                      tr(
                        `Применить данные JSON к ${taskMatchSummary.matchedClipCount} ролику(ам)?\n\nСуществующие слои «${effect.name}» будут заменены, остальные эффекты сохранятся.`,
                        `Apply JSON data to ${taskMatchSummary.matchedClipCount} clip(s)?\n\nExisting “${effect.name}” layers will be replaced; other effects will remain.`,
                      ),
                    )
                  )
                    onApplyTaskToProject();
                }}
                type="button"
              >
                <Layers3 size={13} /> {tr("Применить JSON к проекту", "Apply JSON to project")}
              </button>
              {taskMatchSummary.duplicateTitles.length > 0 ? (
                <p>
                  {tr("Дубли", "Duplicate")} {definition.dataMapping.matchSourceKey}{" "}
                  {tr("в JSON", "in JSON")}:{" "}
                  {taskMatchSummary.duplicateTitles.slice(0, 3).join(", ")}.{" "}
                  {tr("Удалите неоднозначные записи.", "Remove ambiguous records.")}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
      {definition.kind === "stinger-transition" ? null : (
        <PlacementFields
          disabled={busy}
          onChange={updatePlacement}
          placement={definition.placement}
        />
      )}

      <BroadcastJsonMappingDialog
        mapping={definition.dataMapping}
        onClose={() => setMappingOpen(false)}
        onSave={(dataMapping) => {
          onChange({ ...effect, broadcast: { ...definition, dataMapping } });
          setMappingOpen(false);
        }}
        open={mappingOpen}
        summary={taskSummary}
        templateName={definition.scene?.name ?? tr("Шаблон не выбран", "No template selected")}
        targets={mappingTargets}
      />

      <section className="broadcast-studio-card broadcast-behavior-card">
        <header>
          <span>03</span>
          <div>
            <strong>{tr("Поведение в эфире", "Playout behavior")}</strong>
            <small>
              {tr(
                "Источник значения, окно показа, анимация и стиль",
                "Value source, display window, animation and style",
              )}
            </small>
          </div>
        </header>

        {definition.kind === "animation-in-out" ? (
          <>
            <div className="broadcast-grid">
              <label className="broadcast-field">
                <span>{tr("Режим", "Mode")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("animationInOut", {
                      mode: event.target.value as "in" | "out" | "in-out",
                    })
                  }
                  value={settings.animationInOut.mode}
                >
                  <option value="in">In</option>
                  <option value="out">Out</option>
                  <option value="in-out">In + Out</option>
                </select>
              </label>
              <NumberField
                disabled={busy}
                hint={tr("от начала ролика", "from clip start")}
                label={tr("Старт, с", "Start, s")}
                min={0}
                onChange={(startSeconds) => updateSettings("animationInOut", { startSeconds })}
                step={0.04}
                value={settings.animationInOut.startSeconds}
              />
              <NumberField
                disabled={busy}
                hint={tr("от конца ролика", "from clip end")}
                label={tr("Конец, с", "End, s")}
                min={0}
                onChange={(endSeconds) => updateSettings("animationInOut", { endSeconds })}
                step={0.04}
                value={settings.animationInOut.endSeconds}
              />
              <NumberField
                disabled={busy}
                label={tr("Длительность, с", "Duration, s")}
                min={0.04}
                onChange={(durationSeconds) =>
                  updateSettings("animationInOut", { durationSeconds })
                }
                step={0.04}
                value={settings.animationInOut.durationSeconds}
              />
            </div>
          </>
        ) : null}

        {definition.kind === "dynamic-title" ? (
          <>
            {/* Значения полей — по одному на поле, объявленное сценой. Пара
                «строка плюс подпись» перестала описывать титр, как только
                плашку стало можно собрать самому. Откуда значения возьмутся,
                решает не селектор, а кнопка применения внизу: лишний
                переключатель оператор забывает переставить. */}
            {definition.scene && definition.scene.fields.length > 0 ? (
              <div className="broadcast-grid">
                {definition.scene.fields.map((field) => (
                  <TextField
                    disabled={busy}
                    hint={settings.dynamicTitle.source === "task-file"
                      ? tr("резерв, если в записи нет ключа", "fallback when the record lacks the key")
                      : field.key}
                    key={field.key}
                    label={field.label || field.key}
                    onChange={(value) => updateSettings("dynamicTitle", {
                      fieldValues: { ...settings.dynamicTitle.fieldValues, [field.key]: value },
                    })}
                    value={settings.dynamicTitle.fieldValues[field.key]
                      ?? legacyFieldValue(field.key, settings.dynamicTitle)}
                  />
                ))}
              </div>
            ) : definition.scene ? (
              <p className="broadcast-hint">
                {tr(
                  "В сцене нет полей: подставлять в неё нечего. Объявите поля в редакторе титров.",
                  "The scene declares no fields. Declare them in the title editor.",
                )}
              </p>
            ) : null}
            <div className="broadcast-grid">
              <NumberField
                disabled={busy}
                hint={tr("от начала ролика", "from clip start")}
                label={tr("Старт, с", "Start, s")}
                min={0}
                onChange={(startSeconds) => updateSettings("dynamicTitle", { startSeconds })}
                step={0.04}
                value={settings.dynamicTitle.startSeconds}
              />
              <NumberField
                disabled={busy}
                label={tr("Длительность, с", "Duration, s")}
                min={0.04}
                onChange={(durationSeconds) => updateSettings("dynamicTitle", { durationSeconds })}
                step={0.04}
                value={settings.dynamicTitle.durationSeconds}
              />
            </div>
            {definition.decorationFilePath ? (
              <div className="broadcast-grid">
                <PresetKeyField
                  busy={busy}
                  hint={tr(
                    "этот Text Layer очищается; реальный текст рисует FFmpeg",
                    "this Text Layer is cleared; FFmpeg draws the live text",
                  )}
                  keys={presetKeys}
                  label={tr("Поле для текста", "Text field")}
                  onChange={(dynamicKey) => updateSettings("dynamicTitle", { dynamicKey })}
                  value={settings.dynamicTitle.dynamicKey}
                />
                <PresetKeyField
                  busy={busy}
                  hint={tr("необязательная постоянная подпись", "optional fixed caption")}
                  keys={presetKeys}
                  label={tr("Поле подписи", "Caption field")}
                  onChange={(captionKey) => updateSettings("dynamicTitle", { captionKey })}
                  value={settings.dynamicTitle.captionKey}
                />
                <TextField
                  disabled={busy}
                  label={tr("Текст подписи", "Caption text")}
                  onChange={(captionText) => updateSettings("dynamicTitle", { captionText })}
                  value={settings.dynamicTitle.captionText}
                />
                <p className="broadcast-hint broadcast-field-wide">
                  {tr(
                    "Назовите Shape Layer подложки в After Effects",
                    "Name the plate Shape Layer in After Effects",
                  )}{" "}
                  <code>fit:&lt;{tr("имя текстового слоя", "text layer name")}&gt;</code> —{" "}
                  {tr(
                    "при каждом значении её ширина сохранит исходные внутренние отступы.",
                    "its width will preserve the original padding for every value.",
                  )}
                </p>
              </div>
            ) : null}
            <TextStyleFields
              busy={busy}
              fonts={fonts}
              onChange={(style) => updateSettings("dynamicTitle", { style })}
              style={settings.dynamicTitle.style}
            />
          </>
        ) : null}

        {definition.kind === "next-program" ? (
          <>
            <div className="broadcast-grid">
              <NumberField
                disabled={busy}
                hint={tr("до конца ролика", "before clip end")}
                label={tr("Смещение старта, с", "Start offset, s")}
                min={0.04}
                onChange={(startOffsetSeconds) =>
                  updateSettings("nextProgram", { startOffsetSeconds })
                }
                step={0.5}
                value={settings.nextProgram.startOffsetSeconds}
              />
              <NumberField
                disabled={busy}
                label={tr("Длительность, с", "Duration, s")}
                min={0.04}
                onChange={(durationSeconds) => updateSettings("nextProgram", { durationSeconds })}
                step={0.5}
                value={settings.nextProgram.durationSeconds}
              />
              <label className="broadcast-field">
                <span>{tr("Источник названия", "Title source")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("nextProgram", {
                      source: event.target.value as "playlist-name" | "task-file",
                    })
                  }
                  value={settings.nextProgram.source}
                >
                  <option value="playlist-name">
                    {tr("Следующий ролик плейлиста", "Next playlist clip")}
                  </option>
                  <option value="task-file">
                    {tr("Файл задания, ключ next_title", "Task file, next_title key")}
                  </option>
                </select>
              </label>
              <PresetKeyField
                busy={busy}
                hint={tr(
                  "поле очищается; название рисует FFmpeg",
                  "field is cleared; FFmpeg draws the title",
                )}
                keys={presetKeys}
                label={tr("Поле названия", "Title field")}
                onChange={(titleKey) => updateSettings("nextProgram", { titleKey })}
                value={settings.nextProgram.titleKey}
              />
              <PresetKeyField
                busy={busy}
                hint={tr("необязательно", "optional")}
                keys={presetKeys}
                label={tr("Поле подзаголовка", "Subtitle field")}
                onChange={(subtitleKey) => updateSettings("nextProgram", { subtitleKey })}
                value={settings.nextProgram.subtitleKey}
              />
              <TextField
                disabled={busy}
                label={tr("Подзаголовок", "Subtitle")}
                onChange={(subtitleText) => updateSettings("nextProgram", { subtitleText })}
                value={settings.nextProgram.subtitleText}
              />
              <TextField
                disabled={busy}
                hint={tr(
                  "показывается на последнем ролике; пусто — эффект пропускается",
                  "shown on the last clip; empty skips the effect",
                )}
                label={tr("Резервный текст", "Fallback text")}
                onChange={(fallbackTitle) => updateSettings("nextProgram", { fallbackTitle })}
                value={settings.nextProgram.fallbackTitle}
              />
              {definition.decorationFilePath ? (
                <p className="broadcast-hint broadcast-field-wide">
                  {tr(
                    "Назовите Shape Layer подложки в After Effects",
                    "Name the plate Shape Layer in After Effects",
                  )}{" "}
                  <code>fit:&lt;{tr("имя поля названия", "title field name")}&gt;</code>.{" "}
                  {tr(
                    "FluxIO очистит шаблонный текст, нарисует реальное название через FFmpeg и пересчитает ширину подложки, сохранив исходные отступы.",
                    "FluxIO will clear the template text, draw the live title with FFmpeg and resize the plate while preserving its original padding.",
                  )}
                </p>
              ) : null}
            </div>
            <TextStyleFields
              busy={busy}
              fonts={fonts}
              onChange={(style) => updateSettings("nextProgram", { style })}
              style={settings.nextProgram.style}
            />
          </>
        ) : null}

        {definition.kind === "ticker-crawl" ? (
          <>
            <div className="broadcast-grid">
              <label className="broadcast-field">
                <span>{tr("Источник текста", "Text source")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("tickerCrawl", {
                      source: event.target.value as "manual" | "file",
                    })
                  }
                  value={settings.tickerCrawl.source}
                >
                  <option value="manual">{tr("Вручную", "Manual")}</option>
                  <option value="file">{tr("Файл .json / .txt", ".json / .txt file")}</option>
                  <option value="feed">{tr("RSS / Atom-лента", "RSS / Atom feed")}</option>
                </select>
              </label>
              <NumberField
                disabled={busy}
                hint={tr("пикселей кадра в секунду", "frame pixels per second")}
                label={tr("Скорость", "Speed")}
                min={1}
                onChange={(speedPixelsPerSecond) =>
                  updateSettings("tickerCrawl", { speedPixelsPerSecond })
                }
                step={10}
                value={settings.tickerCrawl.speedPixelsPerSecond}
              />
              <label className="broadcast-field">
                <span>{tr("Направление", "Direction")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("tickerCrawl", {
                      direction: event.target.value as "left" | "right",
                    })
                  }
                  value={settings.tickerCrawl.direction}
                >
                  <option value="left">{tr("Справа налево", "Right to left")}</option>
                  <option value="right">{tr("Слева направо", "Left to right")}</option>
                </select>
              </label>
              <NumberField
                disabled={busy}
                hint={tr("0 — крутить непрерывно", "0 — loop continuously")}
                label={tr("Повторов", "Repeats")}
                min={0}
                onChange={(repeat) => updateSettings("tickerCrawl", { repeat: Math.round(repeat) })}
                step={1}
                value={settings.tickerCrawl.repeat}
              />
              <NumberField
                disabled={busy}
                label={tr("Старт, с", "Start, s")}
                min={0}
                onChange={(startSeconds) => updateSettings("tickerCrawl", { startSeconds })}
                step={1}
                value={settings.tickerCrawl.startSeconds}
              />
              <NumberField
                disabled={busy}
                label={tr("Длительность, с", "Duration, s")}
                min={0.04}
                onChange={(durationSeconds) => updateSettings("tickerCrawl", { durationSeconds })}
                step={1}
                value={settings.tickerCrawl.durationSeconds}
              />
              <TextField
                disabled={busy}
                hint={tr(
                  "ставится между сообщениями и замыкает круг",
                  "inserted between messages and closes the loop",
                )}
                label={tr("Разделитель", "Separator")}
                onChange={(separator) => updateSettings("tickerCrawl", { separator })}
                value={settings.tickerCrawl.separator}
              />
              <NumberField
                disabled={busy}
                hint={tr("левый край полосы, % кадра", "left edge of strip, % of frame")}
                label={tr("Полоса: X", "Strip: X")}
                max={100}
                min={0}
                onChange={(regionXPercent) => updateSettings("tickerCrawl", { regionXPercent })}
                step={1}
                value={settings.tickerCrawl.regionXPercent}
              />
              <NumberField
                disabled={busy}
                hint={tr("100 — во весь кадр", "100 — full frame width")}
                label={tr("Полоса: ширина", "Strip: width")}
                max={100}
                min={1}
                onChange={(regionWidthPercent) =>
                  updateSettings("tickerCrawl", { regionWidthPercent })
                }
                step={1}
                value={settings.tickerCrawl.regionWidthPercent}
              />
            </div>
            {settings.tickerCrawl.source === "feed" ? (
              <div className="broadcast-file-field">
                <span>{tr("Адрес ленты", "Feed URL")}</span>
                <input
                  className="broadcast-feed-url"
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("tickerCrawl", {
                      feedUrl: event.target.value,
                    })
                  }
                  placeholder="https://example.com/rss"
                  type="url"
                  value={settings.tickerCrawl.feedUrl}
                />
                <button
                  disabled={busy || !settings.tickerCrawl.feedUrl}
                  onClick={onLoadTickerFeed}
                  type="button"
                >
                  <Rss size={12} /> {tr("Загрузить", "Load")}
                </button>
                <em className="broadcast-hint">
                  {tr("Загружено заголовков", "Loaded headlines")}:{" "}
                  {settings.tickerCrawl.items.length}.{" "}
                  {tr(
                    "Ленту загружает media-service — нажмите «Загрузить» ещё раз, чтобы обновить новости.",
                    "The media service fetches the feed — click Load again to refresh the news.",
                  )}
                </em>
              </div>
            ) : settings.tickerCrawl.source === "file" ? (
              <div className="broadcast-file-field">
                <span>{tr("Файл сообщений", "Message file")}</span>
                <strong title={settings.tickerCrawl.filePath ?? undefined}>
                  {settings.tickerCrawl.filePath
                    ? `${shortPath(settings.tickerCrawl.filePath)} · ${settings.tickerCrawl.items.length} ${tr("сообщений", "messages")}`
                    : tr("Не выбран", "Not selected")}
                </strong>
                <button disabled={busy} onClick={onSelectTickerSource} type="button">
                  <FolderOpen size={12} />{" "}
                  {settings.tickerCrawl.filePath
                    ? tr("Обновить", "Refresh")
                    : tr("Выбрать", "Select")}
                </button>
              </div>
            ) : (
              <label className="broadcast-field broadcast-field-wide">
                <span>{tr("Сообщения — по одному в строке", "Messages — one per line")}</span>
                <textarea
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("tickerCrawl", {
                      items: event.target.value.split("\n"),
                    })
                  }
                  rows={4}
                  value={settings.tickerCrawl.items.join("\n")}
                />
              </label>
            )}
            {definition.decorationFilePath ? (
              <div className="broadcast-grid">
                <PresetKeyField
                  busy={busy}
                  hint={tr("сюда встанет бегущая строка", "ticker text is placed here")}
                  keys={presetKeys}
                  label={tr("Поле для значения", "Value field")}
                  onChange={(dynamicKey) => updateSettings("tickerCrawl", { dynamicKey })}
                  value={settings.tickerCrawl.dynamicKey}
                />
                <PresetKeyField
                  busy={busy}
                  hint={tr("постоянная подпись на подложке", "fixed caption on the plate")}
                  keys={presetKeys}
                  label={tr("Поле подписи в пресете", "Preset caption field")}
                  onChange={(captionKey) => updateSettings("tickerCrawl", { captionKey })}
                  value={settings.tickerCrawl.captionKey}
                />
                <TextField
                  disabled={busy}
                  label={tr("Текст подписи", "Caption text")}
                  onChange={(captionText) => updateSettings("tickerCrawl", { captionText })}
                  value={settings.tickerCrawl.captionText}
                />
                <p className="broadcast-hint broadcast-field-wide">
                  {settings.tickerCrawl.dynamicKey
                    ? tr(
                        "Поле шаблона очищается, а значение встаёт на его место — с тем же кеглем, цветом и выключкой. Бегущая строка едет внутри полосы: задайте её X и ширину по размеру плашки, иначе текст поедет по всему кадру.",
                        "The template field is cleared and the value takes its place with the same font size, color and alignment. The ticker moves inside the strip: set its X and width to match the plate, otherwise it will travel across the entire frame.",
                      )
                    : tr(
                        "Выберите поле, чтобы значение эффекта встало внутрь плашки, а не поверх неё.",
                        "Select a field so the effect value appears inside the plate instead of over it.",
                      )}
                </p>
              </div>
            ) : null}
            <TextStyleFields
              busy={busy}
              fonts={fonts}
              onChange={(style) => updateSettings("tickerCrawl", { style })}
              style={settings.tickerCrawl.style}
            />
          </>
        ) : null}

        {definition.kind === "clock-countdown" ? (
          <>
            <div className="broadcast-grid">
              <label className="broadcast-field">
                <span>{tr("Режим", "Mode")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("clockCountdown", {
                      mode: event.target.value as "clock" | "countdown",
                    })
                  }
                  value={settings.clockCountdown.mode}
                >
                  <option value="clock">{tr("Часы", "Clock")}</option>
                  <option value="countdown">{tr("Обратный отсчёт", "Countdown")}</option>
                </select>
              </label>
              <label className="broadcast-field">
                <span>{tr("Формат", "Format")}</span>
                <select
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("clockCountdown", {
                      format: event.target.value as "HH:MM:SS" | "HH:MM" | "MM:SS" | "SS",
                    })
                  }
                  value={settings.clockCountdown.format}
                >
                  <option value="HH:MM:SS">HH:MM:SS</option>
                  <option value="HH:MM">HH:MM</option>
                  <option value="MM:SS">MM:SS</option>
                  <option value="SS">SS</option>
                </select>
              </label>
              {settings.clockCountdown.mode === "clock" ? (
                <NumberField
                  disabled={busy}
                  hint={tr("минут относительно UTC", "minutes relative to UTC")}
                  label={tr("Часовой пояс", "Time zone")}
                  min={-840}
                  onChange={(timezoneOffsetMinutes) =>
                    updateSettings("clockCountdown", {
                      timezoneOffsetMinutes: Math.round(timezoneOffsetMinutes),
                    })
                  }
                  step={30}
                  value={settings.clockCountdown.timezoneOffsetMinutes}
                />
              ) : (
                <>
                  <label className="broadcast-field">
                    <span>{tr("Что отсчитываем", "Countdown source")}</span>
                    <select
                      disabled={busy}
                      onChange={(event) =>
                        updateSettings("clockCountdown", {
                          countdownSource: event.target.value as "fixed" | "clip-remaining",
                        })
                      }
                      value={settings.clockCountdown.countdownSource}
                    >
                      <option value="clip-remaining">
                        {tr("До конца ролика", "Until clip end")}
                      </option>
                      <option value="fixed">
                        {tr("Заданное число секунд", "Fixed number of seconds")}
                      </option>
                    </select>
                  </label>
                  {settings.clockCountdown.countdownSource === "fixed" ? (
                    <NumberField
                      disabled={busy}
                      hint={tr("с какого значения идёт отсчёт", "initial countdown value")}
                      label={tr("Длительность отсчёта, с", "Countdown duration, s")}
                      min={1}
                      onChange={(countdownSeconds) =>
                        updateSettings("clockCountdown", { countdownSeconds })
                      }
                      step={1}
                      value={settings.clockCountdown.countdownSeconds}
                    />
                  ) : null}
                </>
              )}
              <NumberField
                disabled={busy}
                hint={tr("от начала ролика", "from clip start")}
                label={tr("Старт, с", "Start, s")}
                min={0}
                onChange={(startSeconds) => updateSettings("clockCountdown", { startSeconds })}
                step={1}
                value={settings.clockCountdown.startSeconds}
              />
              {settings.clockCountdown.mode === "countdown" &&
              settings.clockCountdown.countdownSource === "clip-remaining" ? null : (
                <NumberField
                  disabled={busy}
                  label={tr("Длительность, с", "Duration, s")}
                  min={0.04}
                  onChange={(durationSeconds) =>
                    updateSettings("clockCountdown", { durationSeconds })
                  }
                  step={1}
                  value={settings.clockCountdown.durationSeconds}
                />
              )}
            </div>
            {settings.clockCountdown.mode === "countdown" &&
            settings.clockCountdown.countdownSource === "clip-remaining" ? (
              <p className="broadcast-hint">
                {tr(
                  "Отсчёт считается по хронометражу каждого ролика отдельно и приходит в ноль ровно на его конце, поэтому окно показа задаётся автоматически — от старта и до конца ролика.",
                  "The countdown uses each clip's duration separately and reaches zero exactly at its end, so the display window is set automatically from Start to the end of the clip.",
                )}
              </p>
            ) : null}
            {definition.decorationFilePath ? (
              <div className="broadcast-grid">
                <PresetKeyField
                  busy={busy}
                  hint={tr("сюда встанут часы или отсчёт", "clock or countdown is placed here")}
                  keys={presetKeys}
                  label={tr("Поле для значения", "Value field")}
                  onChange={(dynamicKey) => updateSettings("clockCountdown", { dynamicKey })}
                  value={settings.clockCountdown.dynamicKey}
                />
                <PresetKeyField
                  busy={busy}
                  hint={tr("постоянная подпись на подложке", "fixed caption on the plate")}
                  keys={presetKeys}
                  label={tr("Поле подписи в пресете", "Preset caption field")}
                  onChange={(captionKey) => updateSettings("clockCountdown", { captionKey })}
                  value={settings.clockCountdown.captionKey}
                />
                <TextField
                  disabled={busy}
                  label={tr("Текст подписи", "Caption text")}
                  onChange={(captionText) => updateSettings("clockCountdown", { captionText })}
                  value={settings.clockCountdown.captionText}
                />
                <p className="broadcast-hint broadcast-field-wide">
                  {settings.clockCountdown.dynamicKey
                    ? tr(
                        "Значение подставляется в объявленное поле сцены.",
                        "The value goes into the declared scene field.",
                      )
                    : tr(
                        "Выберите поле, чтобы значение эффекта встало внутрь плашки, а не поверх неё.",
                        "Select a field so the effect value appears inside the plate instead of over it.",
                      )}
                </p>
              </div>
            ) : null}
            <TextStyleFields
              busy={busy}
              fonts={fonts}
              onChange={(style) => updateSettings("clockCountdown", { style })}
              style={settings.clockCountdown.style}
            />
          </>
        ) : null}

        {definition.kind === "stinger-transition" ? (
          <>
            <div className="broadcast-file-field">
              <span>
                {tr("Файл перехода с альфа-каналом", "Transition file with alpha channel")}
              </span>
              <strong title={settings.stingerTransition.assetPath ?? undefined}>
                {settings.stingerTransition.assetPath
                  ? shortPath(settings.stingerTransition.assetPath)
                  : tr("Не выбран", "Not selected")}
              </strong>
              <button disabled={busy} onClick={onSelectStingerSequence} type="button">
                <Layers3 size={12} /> {tr("Последовательность .png", "PNG sequence")}
              </button>
              <button disabled={busy} onClick={onSelectStingerFile} type="button">
                <FileVideo2 size={12} />{" "}
                {settings.stingerTransition.assetPath
                  ? tr("Заменить", "Replace")
                  : tr("Выбрать", "Select")}
              </button>
              {settings.stingerTransition.assetPath ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    updateSettings("stingerTransition", {
                      assetPath: null,
                      sourceFrameRate: null,
                      sourceHasAlpha: null,
                      sourceHasAudio: null,
                      sourcePixelFormat: null,
                    })
                  }
                  title={tr("Снять файл перехода", "Remove the transition file")}
                  type="button"
                >
                  <RotateCcw size={12} />
                </button>
              ) : null}
              <em className="broadcast-hint">
                {settings.stingerTransition.assetPath
                  ? tr("Переход берётся из этого файла.", "The transition uses this file.")
                  : tr(
                      "Без файла переход не применится: укажите .mov с альфой.",
                      "Without a file the transition will not apply: choose a .mov with alpha.",
                    )}
              </em>
              {settings.stingerTransition.assetPath ? (
                <div className="stinger-source-facts">
                  {settings.stingerTransition.sourceKind === "sequence" ? (
                    <span>
                      {settings.stingerTransition.sequenceFrameCount ?? "—"}{" "}
                      {tr("кадр(ов)", "frame(s)")}
                      {settings.stingerTransition.sequenceStartNumber != null
                        ? ` ${tr("с", "from")} #${settings.stingerTransition.sequenceStartNumber}`
                        : ""}
                    </span>
                  ) : null}
                  <span>{settings.stingerTransition.sourceFrameRate?.toFixed(2) ?? "—"} fps</span>
                  <span>{settings.stingerTransition.sourcePixelFormat ?? "pixel format —"}</span>
                  <span className={settings.stingerTransition.sourceHasAlpha ? "ok" : "warning"}>
                    alpha{" "}
                    {settings.stingerTransition.sourceHasAlpha
                      ? tr("есть", "present")
                      : tr("не обнаружена", "not detected")}
                  </span>
                  <span className={settings.stingerTransition.sourceHasAudio ? "ok" : "muted"}>
                    audio{" "}
                    {settings.stingerTransition.sourceHasAudio
                      ? tr("есть", "present")
                      : tr("нет", "none")}
                  </span>
                </div>
              ) : null}
              {settings.stingerTransition.sourceKind === "sequence" ? (
                <>
                  <NumberField
                    disabled={busy}
                    label={tr("Частота кадров последовательности", "Sequence frame rate")}
                    max={240}
                    min={1}
                    onChange={(sourceFrameRate) => {
                      const frames = settings.stingerTransition.sequenceFrameCount;
                      const durationSeconds = frames
                        ? Math.min(30, Math.max(0.04, frames / Math.max(1, sourceFrameRate)))
                        : settings.stingerTransition.durationSeconds;
                      updateSettings("stingerTransition", {
                        sourceFrameRate,
                        durationSeconds,
                        // Точка разреза обязана остаться внутри перехода: смена
                        // частоты меняет его длину, а не только скорость.
                        cutPointSeconds: Math.min(
                          settings.stingerTransition.cutPointSeconds,
                          Math.max(1 / Math.max(1, sourceFrameRate), durationSeconds / 2),
                        ),
                      });
                    }}
                    step={1}
                    value={settings.stingerTransition.sourceFrameRate ?? 25}
                  />
                  <em className="broadcast-hint">
                    {tr(
                      "В самих .png частоты кадров нет — длительность перехода считается как число кадров, делённое на это значение.",
                      "PNG files carry no frame rate; the transition length is the frame count divided by this value.",
                    )}
                  </em>
                </>
              ) : null}
              {settings.stingerTransition.assetPath &&
              settings.stingerTransition.blendMode === "alpha" &&
              settings.stingerTransition.sourceHasAlpha === false ? (
                <em className="broadcast-warning">
                  {tr(
                    "Альфа-канал не обнаружен. Выберите Luma или подготовьте файл с alpha.",
                    "Alpha channel was not detected. Select Luma or prepare a file with alpha.",
                  )}
                </em>
              ) : null}
            </div>
            <div className="broadcast-grid">
              <NumberField
                disabled={busy}
                label={tr("Длительность, с", "Duration, s")}
                max={30}
                min={0.08}
                onChange={(durationSeconds) =>
                  updateSettings("stingerTransition", { durationSeconds })
                }
                step={0.04}
                value={settings.stingerTransition.durationSeconds}
              />
              <NumberField
                disabled={busy}
                hint={tr("момент полного перекрытия кадра", "moment the frame is fully covered")}
                label={tr("Точка склейки, с", "Cut point, s")}
                max={Math.max(0.04, settings.stingerTransition.durationSeconds - 0.001)}
                min={0.04}
                onChange={(cutPointSeconds) =>
                  updateSettings("stingerTransition", { cutPointSeconds })
                }
                step={0.04}
                value={settings.stingerTransition.cutPointSeconds}
              />
              <label className="broadcast-field">
                <span>{tr("Режим наложения", "Blend mode")}</span>
                <select
                  disabled={
                    busy ||
                    Boolean(
                      settings.stingerTransition.assetPath &&
                      settings.stingerTransition.sourceHasAudio === false,
                    )
                  }
                  onChange={(event) =>
                    updateSettings("stingerTransition", {
                      blendMode: event.target.value as "alpha" | "luma",
                    })
                  }
                  value={settings.stingerTransition.blendMode}
                >
                  <option value="alpha">
                    {tr("Alpha — у файла есть альфа-канал", "Alpha — file has an alpha channel")}
                  </option>
                  <option value="luma">
                    {tr("Luma — вырезать чёрный фон", "Luma — remove black background")}
                  </option>
                </select>
              </label>
              {settings.stingerTransition.blendMode === "luma" ? (
                <NumberField
                  disabled={busy}
                  hint={tr(
                    "ниже этой яркости — фон",
                    "values below this brightness are background",
                  )}
                  label={tr("Порог яркости", "Luma threshold")}
                  max={1}
                  min={0}
                  onChange={(lumaThreshold) =>
                    updateSettings("stingerTransition", { lumaThreshold })
                  }
                  step={0.01}
                  value={settings.stingerTransition.lumaThreshold}
                />
              ) : null}
              <label className="broadcast-field broadcast-field-checkbox">
                <span>{tr("Подмешивать звук перехода", "Mix transition audio")}</span>
                <input
                  checked={settings.stingerTransition.audioEnabled}
                  disabled={busy}
                  onChange={(event) =>
                    updateSettings("stingerTransition", {
                      audioEnabled: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
              </label>
              {settings.stingerTransition.audioEnabled ? (
                <NumberField
                  disabled={busy}
                  hint={tr("относительно авторского уровня", "relative to the original level")}
                  label={tr("Уровень звука, дБ", "Audio level, dB")}
                  max={12}
                  min={-60}
                  onChange={(audioLevelDb) => updateSettings("stingerTransition", { audioLevelDb })}
                  step={1}
                  value={settings.stingerTransition.audioLevelDb}
                />
              ) : null}
            </div>
            <p className="broadcast-note">
              {tr(
                "Переход режется по точке склейки: кадры до неё ложатся на хвост выбранного ролика, кадры после — на голову следующего. Переключение источника остаётся штатным стыком плейлиста, поэтому длительность расписания не меняется. Обе величины округляются до границы кадра проекта.",
                "The transition is split at the cut point: frames before it cover the tail of the selected clip and frames after it cover the head of the next clip. Source switching remains the regular playlist cut, so schedule duration does not change. Both values are rounded to the project frame grid.",
              )}
            </p>
          </>
        ) : null}
      </section>
    </section>
  );
}

/**
 * Поля шаблона, которые заполняет эффект.
 *
 * Ключи объявляет сама сцена — набрать их руками нельзя, а значит и
 * промахнуться нельзя. Раньше это были имена слоёв из After Effects, и промах
 * молча выпускал в эфир шаблонный текст.
 */
function PresetFieldsHint({ effect }: { effect: GraphicEffectAsset }) {
  const { tr } = useI18n();
  const scene = effect.broadcast?.scene;
  if (!scene) return null;
  if (scene.fields.length === 0) {
    return (
      <p className="broadcast-hint">
        {tr(
          `В сцене «${scene.name}» нет полей: подставлять в неё нечего.`,
          `Scene “${scene.name}” declares no fields, so nothing can be substituted.`,
        )}
      </p>
    );
  }
  return (
    <details className="preset-fields" open>
      <summary>
        <KeyRound size={11} /> {tr("Поля сцены", "Scene fields")} «{scene.name}» —{" "}
        {scene.fields.length}
      </summary>
      <table>
        <thead>
          <tr>
            <th>{tr("Ключ", "Key")}</th>
            <th>{tr("Назначение", "Purpose")}</th>
            <th>{tr("Образец", "Sample")}</th>
          </tr>
        </thead>
        <tbody>
          {scene.fields.map((field) => (
            <tr key={field.key}>
              <td>
                <code>{field.key}</code>
              </td>
              <td>{field.label}</td>
              <td>{field.sample || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="preset-fields-note">
        {tr(
          "Это то, что подставляет эфир. Свяжите их с полями файла задания — и одна операция разложит титры по всем роликам, чьё имя совпало с записью JSON.",
          "These are what playout fills in. Map them to the task file, and one action lays titles across every clip whose name matches a JSON record.",
        )}
      </p>
    </details>
  );
}

/** Ключ поля выбирается из реального набора пресета, а не набирается руками. */
function PresetKeyField({
  busy,
  hint,
  keys,
  label,
  onChange,
  value,
}: {
  busy: boolean;
  hint?: string;
  keys: string[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactNode {
  const { tr } = useI18n();
  // Пресета ещё нет — оставляем ручной ввод, иначе поле нечем заполнить.
  if (keys.length === 0) {
    return (
      <TextField disabled={busy} hint={hint} label={label} onChange={onChange} value={value} />
    );
  }
  const missing = Boolean(value) && !keys.includes(value);
  return (
    <label className="broadcast-field">
      <span>
        {label}
        {hint ? <i>{hint}</i> : null}
      </span>
      <select
        className={missing ? "broadcast-field-invalid" : ""}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        value={missing ? "" : value}
      >
        <option value="">— {tr("не подставлять", "do not substitute")} —</option>
        {keys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
        {missing ? (
          <option value={value}>
            {value} — {tr("в пресете нет", "missing from preset")}
          </option>
        ) : null}
      </select>
    </label>
  );
}

function TaskFileField({
  busy,
  filePath,
  mappedCount,
  summary,
  onClear,
  onConfigure,
  onSelect,
}: {
  busy: boolean;
  filePath: string | null;
  mappedCount: number;
  summary: BroadcastTaskSummary | null;
  onClear: () => void;
  onConfigure: () => void;
  onSelect: () => void;
}) {
  const { tr } = useI18n();
  const matched = summary && summary.filePath === filePath ? summary : null;
  return (
    <div className="broadcast-file-field">
      <span>{tr("Файл задания .json", ".json task file")}</span>
      <strong title={filePath ?? undefined}>
        {filePath
          ? `${shortPath(filePath)}${matched ? ` · ${matched.entryCount} ${tr("записей", "records")}` : ""}`
          : tr(
              "Не выбран · поля берут значения шаблона",
              "Not selected · fields use template values",
            )}
      </strong>
      <button disabled={busy} onClick={onSelect} type="button">
        <FileJson2 size={12} /> {filePath ? tr("Обновить", "Refresh") : tr("Выбрать", "Select")}
      </button>
      {matched ? (
        <button className="json-parser-button" disabled={busy} onClick={onConfigure} type="button">
          <KeyRound size={12} /> JSON Parser · {mappedCount}
        </button>
      ) : null}
      {filePath ? (
        <button
          disabled={busy}
          onClick={onClear}
          title={tr("Снять файл задания", "Remove task file")}
          type="button"
        >
          <RotateCcw size={12} />
        </button>
      ) : null}
      {matched?.warnings.map((warning) => (
        <em className="broadcast-warning" key={warning}>
          {warning}
        </em>
      ))}
    </div>
  );
}

/**
 * Предпросмотр эффекта.
 *
 * Кадр рисуется средствами браузера, а не FFmpeg, поэтому это приближение:
 * шрифт, цвета, положение, скорость строки и ход часов совпадают с эфиром,
 * а сглаживание и кернинг могут отличаться. Смысл в том, чтобы оператор увидел
 * поведение эффекта — куда он встанет и как поедет — не запуская эфир.
 */
export function BroadcastEffectPreview({
  disabled,
  effect,
  onPlacementChange,
}: {
  disabled: boolean;
  effect: GraphicEffectAsset;
  onPlacementChange: (placement: EffectPlacement) => void;
}) {
  const { tr } = useI18n();
  const definition = effect.broadcast;
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    placement: EffectPlacement;
  } | null>(null);
  // Пока идёт протяжка, значение живёт локально: запись в библиотеку на каждое
  // движение мыши перерисовывала бы весь инспектор вместе с селектором шрифтов.
  const [draft, setDraft] = useState<EffectPlacement | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);

  const dynamic = definition?.kind === "clock-countdown";
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      setElapsed((current) => (current + 0.25) % 3_600);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  if (!definition) return null;
  const settings = definition.settings;
  const placement = draft ?? definition.placement;

  const baseStyle =
    definition.kind === "ticker-crawl"
      ? settings.tickerCrawl.style
      : definition.kind === "clock-countdown"
        ? settings.clockCountdown.style
        : definition.kind === "dynamic-title"
          ? settings.dynamicTitle.style
          : settings.nextProgram.style;
  // В превью графика показывается там же, где выйдет в эфир: сдвиг ложится и на
  // плашку, и на надпись — в FFmpeg они двигаются вместе.
  const style: BroadcastTextStyle = {
    ...baseStyle,
    xPercent: clampPlacement(baseStyle.xPercent + placement.offsetXPercent, -100, 200),
    yPercent: clampPlacement(baseStyle.yPercent + placement.offsetYPercent, -100, 200),
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Захват указателя нужен, чтобы протяжка не срывалась за краем кадра. Он
    // недоступен для событий без настоящего указателя, и это не повод падать.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указателя нет — тянем без захвата.
    }
    drag.current = { placement, x: event.clientX, y: event.clientY };
    setDraft(placement);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!origin || !box || box.width === 0 || box.height === 0) return;
    setDraft({
      offsetXPercent: clampPlacement(
        origin.placement.offsetXPercent + ((event.clientX - origin.x) / box.width) * 100,
      ),
      offsetYPercent: clampPlacement(
        origin.placement.offsetYPercent + ((event.clientY - origin.y) / box.height) * 100,
      ),
    });
  };
  const endDrag = () => {
    const next = draft;
    drag.current = null;
    setDraft(null);
    if (next) onPlacementChange(next);
  };

  const textStyle = {
    background: style.boxEnabled
      ? `${style.boxColor}${Math.round(style.boxOpacity * 255)
          .toString(16)
          .padStart(2, "0")}`
      : "transparent",
    color: style.color,
    fontFamily: style.fontFamily ? `"${style.fontFamily}", sans-serif` : "sans-serif",
    fontSize: `${style.fontSizePercent}cqh`,
    padding: `${style.boxPaddingPercent}cqh`,
    top: `${style.yPercent}cqh`,
  };

  return (
    <div className="broadcast-preview">
      <div
        className={`broadcast-preview-frame${disabled ? "" : " draggable"}`}
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        ref={frame}
      >
        {/* Плашка пресета в превью не рисуется — её кадр знает только рендерер,
            поэтому положение показывает метка. Тянуть можно за любое место
            кадра: попадать курсором в саму метку неудобно. */}
        {disabled ? null : (
          <div
            className="broadcast-preview-anchor"
            style={{
              left: `${style.xPercent}cqw`,
              top: `${style.yPercent}cqh`,
            }}
          >
            <i />
            <span>
              {placement.offsetXPercent === 0 && placement.offsetYPercent === 0
                ? tr("как в пресете", "as in preset")
                : `${formatOffset(placement.offsetXPercent)} / ${formatOffset(placement.offsetYPercent)}`}
            </span>
          </div>
        )}
        {definition.kind === "ticker-crawl" && settings.tickerCrawl.regionWidthPercent < 100 ? (
          <div
            className="broadcast-preview-region"
            style={{
              height: `${style.fontSizePercent * 1.8}cqh`,
              left: `${settings.tickerCrawl.regionXPercent}cqw`,
              top: `${style.yPercent - style.fontSizePercent * 0.9}cqh`,
              width: `${settings.tickerCrawl.regionWidthPercent}cqw`,
            }}
          />
        ) : null}
        {definition.kind === "ticker-crawl" ? (
          <div
            className="broadcast-preview-ticker"
            style={{
              ...textStyle,
              left: `${settings.tickerCrawl.regionXPercent}cqw`,
              width: `${settings.tickerCrawl.regionWidthPercent}cqw`,
            }}
          >
            <span
              style={{
                // Один круг — это (ширина кадра + ширина надписи) / скорость.
                // В кадре 1920 px ширина строки известна только браузеру, поэтому
                // берём длительность из той же формулы по ширине превью.
                animationDirection:
                  settings.tickerCrawl.direction === "left" ? "normal" : "reverse",
                animationDuration: `${Math.max(2, 1_920 / settings.tickerCrawl.speedPixelsPerSecond)}s`,
                animationIterationCount: settings.tickerCrawl.repeat || "infinite",
              }}
            >
              {joinPreviewTicker(settings.tickerCrawl.items, settings.tickerCrawl.separator) ||
                tr("Сообщений пока нет", "No messages yet")}
            </span>
          </div>
        ) : null}

        {definition.kind === "clock-countdown" ? (
          <div
            className="broadcast-preview-text"
            style={{ ...textStyle, left: `${style.xPercent}cqw` }}
          >
            {settings.clockCountdown.mode === "clock"
              ? formatPreviewClock(
                  now,
                  settings.clockCountdown.timezoneOffsetMinutes,
                  settings.clockCountdown.format,
                )
              : formatPreviewCountdown(
                  Math.max(0, settings.clockCountdown.countdownSeconds - elapsed),
                  settings.clockCountdown.format,
                )}
          </div>
        ) : null}

        {definition.kind === "dynamic-title" ? (
          <div
            className="broadcast-preview-text"
            style={{ ...textStyle, left: `${style.xPercent}cqw` }}
          >
            {settings.dynamicTitle.text ||
              (settings.dynamicTitle.source === "task-file"
                ? tr(
                    `Значение из ключа «${settings.dynamicTitle.taskKey}»`,
                    `Value from key “${settings.dynamicTitle.taskKey}”`,
                  )
                : tr("Введите текст", "Enter text"))}
          </div>
        ) : null}

        {definition.kind === "next-program" ? (
          <div
            className="broadcast-preview-text"
            style={{ ...textStyle, left: `${style.xPercent}cqw` }}
          >
            {settings.nextProgram.subtitleText
              ? tr(
                  `Следующий фильм — ${settings.nextProgram.subtitleText}`,
                  `Next program — ${settings.nextProgram.subtitleText}`,
                )
              : tr("Следующий фильм", "Next program")}
          </div>
        ) : null}

        {definition.kind === "stinger-transition" ? (
          <StingerPreview
            cutPointSeconds={settings.stingerTransition.cutPointSeconds}
            durationSeconds={settings.stingerTransition.durationSeconds}
          />
        ) : null}
      </div>

      <p className="broadcast-preview-caption">
        {previewCaption(definition.kind, settings, dynamic, tr)}
      </p>
    </div>
  );
}

function clampPlacement(value: number, min = -100, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function formatOffset(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Сдвиг графики эффекта по кадру.
 *
 * У готового файла положение задано внутри него, и поправить его
 * в After Effects ради одного канала — отдельная работа. Здесь то же самое
 * делается двумя числами или протяжкой в окне предпросмотра; в эфире вместе с
 * плашкой едет и надпись эффекта.
 */
function PlacementFields({
  disabled,
  onChange,
  placement,
}: {
  disabled: boolean;
  onChange: (placement: EffectPlacement) => void;
  placement: EffectPlacement;
}): ReactNode {
  const { tr } = useI18n();
  return (
    <div className="broadcast-grid broadcast-placement">
      <NumberField
        disabled={disabled}
        hint={tr("% ширины кадра", "% of frame width")}
        label={tr("Сдвиг X", "X offset")}
        max={100}
        min={-100}
        onChange={(offsetXPercent) => onChange({ ...placement, offsetXPercent })}
        step={0.5}
        value={placement.offsetXPercent}
      />
      <NumberField
        disabled={disabled}
        hint={tr("% высоты кадра", "% of frame height")}
        label={tr("Сдвиг Y", "Y offset")}
        max={100}
        min={-100}
        onChange={(offsetYPercent) => onChange({ ...placement, offsetYPercent })}
        step={0.5}
        value={placement.offsetYPercent}
      />
      <button
        className="broadcast-placement-reset"
        disabled={disabled || (placement.offsetXPercent === 0 && placement.offsetYPercent === 0)}
        onClick={() => onChange({ offsetXPercent: 0, offsetYPercent: 0 })}
        type="button"
      >
        <RotateCcw size={12} /> {tr("Как в пресете", "As in preset")}
      </button>
    </div>
  );
}

/** Схема стыка: где кончается ролик A, где начинается B и где режется переход. */
function StingerPreview({
  cutPointSeconds,
  durationSeconds,
}: {
  cutPointSeconds: number;
  durationSeconds: number;
}) {
  const { tr } = useI18n();
  const cutPercent = Math.min(95, Math.max(5, (cutPointSeconds / durationSeconds) * 100));
  return (
    <div className="stinger-preview">
      <div className="stinger-preview-bar">
        <span className="stinger-preview-a" style={{ width: `${cutPercent}%` }}>
          {tr("хвост ролика A", "tail of clip A")}
        </span>
        <span className="stinger-preview-b" style={{ width: `${100 - cutPercent}%` }}>
          {tr("голова ролика B", "head of clip B")}
        </span>
        <i style={{ left: `${cutPercent}%` }} />
      </div>
      <div className="stinger-preview-legend">
        <span>0 {tr("с", "s")}</span>
        <strong>
          {tr("Точка склейки", "Cut point")} {cutPointSeconds.toFixed(2)} {tr("с", "s")}
        </strong>
        <span>
          {durationSeconds.toFixed(2)} {tr("с", "s")}
        </span>
      </div>
    </div>
  );
}

function previewCaption(
  kind: BroadcastEffectKind,
  settings: BroadcastEffectSettings,
  dynamic: boolean,
  tr: Translate,
): string {
  if (kind === "ticker-crawl") {
    return tr(
      `Приближение: скорость ${settings.tickerCrawl.speedPixelsPerSecond} px/с в кадре 1920×1080. В эфире положение считает FFmpeg по реальной ширине надписи.`,
      `Approximation: ${settings.tickerCrawl.speedPixelsPerSecond} px/s in a 1920×1080 frame. On air, FFmpeg calculates position using the actual text width.`,
    );
  }
  if (kind === "clock-countdown") {
    return dynamic
      ? tr(
          "Приближение. В эфире часы идут по эфирному времени ролика, а не по часам этой машины.",
          "Approximation. On air, the clock follows the clip's playout time, not this computer's clock.",
        )
      : "";
  }
  if (kind === "dynamic-title") {
    const source =
      settings.dynamicTitle.source === "task-file"
        ? tr(
            `ключ «${settings.dynamicTitle.taskKey}» файла задания`,
            `task-file key “${settings.dynamicTitle.taskKey}”`,
          )
        : tr("текст из настроек", "text from settings");
    return tr(
      `Плашка: сцена рисует декор и ${source}.`,
      `Lower third: the scene draws the design and ${source}.`,
    );
  }
  if (kind === "stinger-transition") {
    return tr(
      "Переключение источника происходит в точке склейки — там, где графика полностью закрывает кадр.",
      "The source switches at the cut point, where the graphic fully covers the frame.",
    );
  }
  if (kind === "animation-in-out") {
    const mode = settings.animationInOut.mode;
    return tr(
      `Режим ${mode === "in-out" ? "In + Out" : mode.toUpperCase()}, по ${settings.animationInOut.durationSeconds} с.`,
      `Mode ${mode === "in-out" ? "In + Out" : mode.toUpperCase()}, ${settings.animationInOut.durationSeconds} s each.`,
    );
  }
  return tr(
    `Плашка выходит за ${settings.nextProgram.startOffsetSeconds} с до конца ролика и держится ${settings.nextProgram.durationSeconds} с.`,
    `The lower third appears ${settings.nextProgram.startOffsetSeconds} s before clip end and stays for ${settings.nextProgram.durationSeconds} s.`,
  );
}

function joinPreviewTicker(items: readonly string[], separator: string): string {
  const messages = items.map((item) => item.trim()).filter(Boolean);
  return messages.length > 1 ? `${messages.join(separator)}${separator}` : (messages[0] ?? "");
}

function formatPreviewClock(now: Date, offsetMinutes: number, format: string): string {
  const shifted = new Date(now.getTime() + (offsetMinutes + now.getTimezoneOffset()) * 60_000);
  const parts = [shifted.getHours(), shifted.getMinutes(), shifted.getSeconds()].map((value) =>
    String(value).padStart(2, "0"),
  );
  return selectClockParts(parts, format);
}

function formatPreviewCountdown(remaining: number, format: string): string {
  const total = Math.max(0, Math.floor(remaining));
  const parts = [Math.floor(total / 3_600), Math.floor((total % 3_600) / 60), total % 60].map(
    (value) => String(value).padStart(2, "0"),
  );
  return selectClockParts(parts, format);
}

function selectClockParts(parts: string[], format: string): string {
  if (format === "HH:MM") return `${parts[0]}:${parts[1]}`;
  if (format === "MM:SS") return `${parts[1]}:${parts[2]}`;
  if (format === "SS") return parts[2] ?? "00";
  return parts.join(":");
}

/**
 * Оформление надписи вынесено в `memo` из-за списка системных шрифтов: в нём
 * несколько сотен `option`, и пересборка на каждое нажатие клавиши в соседнем
 * поле заметно тормозила ввод.
 */
const TextStyleFields = memo(function TextStyleFields({
  busy,
  fonts,
  style,
  onChange,
}: {
  busy: boolean;
  fonts: SystemFont[];
  style: BroadcastTextStyle;
  onChange: (style: BroadcastTextStyle) => void;
}) {
  const { tr } = useI18n();
  const [fontQuery, setFontQuery] = useState("");
  const normalizedQuery = fontQuery.trim().toLocaleLowerCase("ru-RU");
  const selected = fonts.find((font) => font.filePath === style.fontFilePath);
  const visibleFonts = fonts.filter(
    (font) =>
      !normalizedQuery ||
      font.family.toLocaleLowerCase("ru-RU").includes(normalizedQuery) ||
      font.filePath === style.fontFilePath,
  );
  const cyrillic = visibleFonts.filter((font) => font.cyrillic);
  const totalCyrillic = fonts.filter((font) => font.cyrillic).length;
  return (
    <details className="broadcast-style" open={false}>
      <summary>{tr("Оформление надписи", "Text style")}</summary>
      <div className="broadcast-grid">
        <label className="broadcast-field broadcast-field-wide">
          <span>
            {tr("Шрифт", "Font")}
            <i>
              {totalCyrillic}{" "}
              {tr(
                `из ${fonts.length} системных шрифтов с кириллицей`,
                `of ${fonts.length} system fonts support Cyrillic`,
              )}
            </i>
          </span>
          <input
            aria-label={tr("Поиск системного шрифта", "Search system fonts")}
            className="broadcast-font-search"
            disabled={busy || fonts.length === 0}
            onChange={(event) => setFontQuery(event.target.value)}
            placeholder={tr("Поиск по названию…", "Search by name…")}
            type="search"
            value={fontQuery}
          />
          <select
            disabled={busy || fonts.length === 0}
            onChange={(event) => {
              const font = fonts.find((candidate) => candidate.filePath === event.target.value);
              onChange({
                ...style,
                fontFamily: font?.family ?? "",
                fontFilePath: font?.filePath ?? null,
              });
            }}
            value={style.fontFilePath ?? ""}
          >
            <option value="">{tr("Шрифт FFmpeg по умолчанию", "Default FFmpeg font")}</option>
            {/* Шрифты без кириллицы отделены: выбрав такой, оператор получит в
                эфире пустые прямоугольники вместо русского текста. */}
            <optgroup label={tr("С поддержкой кириллицы", "Cyrillic supported")}>
              {cyrillic.map((font) => (
                <option key={font.filePath} value={font.filePath}>
                  {font.family}
                </option>
              ))}
            </optgroup>
            <optgroup label={tr("Без кириллицы — только латиница", "No Cyrillic — Latin only")}>
              {visibleFonts
                .filter((font) => !font.cyrillic)
                .map((font) => (
                  <option key={font.filePath} value={font.filePath}>
                    {font.family}
                  </option>
                ))}
            </optgroup>
          </select>
          {normalizedQuery && visibleFonts.length === 0 ? (
            <i>{tr("Шрифты не найдены", "No fonts found")}</i>
          ) : null}
        </label>
        {style.fontFilePath && selected && !selected.cyrillic ? (
          <p className="broadcast-warning broadcast-field-wide">
            {tr(
              `В шрифте «${selected.family}» нет кириллицы: русский текст выйдет в эфир пустыми прямоугольниками.`,
              `Font “${selected.family}” has no Cyrillic support: Russian text will appear as empty boxes on air.`,
            )}
          </p>
        ) : null}
        {fonts.length === 0 ? (
          <p className="broadcast-hint broadcast-field-wide">
            {tr(
              "Шрифт по умолчанию берёт FFmpeg, и кириллицы в нём может не быть. Список системных шрифтов подгружается с media-service.",
              "FFmpeg chooses the default font and it may not support Cyrillic. The media service supplies the system font list.",
            )}
          </p>
        ) : null}
        <NumberField
          disabled={busy}
          hint={tr("% от высоты кадра", "% of frame height")}
          label={tr("Кегль", "Font size")}
          min={0.5}
          onChange={(fontSizePercent) => onChange({ ...style, fontSizePercent })}
          step={0.1}
          value={style.fontSizePercent}
        />
        <NumberField
          disabled={busy}
          hint={tr("% от ширины кадра", "% of frame width")}
          label="X"
          max={200}
          min={-100}
          onChange={(xPercent) => onChange({ ...style, xPercent })}
          step={1}
          value={style.xPercent}
        />
        <NumberField
          disabled={busy}
          hint={tr("% от высоты кадра", "% of frame height")}
          label="Y"
          max={200}
          min={-100}
          onChange={(yPercent) => onChange({ ...style, yPercent })}
          step={1}
          value={style.yPercent}
        />
        <label className="broadcast-field">
          <span>{tr("Цвет текста", "Text color")}</span>
          <input
            disabled={busy}
            onChange={(event) => onChange({ ...style, color: event.target.value })}
            type="color"
            value={style.color}
          />
        </label>
        <label className="broadcast-field broadcast-field-checkbox">
          <span>{tr("Подложка", "Background")}</span>
          <input
            checked={style.boxEnabled}
            disabled={busy}
            onChange={(event) => onChange({ ...style, boxEnabled: event.target.checked })}
            type="checkbox"
          />
        </label>
        {style.boxEnabled ? (
          <>
            <label className="broadcast-field">
              <span>{tr("Цвет подложки", "Background color")}</span>
              <input
                disabled={busy}
                onChange={(event) => onChange({ ...style, boxColor: event.target.value })}
                type="color"
                value={style.boxColor}
              />
            </label>
            <NumberField
              disabled={busy}
              label={tr("Прозрачность", "Opacity")}
              max={1}
              min={0}
              onChange={(boxOpacity) => onChange({ ...style, boxOpacity })}
              step={0.02}
              value={style.boxOpacity}
            />
          </>
        ) : null}
      </div>
    </details>
  );
});

/**
 * Числовое поле с собственным черновиком.
 *
 * `input[type=number]` отдаёт пустую строку для любого незавершённого ввода:
 * «1.», «-», «1e». Прямое `Number(value)` превращало это в ноль и возвращало
 * поле назад — набрать дробное значение или стереть содержимое было невозможно,
 * поле «залипало». Поэтому пока поле в фокусе, показывается ровно то, что
 * набрал оператор, а наружу уходят только законченные числа.
 */
const NumberField = memo(function NumberField({
  disabled,
  hint,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  disabled: boolean;
  hint?: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="broadcast-field">
      <span>
        {label}
        {hint ? <i>{hint}</i> : null}
      </span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        onBlur={() => {
          if (draft != null && draft.trim() !== "") {
            const parsed = Number(draft);
            if (Number.isFinite(parsed)) {
              onChange(clampNumber(parsed, min, max));
            }
          }
          setDraft(null);
        }}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") return;
          const next = Number(text);
          if (
            Number.isFinite(next) &&
            (min == null || next >= min) &&
            (max == null || next <= max)
          ) {
            onChange(next);
          }
        }}
        step={step}
        type="number"
        value={draft ?? value}
      />
    </label>
  );
});

function clampNumber(value: number, min?: number, max?: number): number {
  return Math.min(
    max ?? Number.POSITIVE_INFINITY,
    Math.max(min ?? Number.NEGATIVE_INFINITY, value),
  );
}

const TextField = memo(function TextField({
  disabled,
  hint,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactNode {
  return (
    <label className="broadcast-field">
      <span>
        {label}
        {hint ? <i>{hint}</i> : null}
      </span>
      <input
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
});

function shortPath(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length <= 2 ? value : `…/${parts.slice(-2).join("/")}`;
}

/**
 * Значение поля из настроек прежних версий.
 *
 * До v8.0.2 у плашки было ровно два ключа — строка и подпись. Пустой `default`
 * погасил бы титр, который уже выходит в эфир, поэтому старые поля читаются,
 * пока оператор не задаст значение заново.
 */
function legacyFieldValue(
  key: string,
  settings: BroadcastEffectSettings["dynamicTitle"],
): string {
  if (key === "title" || key === settings.dynamicKey) return settings.text;
  if (key === "subtitle" || key === settings.captionKey) return settings.captionText;
  return "";
}
