import type {
  BroadcastEffectKind,
  BroadcastEffectSettings,
  BroadcastTextStyle,
  GraphicEffectAsset,
  SystemFont,
} from "@gruber/contracts";
import { FileJson2, FileVideo2, FolderOpen, KeyRound, Rss, RotateCcw, Save } from "lucide-react";
import { lottieTextFields } from "../broadcast-effects";
import { memo, useEffect, useState, type ReactNode } from "react";

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
  fonts: SystemFont[];
  onChange: (effect: GraphicEffectAsset) => void;
  onSelectTaskFile: () => void;
  onSelectTickerSource: () => void;
  onSelectStingerFile: () => void;
  onLoadTickerFeed: () => void;
  onApplyChanges: () => void;
  onImportPreset: () => void;
  assignedClipCount: number;
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
  fonts,
  onChange,
  onSelectTaskFile,
  onSelectTickerSource,
  onSelectStingerFile,
  onLoadTickerFeed,
  onApplyChanges,
  onImportPreset,
  assignedClipCount,
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

  const selectedPreset = presets.find((candidate) => candidate.id === definition.presetEffectId);
  const presetKeys = selectedPreset ? [...lottieTextFields(selectedPreset).keys()] : [];

  const presetPicker = (label: string, optional: boolean) => (
    <div className="broadcast-field broadcast-field-wide broadcast-preset-picker">
      <span>{label}</span>
      <div>
        <select
          aria-label={label}
          disabled={busy}
          onChange={(event) => onChange({
            ...effect,
            broadcast: { ...definition, presetEffectId: event.target.value || null },
          })}
          value={definition.presetEffectId ?? ""}
        >
          {optional ? <option value="">Без пресета · штатная надпись</option> : null}
          {presets.length === 0 ? <option value="">Пресетов пока нет — подгрузите Lottie</option> : null}
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.lottie ? "LOTTIE" : preset.kind.toUpperCase()} · {preset.name}
            </option>
          ))}
        </select>
        {/* Подгрузка прямо отсюда: иначе ради пресета приходится уходить
            в общий импорт и возвращаться обратно к настройкам эффекта. */}
        <button disabled={busy} onClick={onImportPreset} type="button">
          <FileJson2 size={12} /> Подгрузить Lottie
        </button>
      </div>
    </div>
  );

  return (
    <section className="broadcast-inspector">
      <div className="broadcast-inspector-heading">
        <span className="broadcast-tier-badge">Уровень 2</span>
        <strong>{broadcastEffectTitle(definition.kind)}</strong>
        {/* Настройки правятся после назначения, поэтому нужен явный перенос
            изменений в уже размеченные ролики. */}
        <button
          className="broadcast-save-button"
          disabled={busy || assignedClipCount === 0}
          onClick={() => {
            if (window.confirm(
              `Сохранить настройки «${effect.name}» и перенести их в ${assignedClipCount} ролик(ов)?\n\n` +
                "Прежние слои этого эффекта будут заменены новыми.",
            )) onApplyChanges();
          }}
          title={assignedClipCount === 0
            ? "Эффект ещё не назначен ни одному ролику"
            : `Перенести настройки в ${assignedClipCount} ролик(ов)`}
          type="button"
        >
          <Save size={12} /> Save
          {assignedClipCount > 0 ? <i>{assignedClipCount}</i> : null}
        </button>
      </div>

      <BroadcastEffectPreview effect={effect} presets={presets} />
      <PresetFieldsHint effect={effect} presets={presets} />

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
            <PresetKeyField
              busy={busy}
              hint="сюда уходит название следующего фильма"
              keys={presetKeys}
              label="Поле названия"
              onChange={(titleKey) => updateSettings("nextProgram", { titleKey })}
              value={settings.nextProgram.titleKey}
            />
            <PresetKeyField
              busy={busy}
              hint="необязательно"
              keys={presetKeys}
              label="Поле подзаголовка"
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
              fonts={fonts}
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
                <option value="feed">RSS / Atom-лента</option>
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
            <NumberField
              disabled={busy}
              hint="левый край полосы, % кадра"
              label="Полоса: X"
              max={100}
              min={0}
              onChange={(regionXPercent) => updateSettings("tickerCrawl", { regionXPercent })}
              step={1}
              value={settings.tickerCrawl.regionXPercent}
            />
            <NumberField
              disabled={busy}
              hint="100 — во весь кадр"
              label="Полоса: ширина"
              max={100}
              min={1}
              onChange={(regionWidthPercent) =>
                updateSettings("tickerCrawl", { regionWidthPercent })}
              step={1}
              value={settings.tickerCrawl.regionWidthPercent}
            />
          </div>
          {settings.tickerCrawl.source === "feed" ? (
            <div className="broadcast-file-field">
              <span>Адрес ленты</span>
              <input
                className="broadcast-feed-url"
                disabled={busy}
                onChange={(event) => updateSettings("tickerCrawl", {
                  feedUrl: event.target.value,
                })}
                placeholder="https://example.com/rss"
                type="url"
                value={settings.tickerCrawl.feedUrl}
              />
              <button
                disabled={busy || !settings.tickerCrawl.feedUrl}
                onClick={onLoadTickerFeed}
                type="button"
              >
                <Rss size={12} /> Загрузить
              </button>
              <em className="broadcast-hint">
                Загружено заголовков: {settings.tickerCrawl.items.length}.
                Ленту качает media-service — нажмите «Загрузить» ещё раз, чтобы обновить новости.
              </em>
            </div>
          ) : settings.tickerCrawl.source === "file" ? (
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
          {definition.presetEffectId ? (
            <div className="broadcast-grid">
              <PresetKeyField
                busy={busy}
                hint="сюда встанет бегущая строка"
                keys={presetKeys}
                label="Поле для значения"
                onChange={(dynamicKey) => updateSettings("tickerCrawl", { dynamicKey })}
                value={settings.tickerCrawl.dynamicKey}
              />
              <PresetKeyField
                busy={busy}
                hint="постоянная подпись на подложке"
                keys={presetKeys}
                label="Поле подписи в пресете"
                onChange={(captionKey) => updateSettings("tickerCrawl", { captionKey })}
                value={settings.tickerCrawl.captionKey}
              />
              <TextField
                disabled={busy}
                label="Текст подписи"
                onChange={(captionText) => updateSettings("tickerCrawl", { captionText })}
                value={settings.tickerCrawl.captionText}
              />
              <p className="broadcast-hint broadcast-field-wide">
                {settings.tickerCrawl.dynamicKey
                  ? "Поле шаблона очищается, а значение встаёт на его место — с тем же кеглем, " +
                    "цветом и выключкой. Бегущая строка едет внутри полосы: задайте её X и ширину " +
                    "по размеру плашки, иначе текст поедет по всему кадру."
                  : "Выберите поле, чтобы значение эффекта встало внутрь плашки, а не поверх неё."}
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
              <>
                <label className="broadcast-field">
                  <span>Что отсчитываем</span>
                  <select
                    disabled={busy}
                    onChange={(event) => updateSettings("clockCountdown", {
                      countdownSource: event.target.value as "fixed" | "clip-remaining",
                    })}
                    value={settings.clockCountdown.countdownSource}
                  >
                    <option value="clip-remaining">До конца ролика</option>
                    <option value="fixed">Заданное число секунд</option>
                  </select>
                </label>
                {settings.clockCountdown.countdownSource === "fixed" ? (
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
                ) : null}
              </>
            )}
            <NumberField
              disabled={busy}
              hint="от начала ролика"
              label="Start, с"
              min={0}
              onChange={(startSeconds) => updateSettings("clockCountdown", { startSeconds })}
              step={1}
              value={settings.clockCountdown.startSeconds}
            />
            {settings.clockCountdown.mode === "countdown" &&
              settings.clockCountdown.countdownSource === "clip-remaining" ? null : (
              <NumberField
                disabled={busy}
                label="Duration, с"
                min={0.04}
                onChange={(durationSeconds) => updateSettings("clockCountdown", { durationSeconds })}
                step={1}
                value={settings.clockCountdown.durationSeconds}
              />
            )}
          </div>
          {settings.clockCountdown.mode === "countdown" &&
            settings.clockCountdown.countdownSource === "clip-remaining" ? (
            <p className="broadcast-hint">
              Отсчёт считается по хронометражу каждого ролика отдельно и приходит в ноль ровно
              на его конце, поэтому окно показа задаётся автоматически — от Start и до конца ролика.
            </p>
          ) : null}
          {definition.presetEffectId ? (
            <div className="broadcast-grid">
              <PresetKeyField
                busy={busy}
                hint="сюда встанут часы или отсчёт"
                keys={presetKeys}
                label="Поле для значения"
                onChange={(dynamicKey) => updateSettings("clockCountdown", { dynamicKey })}
                value={settings.clockCountdown.dynamicKey}
              />
              <PresetKeyField
                busy={busy}
                hint="постоянная подпись на подложке"
                keys={presetKeys}
                label="Поле подписи в пресете"
                onChange={(captionKey) => updateSettings("clockCountdown", { captionKey })}
                value={settings.clockCountdown.captionKey}
              />
              <TextField
                disabled={busy}
                label="Текст подписи"
                onChange={(captionText) => updateSettings("clockCountdown", { captionText })}
                value={settings.clockCountdown.captionText}
              />
              <p className="broadcast-hint broadcast-field-wide">
                {settings.clockCountdown.dynamicKey
                  ? "Поле шаблона очищается, а значение встаёт на его место — с тем же кеглем, " +
                    "цветом и выключкой. Само значение рисует FFmpeg покадрово: в отрендеренный " +
                    "один раз Lottie его не запечь."
                  : "Выберите поле, чтобы значение эффекта встало внутрь плашки, а не поверх неё."}
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
          {presetPicker("Lottie-пресет перехода", true)}
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
            {settings.stingerTransition.assetPath ? (
              <button
                disabled={busy}
                onClick={() => updateSettings("stingerTransition", { assetPath: null })}
                title="Снять файл и использовать пресет"
                type="button"
              >
                <RotateCcw size={12} />
              </button>
            ) : null}
            <em className="broadcast-hint">
              {settings.stingerTransition.assetPath
                ? "Переход берётся из файла. Снимите его, чтобы использовать Lottie-пресет."
                : definition.presetEffectId
                  ? "Файл не выбран — переход берётся из Lottie-пресета выше."
                  : "Укажите файл или выберите Lottie-пресет: без источника переход не применится."}
            </em>
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

/**
 * Какие текстовые поля есть у выбранного пресета.
 *
 * Ключ поля — это имя текстового слоя из After Effects, и угадать его нельзя.
 * Раньше оператор набирал ключ руками, промахивался, и плашка молча выходила
 * в эфир с шаблонным текстом. Теперь набор ключей виден прямо в инспекторе:
 * их же надо писать в файл задания Animation in/out.
 */
function PresetFieldsHint({
  effect,
  presets,
}: {
  effect: GraphicEffectAsset;
  presets: GraphicEffectAsset[];
}) {
  const definition = effect.broadcast;
  const preset = presets.find((candidate) => candidate.id === definition?.presetEffectId);
  if (!definition || !preset) return null;
  if (!preset.lottie) {
    return (
      <p className="broadcast-hint">
        Пресет «{preset.name}» — обычное alpha-медиа: текстовых полей в нём нет,
        подставить в него ничего нельзя.
      </p>
    );
  }
  const fields = [...lottieTextFields(preset).entries()];
  if (fields.length === 0) {
    return (
      <p className="broadcast-warning">
        В пресете «{preset.name}» нет редактируемых текстовых слоёв. В After Effects заголовок
        должен остаться Text Layer — если его перевели в кривые перед экспортом Bodymovin,
        подставить текст уже невозможно.
      </p>
    );
  }
  return (
    <details className="preset-fields" open>
      <summary>
        <KeyRound size={11} /> Поля пресета «{preset.name}» — {fields.length}
      </summary>
      <table>
        <thead>
          <tr><th>Ключ</th><th>Текст в шаблоне</th></tr>
        </thead>
        <tbody>
          {fields.map(([key, property]) => (
            <tr key={key}>
              <td><code>{key}</code></td>
              <td title={String(property.value)}>{String(property.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {definition.kind === "animation-in-out"
          ? "Эти ключи пишутся в файл задания рядом с name. Сравнение точное и с учётом регистра."
          : "Выберите ключ в полях выше — именно в него уйдёт подставляемый текст."}
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
  // Пресета ещё нет — оставляем ручной ввод, иначе поле нечем заполнить.
  if (keys.length === 0) {
    return <TextField disabled={busy} hint={hint} label={label} onChange={onChange} value={value} />;
  }
  const missing = Boolean(value) && !keys.includes(value);
  return (
    <label className="broadcast-field">
      <span>{label}{hint ? <i>{hint}</i> : null}</span>
      <select
        className={missing ? "broadcast-field-invalid" : ""}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        value={missing ? "" : value}
      >
        <option value="">— не подставлять —</option>
        {keys.map((key) => <option key={key} value={key}>{key}</option>)}
        {missing ? <option value={value}>{value} — в пресете нет</option> : null}
      </select>
    </label>
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

/**
 * Предпросмотр эффекта.
 *
 * Кадр рисуется средствами браузера, а не FFmpeg, поэтому это приближение:
 * шрифт, цвета, положение, скорость строки и ход часов совпадают с эфиром,
 * а сглаживание и кернинг могут отличаться. Смысл в том, чтобы оператор увидел
 * поведение эффекта — куда он встанет и как поедет — не запуская эфир.
 */
function BroadcastEffectPreview({
  effect,
  presets,
}: {
  effect: GraphicEffectAsset;
  presets: GraphicEffectAsset[];
}) {
  const definition = effect.broadcast;
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
  const preset = presets.find((candidate) => candidate.id === definition.presetEffectId) ?? null;

  const style = definition.kind === "ticker-crawl"
    ? settings.tickerCrawl.style
    : definition.kind === "clock-countdown"
      ? settings.clockCountdown.style
      : settings.nextProgram.style;

  const textStyle = {
    background: style.boxEnabled
      ? `${style.boxColor}${Math.round(style.boxOpacity * 255).toString(16).padStart(2, "0")}`
      : "transparent",
    color: style.color,
    fontFamily: style.fontFamily ? `"${style.fontFamily}", sans-serif` : "sans-serif",
    fontSize: `${style.fontSizePercent}cqh`,
    padding: `${style.boxPaddingPercent}cqh`,
    top: `${style.yPercent}cqh`,
  };

  return (
    <div className="broadcast-preview">
      <div className="broadcast-preview-frame">
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
                animationDirection: settings.tickerCrawl.direction === "left"
                  ? "normal"
                  : "reverse",
                animationDuration: `${Math.max(2, 1_920 / settings.tickerCrawl.speedPixelsPerSecond)}s`,
                animationIterationCount: settings.tickerCrawl.repeat || "infinite",
              }}
            >
              {joinPreviewTicker(settings.tickerCrawl.items, settings.tickerCrawl.separator) ||
                "Сообщений пока нет"}
            </span>
          </div>
        ) : null}

        {definition.kind === "clock-countdown" ? (
          <div
            className="broadcast-preview-text"
            style={{ ...textStyle, left: `${style.xPercent}cqw` }}
          >
            {settings.clockCountdown.mode === "clock"
              ? formatPreviewClock(now, settings.clockCountdown.timezoneOffsetMinutes,
                  settings.clockCountdown.format)
              : formatPreviewCountdown(
                  Math.max(0, settings.clockCountdown.countdownSeconds - elapsed),
                  settings.clockCountdown.format,
                )}
          </div>
        ) : null}

        {definition.kind === "next-program" && !preset ? (
          <div
            className="broadcast-preview-text"
            style={{ ...textStyle, left: `${style.xPercent}cqw` }}
          >
            {settings.nextProgram.subtitleText
              ? `Следующий фильм — ${settings.nextProgram.subtitleText}`
              : "Следующий фильм"}
          </div>
        ) : null}

        {(definition.kind === "animation-in-out" ||
          definition.kind === "next-program") && preset ? (
          <div className="broadcast-preview-note">
            Оформление берётся из пресета «{preset.name}» — он показан в окне предпросмотра выше.
            Здесь видно только расписание показа.
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
        {previewCaption(definition.kind, settings, dynamic)}
      </p>
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
  const cutPercent = Math.min(95, Math.max(5, cutPointSeconds / durationSeconds * 100));
  return (
    <div className="stinger-preview">
      <div className="stinger-preview-bar">
        <span className="stinger-preview-a" style={{ width: `${cutPercent}%` }}>
          хвост ролика A
        </span>
        <span className="stinger-preview-b" style={{ width: `${100 - cutPercent}%` }}>
          голова ролика B
        </span>
        <i style={{ left: `${cutPercent}%` }} />
      </div>
      <div className="stinger-preview-legend">
        <span>0 с</span>
        <strong>Cut point {cutPointSeconds.toFixed(2)} с</strong>
        <span>{durationSeconds.toFixed(2)} с</span>
      </div>
    </div>
  );
}

function previewCaption(
  kind: BroadcastEffectKind,
  settings: BroadcastEffectSettings,
  dynamic: boolean,
): string {
  if (kind === "ticker-crawl") {
    return `Приближение: скорость ${settings.tickerCrawl.speedPixelsPerSecond} px/с в кадре ` +
      "1920×1080. В эфире положение считает FFmpeg по реальной ширине надписи.";
  }
  if (kind === "clock-countdown") {
    return dynamic
      ? "Приближение. В эфире часы идут по эфирному времени ролика, а не по часам этой машины."
      : "";
  }
  if (kind === "stinger-transition") {
    return "Переключение источника происходит в Cut point — там, где графика полностью " +
      "закрывает кадр.";
  }
  if (kind === "animation-in-out") {
    const mode = settings.animationInOut.mode;
    return `Режим ${mode === "in-out" ? "In + Out" : mode.toUpperCase()}, ` +
      `по ${settings.animationInOut.durationSeconds} с.`;
  }
  return `Плашка выходит за ${settings.nextProgram.startOffsetSeconds} с до конца ролика ` +
    `и держится ${settings.nextProgram.durationSeconds} с.`;
}

function joinPreviewTicker(items: readonly string[], separator: string): string {
  const messages = items.map((item) => item.trim()).filter(Boolean);
  return messages.length > 1 ? `${messages.join(separator)}${separator}` : messages[0] ?? "";
}

function formatPreviewClock(now: Date, offsetMinutes: number, format: string): string {
  const shifted = new Date(now.getTime() + (offsetMinutes + now.getTimezoneOffset()) * 60_000);
  const parts = [shifted.getHours(), shifted.getMinutes(), shifted.getSeconds()]
    .map((value) => String(value).padStart(2, "0"));
  return selectClockParts(parts, format);
}

function formatPreviewCountdown(remaining: number, format: string): string {
  const total = Math.max(0, Math.floor(remaining));
  const parts = [Math.floor(total / 3_600), Math.floor(total % 3_600 / 60), total % 60]
    .map((value) => String(value).padStart(2, "0"));
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
  const cyrillic = fonts.filter((font) => font.cyrillic);
  const selected = fonts.find((font) => font.filePath === style.fontFilePath);
  return (
    <details className="broadcast-style" open={false}>
      <summary>Оформление надписи</summary>
      <div className="broadcast-grid">
        <label className="broadcast-field broadcast-field-wide">
          <span>
            Шрифт
            <i>
              {cyrillic.length} из {fonts.length} системных шрифтов с кириллицей
            </i>
          </span>
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
            <option value="">Шрифт FFmpeg по умолчанию</option>
            {/* Шрифты без кириллицы отделены: выбрав такой, оператор получит в
                эфире пустые прямоугольники вместо русского текста. */}
            <optgroup label="С поддержкой кириллицы">
              {cyrillic.map((font) => (
                <option key={font.filePath} value={font.filePath}>{font.family}</option>
              ))}
            </optgroup>
            <optgroup label="Без кириллицы — только латиница">
              {fonts.filter((font) => !font.cyrillic).map((font) => (
                <option key={font.filePath} value={font.filePath}>{font.family}</option>
              ))}
            </optgroup>
          </select>
        </label>
        {style.fontFilePath && selected && !selected.cyrillic ? (
          <p className="broadcast-warning broadcast-field-wide">
            В шрифте «{selected.family}» нет кириллицы: русский текст выйдет в эфир пустыми
            прямоугольниками.
          </p>
        ) : null}
        {fonts.length === 0 ? (
          <p className="broadcast-hint broadcast-field-wide">
            Шрифт по умолчанию берёт FFmpeg, и кириллицы в нём может не быть. Список системных
            шрифтов подгружается с media-service.
          </p>
        ) : null}
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
            onChange={(event) => onChange({ ...style, color: event.target.value })}
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
                onChange={(event) => onChange({ ...style, boxColor: event.target.value })}
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
      <span>{label}{hint ? <i>{hint}</i> : null}</span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") return;
          const next = Number(text);
          if (Number.isFinite(next)) onChange(next);
        }}
        step={step}
        type="number"
        value={draft ?? value}
      />
    </label>
  );
});

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
      <span>{label}{hint ? <i>{hint}</i> : null}</span>
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
