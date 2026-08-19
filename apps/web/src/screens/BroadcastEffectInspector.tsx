import type {
  BroadcastEffectKind,
  BroadcastEffectSettings,
  BroadcastTextStyle,
  GraphicEffectAsset,
} from "@gruber/contracts";
import { FileJson2, FileVideo2, FolderOpen, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Настройки эфирного эффекта второго уровня. У каждого вида — своё поведение,
 * поэтому у каждого свой набор полей; общее здесь только оформление текста и
 * выбор Lottie-пресета, который служит эффекту графикой.
 */

export interface BroadcastTaskSummary {
  filePath: string;
  entryCount: number;
  warnings: string[];
}

interface BroadcastEffectInspectorProps {
  busy: boolean;
  effect: GraphicEffectAsset;
  presets: GraphicEffectAsset[];
  taskSummary: BroadcastTaskSummary | null;
  onChange: (effect: GraphicEffectAsset) => void;
  onSelectTaskFile: () => void;
  onSelectTickerSource: () => void;
  onSelectStingerFile: () => void;
}

export const broadcastEffectCatalog: {
  kind: BroadcastEffectKind;
  title: string;
  summary: string;
}[] = [
  {
    kind: "animation-in-out",
    summary: "Входная и выходная анимация ролика с привязкой файлом задания",
    title: "Animation in/out",
  },
  {
    kind: "next-program",
    summary: "Плашка «Смотрите далее» с названием следующего материала",
    title: "Next program",
  },
  {
    kind: "ticker-crawl",
    summary: "Бегущая строка с постоянной скоростью при любой длине текста",
    title: "Ticker crawl",
  },
  {
    kind: "clock-countdown",
    summary: "Экранные часы по эфирному времени или обратный отсчёт",
    title: "Clock / countdown",
  },
  {
    kind: "stinger-transition",
    summary: "Брендированный переход, закрывающий стык двух роликов",
    title: "Stinger transition",
  },
];

export function broadcastEffectTitle(kind: BroadcastEffectKind): string {
  return broadcastEffectCatalog.find((entry) => entry.kind === kind)?.title ?? kind;
}

export function BroadcastEffectInspector({
  busy,
  effect,
  presets,
  taskSummary,
  onChange,
  onSelectTaskFile,
  onSelectTickerSource,
  onSelectStingerFile,
}: BroadcastEffectInspectorProps) {
  const definition = effect.broadcast;
  if (!definition) return null;
  const settings = definition.settings;

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

  const presetPicker = (label: string, optional: boolean) => (
    <label className="broadcast-field">
      <span>{label}</span>
      <select
        disabled={busy}
        onChange={(event) => onChange({
          ...effect,
          broadcast: { ...definition, presetEffectId: event.target.value || null },
        })}
        value={definition.presetEffectId ?? ""}
      >
        {optional ? <option value="">Без пресета · штатная надпись</option> : null}
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.lottie ? "LOTTIE" : preset.kind.toUpperCase()} · {preset.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="broadcast-inspector">
      <div className="broadcast-inspector-heading">
        <span className="broadcast-tier-badge">Уровень 2</span>
        <strong>{broadcastEffectTitle(definition.kind)}</strong>
      </div>

      {definition.kind === "animation-in-out" ? (
        <>
          {presetPicker("Lottie-пресет анимации", false)}
          <div className="broadcast-grid">
            <label className="broadcast-field">
              <span>Режим</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("animationInOut", {
                  mode: event.target.value as "in" | "out" | "in-out",
                })}
                value={settings.animationInOut.mode}
              >
                <option value="in">In</option>
                <option value="out">Out</option>
                <option value="in-out">In + Out</option>
              </select>
            </label>
            <NumberField
              disabled={busy}
              hint="от начала ролика"
              label="Start, с"
              min={0}
              onChange={(startSeconds) => updateSettings("animationInOut", { startSeconds })}
              step={0.04}
              value={settings.animationInOut.startSeconds}
            />
            <NumberField
              disabled={busy}
              hint="от конца ролика"
              label="End, с"
              min={0}
              onChange={(endSeconds) => updateSettings("animationInOut", { endSeconds })}
              step={0.04}
              value={settings.animationInOut.endSeconds}
            />
            <NumberField
              disabled={busy}
              label="Duration, с"
              min={0.04}
              onChange={(durationSeconds) => updateSettings("animationInOut", { durationSeconds })}
              step={0.04}
              value={settings.animationInOut.durationSeconds}
            />
          </div>
          <TaskFileField
            busy={busy}
            filePath={settings.animationInOut.taskFilePath}
            onClear={() => updateSettings("animationInOut", { taskFilePath: null })}
            onSelect={onSelectTaskFile}
            summary={taskSummary}
          />
        </>
      ) : null}

      {definition.kind === "next-program" ? (
        <>
          {presetPicker("Пресет плашки", true)}
          <div className="broadcast-grid">
            <NumberField
              disabled={busy}
              hint="до конца ролика"
              label="Start offset, с"
              min={0.04}
              onChange={(startOffsetSeconds) => updateSettings("nextProgram", { startOffsetSeconds })}
              step={0.5}
              value={settings.nextProgram.startOffsetSeconds}
            />
            <NumberField
              disabled={busy}
              label="Duration, с"
              min={0.04}
              onChange={(durationSeconds) => updateSettings("nextProgram", { durationSeconds })}
              step={0.5}
              value={settings.nextProgram.durationSeconds}
            />
            <label className="broadcast-field">
              <span>Источник названия</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("nextProgram", {
                  source: event.target.value as "playlist-name" | "task-file",
                })}
                value={settings.nextProgram.source}
              >
                <option value="playlist-name">Следующий ролик плейлиста</option>
                <option value="task-file">Файл задания, ключ next_title</option>
              </select>
            </label>
            <TextField
              disabled={busy}
              label="Ключ названия в Lottie"
              onChange={(titleKey) => updateSettings("nextProgram", { titleKey })}
              value={settings.nextProgram.titleKey}
            />
            <TextField
              disabled={busy}
              label="Ключ подзаголовка"
              onChange={(subtitleKey) => updateSettings("nextProgram", { subtitleKey })}
              value={settings.nextProgram.subtitleKey}
            />
            <TextField
              disabled={busy}
              label="Подзаголовок"
              onChange={(subtitleText) => updateSettings("nextProgram", { subtitleText })}
              value={settings.nextProgram.subtitleText}
            />
            <TextField
              disabled={busy}
              hint="показывается на последнем ролике; пусто — эффект пропускается"
              label="Резервный текст"
              onChange={(fallbackTitle) => updateSettings("nextProgram", { fallbackTitle })}
              value={settings.nextProgram.fallbackTitle}
            />
          </div>
          {settings.nextProgram.source === "task-file" ? (
            <TaskFileField
              busy={busy}
              filePath={settings.nextProgram.taskFilePath}
              onClear={() => updateSettings("nextProgram", { taskFilePath: null })}
              onSelect={onSelectTaskFile}
              summary={taskSummary}
            />
          ) : null}
          {definition.presetEffectId ? null : (
            <TextStyleFields
              busy={busy}
              onChange={(style) => updateSettings("nextProgram", { style })}
              style={settings.nextProgram.style}
            />
          )}
        </>
      ) : null}

      {definition.kind === "ticker-crawl" ? (
        <>
          {presetPicker("Подложка под строку", true)}
          <div className="broadcast-grid">
            <label className="broadcast-field">
              <span>Источник текста</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("tickerCrawl", {
                  source: event.target.value as "manual" | "file",
                })}
                value={settings.tickerCrawl.source}
              >
                <option value="manual">Вручную</option>
                <option value="file">Файл .json / .txt</option>
              </select>
            </label>
            <NumberField
              disabled={busy}
              hint="пикселей кадра в секунду"
              label="Скорость"
              min={1}
              onChange={(speedPixelsPerSecond) =>
                updateSettings("tickerCrawl", { speedPixelsPerSecond })}
              step={10}
              value={settings.tickerCrawl.speedPixelsPerSecond}
            />
            <label className="broadcast-field">
              <span>Направление</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("tickerCrawl", {
                  direction: event.target.value as "left" | "right",
                })}
                value={settings.tickerCrawl.direction}
              >
                <option value="left">Справа налево</option>
                <option value="right">Слева направо</option>
              </select>
            </label>
            <NumberField
              disabled={busy}
              hint="0 — крутить непрерывно"
              label="Повторов"
              min={0}
              onChange={(repeat) => updateSettings("tickerCrawl", { repeat: Math.round(repeat) })}
              step={1}
              value={settings.tickerCrawl.repeat}
            />
            <NumberField
              disabled={busy}
              label="Start, с"
              min={0}
              onChange={(startSeconds) => updateSettings("tickerCrawl", { startSeconds })}
              step={1}
              value={settings.tickerCrawl.startSeconds}
            />
            <NumberField
              disabled={busy}
              label="Duration, с"
              min={0.04}
              onChange={(durationSeconds) => updateSettings("tickerCrawl", { durationSeconds })}
              step={1}
              value={settings.tickerCrawl.durationSeconds}
            />
            <TextField
              disabled={busy}
              hint="ставится между сообщениями и замыкает круг"
              label="Разделитель"
              onChange={(separator) => updateSettings("tickerCrawl", { separator })}
              value={settings.tickerCrawl.separator}
            />
          </div>
          {settings.tickerCrawl.source === "file" ? (
            <div className="broadcast-file-field">
              <span>Файл сообщений</span>
              <strong title={settings.tickerCrawl.filePath ?? undefined}>
                {settings.tickerCrawl.filePath
                  ? `${shortPath(settings.tickerCrawl.filePath)} · ${settings.tickerCrawl.items.length} сообщений`
                  : "Не выбран"}
              </strong>
              <button disabled={busy} onClick={onSelectTickerSource} type="button">
                <FolderOpen size={12} /> {settings.tickerCrawl.filePath ? "Обновить" : "Выбрать"}
              </button>
            </div>
          ) : (
            <label className="broadcast-field broadcast-field-wide">
              <span>Сообщения — по одному в строке</span>
              <textarea
                disabled={busy}
                onChange={(event) => updateSettings("tickerCrawl", {
                  items: event.target.value.split("\n"),
                })}
                rows={4}
                value={settings.tickerCrawl.items.join("\n")}
              />
            </label>
          )}
          <TextStyleFields
            busy={busy}
            onChange={(style) => updateSettings("tickerCrawl", { style })}
            style={settings.tickerCrawl.style}
          />
        </>
      ) : null}

      {definition.kind === "clock-countdown" ? (
        <>
          {presetPicker("Подложка под часы", true)}
          <div className="broadcast-grid">
            <label className="broadcast-field">
              <span>Режим</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("clockCountdown", {
                  mode: event.target.value as "clock" | "countdown",
                })}
                value={settings.clockCountdown.mode}
              >
                <option value="clock">Часы</option>
                <option value="countdown">Обратный отсчёт</option>
              </select>
            </label>
            <label className="broadcast-field">
              <span>Формат</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("clockCountdown", {
                  format: event.target.value as "HH:MM:SS" | "HH:MM" | "MM:SS" | "SS",
                })}
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
                hint="минут относительно UTC"
                label="Часовой пояс"
                min={-840}
                onChange={(timezoneOffsetMinutes) => updateSettings("clockCountdown", {
                  timezoneOffsetMinutes: Math.round(timezoneOffsetMinutes),
                })}
                step={30}
                value={settings.clockCountdown.timezoneOffsetMinutes}
              />
            ) : (
              <NumberField
                disabled={busy}
                hint="с какого значения идёт отсчёт"
                label="Длительность отсчёта, с"
                min={1}
                onChange={(countdownSeconds) =>
                  updateSettings("clockCountdown", { countdownSeconds })}
                step={1}
                value={settings.clockCountdown.countdownSeconds}
              />
            )}
            <NumberField
              disabled={busy}
              label="Start, с"
              min={0}
              onChange={(startSeconds) => updateSettings("clockCountdown", { startSeconds })}
              step={1}
              value={settings.clockCountdown.startSeconds}
            />
            <NumberField
              disabled={busy}
              label="Duration, с"
              min={0.04}
              onChange={(durationSeconds) => updateSettings("clockCountdown", { durationSeconds })}
              step={1}
              value={settings.clockCountdown.durationSeconds}
            />
          </div>
          <TextStyleFields
            busy={busy}
            onChange={(style) => updateSettings("clockCountdown", { style })}
            style={settings.clockCountdown.style}
          />
        </>
      ) : null}

      {definition.kind === "stinger-transition" ? (
        <>
          <div className="broadcast-file-field">
            <span>Файл перехода с альфа-каналом</span>
            <strong title={settings.stingerTransition.assetPath ?? undefined}>
              {settings.stingerTransition.assetPath
                ? shortPath(settings.stingerTransition.assetPath)
                : "Не выбран"}
            </strong>
            <button disabled={busy} onClick={onSelectStingerFile} type="button">
              <FileVideo2 size={12} /> {settings.stingerTransition.assetPath ? "Заменить" : "Выбрать"}
            </button>
          </div>
          <div className="broadcast-grid">
            <NumberField
              disabled={busy}
              label="Duration, с"
              min={0.08}
              onChange={(durationSeconds) =>
                updateSettings("stingerTransition", { durationSeconds })}
              step={0.04}
              value={settings.stingerTransition.durationSeconds}
            />
            <NumberField
              disabled={busy}
              hint="момент полного перекрытия кадра"
              label="Cut point, с"
              min={0.04}
              onChange={(cutPointSeconds) =>
                updateSettings("stingerTransition", { cutPointSeconds })}
              step={0.04}
              value={settings.stingerTransition.cutPointSeconds}
            />
            <label className="broadcast-field">
              <span>Режим наложения</span>
              <select
                disabled={busy}
                onChange={(event) => updateSettings("stingerTransition", {
                  blendMode: event.target.value as "alpha" | "luma",
                })}
                value={settings.stingerTransition.blendMode}
              >
                <option value="alpha">Alpha — у файла есть альфа-канал</option>
                <option value="luma">Luma — вырезать чёрный фон</option>
              </select>
            </label>
            {settings.stingerTransition.blendMode === "luma" ? (
              <NumberField
                disabled={busy}
                hint="ниже этой яркости — фон"
                label="Порог яркости"
                max={1}
                min={0}
                onChange={(lumaThreshold) =>
                  updateSettings("stingerTransition", { lumaThreshold })}
                step={0.01}
                value={settings.stingerTransition.lumaThreshold}
              />
            ) : null}
            <label className="broadcast-field broadcast-field-checkbox">
              <span>Подмешивать звук перехода</span>
              <input
                checked={settings.stingerTransition.audioEnabled}
                disabled={busy}
                onChange={(event) => updateSettings("stingerTransition", {
                  audioEnabled: event.target.checked,
                })}
                type="checkbox"
              />
            </label>
            {settings.stingerTransition.audioEnabled ? (
              <NumberField
                disabled={busy}
                hint="относительно авторского уровня"
                label="Уровень звука, дБ"
                max={12}
                min={-60}
                onChange={(audioLevelDb) =>
                  updateSettings("stingerTransition", { audioLevelDb })}
                step={1}
                value={settings.stingerTransition.audioLevelDb}
              />
            ) : null}
          </div>
          <p className="broadcast-note">
            Переход режется по Cut point: кадры до него ложатся на хвост выбранного ролика,
            кадры после — на голову следующего. Переключение источника остаётся штатным стыком
            плейлиста, поэтому длительность расписания не меняется. Обе величины
            округляются до границы кадра проекта.
          </p>
        </>
      ) : null}
    </section>
  );
}

function TaskFileField({
  busy,
  filePath,
  summary,
  onClear,
  onSelect,
}: {
  busy: boolean;
  filePath: string | null;
  summary: BroadcastTaskSummary | null;
  onClear: () => void;
  onSelect: () => void;
}) {
  const matched = summary && summary.filePath === filePath ? summary : null;
  return (
    <div className="broadcast-file-field">
      <span>Файл задания .json</span>
      <strong title={filePath ?? undefined}>
        {filePath
          ? `${shortPath(filePath)}${matched ? ` · ${matched.entryCount} записей` : ""}`
          : "Не выбран · поля берут значения шаблона"}
      </strong>
      <button disabled={busy} onClick={onSelect} type="button">
        <FileJson2 size={12} /> {filePath ? "Обновить" : "Выбрать"}
      </button>
      {filePath ? (
        <button disabled={busy} onClick={onClear} title="Снять файл задания" type="button">
          <RotateCcw size={12} />
        </button>
      ) : null}
      {matched?.warnings.map((warning) => (
        <em className="broadcast-warning" key={warning}>{warning}</em>
      ))}
    </div>
  );
}

function TextStyleFields({
  busy,
  style,
  onChange,
}: {
  busy: boolean;
  style: BroadcastTextStyle;
  onChange: (style: BroadcastTextStyle) => void;
}) {
  return (
    <details className="broadcast-style" open={false}>
      <summary>Оформление надписи</summary>
      <div className="broadcast-grid">
        <NumberField
          disabled={busy}
          hint="% от высоты кадра"
          label="Кегль"
          min={0.5}
          onChange={(fontSizePercent) => onChange({ ...style, fontSizePercent })}
          step={0.1}
          value={style.fontSizePercent}
        />
        <NumberField
          disabled={busy}
          hint="% от ширины кадра"
          label="X"
          max={100}
          min={0}
          onChange={(xPercent) => onChange({ ...style, xPercent })}
          step={1}
          value={style.xPercent}
        />
        <NumberField
          disabled={busy}
          hint="% от высоты кадра"
          label="Y"
          max={100}
          min={0}
          onChange={(yPercent) => onChange({ ...style, yPercent })}
          step={1}
          value={style.yPercent}
        />
        <label className="broadcast-field">
          <span>Цвет текста</span>
          <input
            disabled={busy}
            onChange={(event) => onChange({ ...style, color: event.target.value.toUpperCase() })}
            type="color"
            value={style.color}
          />
        </label>
        <label className="broadcast-field broadcast-field-checkbox">
          <span>Подложка</span>
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
              <span>Цвет подложки</span>
              <input
                disabled={busy}
                onChange={(event) =>
                  onChange({ ...style, boxColor: event.target.value.toUpperCase() })}
                type="color"
                value={style.boxColor}
              />
            </label>
            <NumberField
              disabled={busy}
              label="Прозрачность"
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
}

function NumberField({
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
  return (
    <label className="broadcast-field">
      <span>{label}{hint ? <i>{hint}</i> : null}</span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function TextField({
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
      <span>{label}{hint ? <i>{hint}</i> : null}</span>
      <input
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function shortPath(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length <= 2 ? value : `…/${parts.slice(-2).join("/")}`;
}
