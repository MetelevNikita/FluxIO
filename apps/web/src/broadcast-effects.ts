import type {
  BroadcastEffectKind,
  BroadcastTextStyle,
  BroadcastTextOverlay,
  ClipAudioOverlay,
  GraphicEffectAsset,
  EffectPlacement,
  GraphicEffectLayer,
  LottieEditableProperty,
  LottieFitSample,
} from "@gruber/contracts";
import type { MediaAsset } from "./types.js";

/**
 * Разрешение эфирных эффектов второго уровня в обычные слои плейлиста.
 *
 * Эффект второго уровня — это правило, а не картинка: он сам решает, к каким
 * роликам применяется, в какой момент запускается и какой текст показывает.
 * Здесь это правило превращается в набор FX-слоёв, текстовых и звуковых
 * оверлеев, которые эфирный контур уже умеет отдавать. Функции чистые, поэтому
 * поведение каждого эффекта проверяется тестом без запуска FFmpeg.
 *
 * Работа идёт в два шага: `planBroadcastEffect` считает, что и куда положить и
 * какие Lottie-варианты нужно отрендерить, а `applyBroadcastPlan` подставляет
 * готовые пути и возвращает новый плейлист.
 */

export interface BroadcastTargetClip {
  id: string;
  name: string;
  durationSeconds: number;
  /** Тип строки расписания. Плашка «Смотрите далее» анонсирует только фильмы. */
  scheduleType?: "movie" | "chop" | "clip" | null;
}

export interface BroadcastTaskEntry {
  name: string;
  values: Record<string, string>;
}

/** Один Lottie-рендер: набор переопределений текста, общий для нескольких роликов. */
export interface BroadcastRenderRequest {
  key: string;
  /** id редактируемых текстовых свойств Lottie → новое значение. */
  overrides: Record<string, string>;
  /**
   * Чем мерить плашку `fit:` у полей, которые уходят в эфир пустыми. Часы и
   * отсчёт рисует drawtext покадрово, в документе мерить нечего.
   */
  fitSamples: Record<string, LottieFitSample>;
}

export interface PlannedEffectLayer {
  assetId: string;
  /** Какой рендер подставить в `filePath`; null — файл пресета берётся как есть. */
  renderKey: string | null;
  layer: GraphicEffectLayer;
}

export interface BroadcastEffectPlan {
  layers: PlannedEffectLayer[];
  textOverlays: { assetId: string; overlay: BroadcastTextOverlay }[];
  audioOverlays: { assetId: string; overlay: ClipAudioOverlay }[];
  renders: BroadcastRenderRequest[];
  errors: string[];
  warnings: string[];
}

export interface PlanBroadcastEffectInput {
  effect: GraphicEffectAsset;
  /** Пресет уровня 3 — Lottie или alpha-медиа, служащий эффекту оформлением. */
  preset: GraphicEffectAsset | null;
  clips: BroadcastTargetClip[];
  /** null — «на весь проект»; иначе только выбранные ролики. */
  targetIds: Set<string> | null;
  taskEntries: BroadcastTaskEntry[];
  frameRate: number;
  createId?: () => string;
}

const minimumWindowSeconds = 0.04;

export function planBroadcastEffect(input: PlanBroadcastEffectInput): BroadcastEffectPlan {
  const definition = input.effect.broadcast;
  const plan = emptyPlan();
  if (!definition) {
    plan.errors.push(`${input.effect.name} is not a second-level broadcast effect`);
    return plan;
  }
  const context: PlanContext = {
    ...input,
    createId: input.createId ?? (() => globalThis.crypto.randomUUID()),
    definition,
    plan,
    targets: input.clips.filter((clip) => !input.targetIds || input.targetIds.has(clip.id)),
  };
  if (context.targets.length === 0) {
    plan.errors.push("No clips are selected for this effect");
    return plan;
  }
  planners[definition.kind](context);
  return plan;
}

interface PlanContext extends PlanBroadcastEffectInput {
  createId: () => string;
  definition: NonNullable<GraphicEffectAsset["broadcast"]>;
  plan: BroadcastEffectPlan;
  targets: BroadcastTargetClip[];
}

const planners: Record<BroadcastEffectKind, (context: PlanContext) => void> = {
  "animation-in-out": planAnimationInOut,
  "dynamic-title": planDynamicTitle,
  "next-program": planNextProgram,
  "ticker-crawl": planTickerCrawl,
  "clock-countdown": planClockCountdown,
  "stinger-transition": planStingerTransition,
};

/* -------------------------------------------------------------------------- *
 * Dynamic title
 * -------------------------------------------------------------------------- */

/**
 * Универсальная гибридная плашка: Lottie отвечает за декор, а строку рисует
 * FFmpeg. Поэтому значение можно менять для каждого ролика без повторной
 * сборки проекта After Effects, а слой `fit:<имя поля>` садится по её ширине.
 */
function planDynamicTitle(context: PlanContext): void {
  const settings = context.definition.settings.dynamicTitle;
  const dynamicField = resolveDynamicField(context, settings.dynamicKey, settings.captionKey);
  const style = styleFromPreset(context, dynamicField, settings.style);

  for (const clip of context.targets) {
    const content = resolveDynamicTitleContent(context, clip);
    if (!content) {
      context.plan.warnings.push(`"${clip.name}": текст динамической плашки пуст — эффект пропущен`);
      continue;
    }
    const startSeconds = settings.startSeconds;
    const endSeconds = startSeconds + settings.durationSeconds;
    if (context.preset) {
      pushLayer(context, clip, {
        endSeconds,
        name: `${context.effect.name} plate`,
        renderKey: presetCaptionRender(
          context,
          settings.captionKey,
          settings.captionText,
          dynamicField,
          {
            text: content,
            fontFilePath: style.fontFilePath,
            fontSizePercent: style.fontSizePercent,
          },
        ),
        startSeconds,
      });
    }
    pushTextOverlay(context, clip, {
      content,
      endSeconds,
      mode: "static",
      startSeconds,
      style,
    });
  }
}

function resolveDynamicTitleContent(
  context: PlanContext,
  clip: BroadcastTargetClip,
): string {
  const settings = context.definition.settings.dynamicTitle;
  if (settings.source === "manual") return settings.text.trim();
  const matches = context.taskEntries.filter((entry) => entry.name.trim() === clip.name.trim());
  if (matches.length > 1) {
    context.plan.warnings.push(
      `"${clip.name}": в файле задания несколько записей с таким name — взята первая`,
    );
  }
  const value = matches[0]?.values[settings.taskKey]?.trim() ?? "";
  if (!value && settings.text.trim()) {
    context.plan.warnings.push(
      `"${clip.name}": ключ "${settings.taskKey}" не найден — использован резервный текст`,
    );
  }
  return value || settings.text.trim();
}

/* -------------------------------------------------------------------------- *
 * Animation in/out
 * -------------------------------------------------------------------------- */

/**
 * Пресет входной и/или выходной анимации, привязанный к конкретным роликам
 * файлом задания. Ролик ищется по служебному ключу `name`: сравнение точное,
 * без учёта окружающих пробелов. Ни одного совпадения или больше одного — это
 * ошибка привязки, и эффект для такой записи не запускается.
 */
function planAnimationInOut(context: PlanContext): void {
  const settings = context.definition.settings.animationInOut;
  const { plan, preset } = context;
  if (!preset) {
    plan.errors.push("Animation in/out needs a Lottie or alpha preset");
    return;
  }
  const fields = lottieTextFields(preset);
  const bindings = context.taskEntries.length > 0
    ? bindTaskEntries(context, fields)
    : context.targets.map((clip) => ({ clip, overrides: {} as Record<string, string> }));

  for (const { clip, overrides } of bindings) {
    const renderKey = registerRender(context, overrides);
    const windows: { label: string; startSeconds: number; endSeconds: number }[] = [];
    if (settings.mode === "in" || settings.mode === "in-out") {
      windows.push({
        label: "IN",
        startSeconds: settings.startSeconds,
        endSeconds: settings.startSeconds + settings.durationSeconds,
      });
    }
    if (settings.mode === "out" || settings.mode === "in-out") {
      const end = clip.durationSeconds - settings.endSeconds;
      windows.push({
        label: "OUT",
        startSeconds: end - settings.durationSeconds,
        endSeconds: end,
      });
    }
    for (const window of windows) {
      pushLayer(context, clip, {
        endSeconds: window.endSeconds,
        name: `${context.effect.name} ${window.label}`,
        renderKey,
        startSeconds: window.startSeconds,
      });
    }
  }
}

/**
 * Сопоставление записей задания с роликами и ключей задания с текстовыми полями
 * Lottie. Лишний ключ не ломает применение — он лишь попадает в предупреждения,
 * а отсутствующий оставляет полю значение по умолчанию из шаблона.
 */
function bindTaskEntries(
  context: PlanContext,
  fields: Map<string, LottieEditableProperty>,
): { clip: BroadcastTargetClip; overrides: Record<string, string> }[] {
  const bindings: { clip: BroadcastTargetClip; overrides: Record<string, string> }[] = [];
  for (const entry of context.taskEntries) {
    const matches = context.targets.filter((clip) => clip.name.trim() === entry.name.trim());
    if (matches.length === 0) {
      context.plan.errors.push(`"${entry.name}": no clip with this name is in the schedule`);
      continue;
    }
    if (matches.length > 1) {
      context.plan.errors.push(
        `"${entry.name}": ${matches.length} clips share this name, the binding is ambiguous`,
      );
      continue;
    }
    const overrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.values)) {
      const field = fields.get(key);
      if (!field) {
        context.plan.warnings.push(
          `"${entry.name}": key "${key}" has no matching Lottie text field and is ignored`,
        );
        continue;
      }
      overrides[field.id] = value;
    }
    bindings.push({ clip: matches[0]!, overrides });
  }
  return bindings;
}

/* -------------------------------------------------------------------------- *
 * Next program
 * -------------------------------------------------------------------------- */

/**
 * Плашка «Смотрите далее». Точка запуска отсчитывается от конца текущего ролика,
 * а текст берётся из следующего элемента плейлиста — именно плейлиста, а не
 * выбранных роликов, иначе на краю выделения подставился бы не тот материал.
 */
function planNextProgram(context: PlanContext): void {
  const settings = context.definition.settings.nextProgram;
  const titlesByName = new Map(
    context.taskEntries.map((entry) => [entry.name.trim(), entry] as const),
  );
  const fields = context.preset ? lottieTextFields(context.preset) : new Map();

  for (const clip of context.targets) {
    const position = context.clips.findIndex((candidate) => candidate.id === clip.id);
    // Анонсируем следующий фильм, а не следующую строку расписания: между
    // фильмами стоят отбивки и ролики, объявлять их незачем.
    const next = position >= 0 ? nextMovieAfter(context.clips, position) : undefined;
    const title = next
      ? (settings.source === "task-file"
          ? titlesByName.get(next.name.trim())?.values.next_title ?? next.name
          : next.name)
      : settings.fallbackTitle;
    if (!title) {
      context.plan.warnings.push(
        `"${clip.name}" is the last clip and has no fallback title, so the promo is skipped`,
      );
      continue;
    }
    const startSeconds = clip.durationSeconds - settings.startOffsetSeconds;
    const endSeconds = startSeconds + settings.durationSeconds;
    if (context.preset) {
      const overrides: Record<string, string> = {};
      const titleField = fields.get(settings.titleKey);
      const subtitleField = fields.get(settings.subtitleKey);
      if (titleField) overrides[titleField.id] = title;
      else {
        context.plan.warnings.push(
          `The preset has no text field "${settings.titleKey}", so the promo shows its template text`,
        );
      }
      if (subtitleField && settings.subtitleText) overrides[subtitleField.id] = settings.subtitleText;
      pushLayer(context, clip, {
        endSeconds,
        name: `${context.effect.name} → ${title}`,
        renderKey: registerRender(context, overrides),
        startSeconds,
      });
      continue;
    }
    // Без пресета плашка рисуется штатным drawtext: эффект остаётся рабочим,
    // даже когда шаблон из After Effects ещё не готов.
    pushTextOverlay(context, clip, {
      content: settings.subtitleText ? `${title} — ${settings.subtitleText}` : title,
      endSeconds,
      mode: "static",
      startSeconds,
      style: settings.style,
    });
  }
}

/**
 * Ближайший фильм после позиции `position`. Если расписание не размечено по
 * типам вовсе, берётся просто следующий элемент — иначе на ручном плейлисте
 * эффект не сработал бы никогда.
 */
function nextMovieAfter(
  clips: readonly BroadcastTargetClip[],
  position: number,
): BroadcastTargetClip | undefined {
  const typed = clips.some((clip) => clip.scheduleType);
  for (let index = position + 1; index < clips.length; index += 1) {
    const candidate = clips[index];
    if (!candidate) continue;
    if (!typed || candidate.scheduleType === "movie") return candidate;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- *
 * Ticker crawl
 * -------------------------------------------------------------------------- */

function planTickerCrawl(context: PlanContext): void {
  const settings = context.definition.settings.tickerCrawl;
  const content = joinTickerItems(settings.items, settings.separator);
  if (!content) {
    context.plan.errors.push("The ticker has no messages to show");
    return;
  }
  // Поле разрешается один раз на эффект: иначе предупреждение о нём повторилось
  // бы столько раз, сколько роликов в расписании.
  const dynamicField = resolveDynamicField(context, settings.dynamicKey, settings.captionKey);
  for (const clip of context.targets) {
    const startSeconds = settings.startSeconds;
    const endSeconds = startSeconds + settings.durationSeconds;
    // Подложка под строку — обычный слой из пресета, сам текст всегда рисует
    // drawtext: только он держит постоянную скорость при любой длине сообщения.
    if (context.preset) {
      pushLayer(context, clip, {
        endSeconds,
        name: `${context.effect.name} plate`,
        renderKey: presetCaptionRender(
          context,
          settings.captionKey,
          settings.captionText,
          dynamicField,
        ),
        startSeconds,
      });
    }
    // Строка, привязанная к полю плашки, наследует её цвет — часто тёмный, —
    // и без ограничения полосой едет по всему кадру: за пределами плашки текст
    // почти не виден, и снаружи это выглядит как «строка не подставилась».
    if (settings.dynamicKey && settings.regionWidthPercent >= 100) {
      const warning = "Строка привязана к полю плашки, но полоса задана во весь кадр: " +
        "текст поедет за пределы плашки и будет почти не виден. Задайте «Полоса: X» " +
        "и «Полоса: ширина» по размеру плашки.";
      if (!context.plan.warnings.includes(warning)) context.plan.warnings.push(warning);
    }
    pushTextOverlay(context, clip, {
      content,
      direction: settings.direction,
      endSeconds,
      mode: "ticker",
      repeat: settings.repeat,
      regionWidthPercent: settings.regionWidthPercent,
      regionXPercent: settings.regionXPercent,
      speedPixelsPerSecond: settings.speedPixelsPerSecond,
      startSeconds,
      style: styleFromPreset(context, dynamicField, settings.style),
    });
  }
}

/** Сообщения в одну строку. Разделитель ставится и в конце — круг замыкается им же. */
export function joinTickerItems(items: readonly string[], separator: string): string {
  const messages = items
    .map((item) => item.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter((item) => item.length > 0);
  if (messages.length === 0) return "";
  return messages.length === 1 ? messages[0] ?? "" : `${messages.join(separator)}${separator}`;
}

/* -------------------------------------------------------------------------- *
 * Clock / countdown
 * -------------------------------------------------------------------------- */

function planClockCountdown(context: PlanContext): void {
  const settings = context.definition.settings.clockCountdown;
  const dynamicField = resolveDynamicField(context, settings.dynamicKey, settings.captionKey);
  const style = styleFromPreset(context, dynamicField, settings.style);
  // Часы и отсчёт меняются покадрово, поэтому в документе мерить нечего: плашке
  // отдаётся самое широкое значение формата тем же шрифтом и кеглем.
  const fitSample: LottieFitSample = {
    text: clockSample(settings.format),
    fontFilePath: style.fontFilePath,
    fontSizePercent: style.fontSizePercent,
  };
  for (const clip of context.targets) {
    const startSeconds = settings.startSeconds;
    // Отсчёт «до конца ролика» считается по хронометражу каждого ролика
    // отдельно: одно и то же назначение на разных роликах даёт разное время.
    const countdownSeconds = settings.countdownSource === "clip-remaining"
      ? Math.max(1, clip.durationSeconds - startSeconds)
      : settings.countdownSeconds;
    const endSeconds = settings.countdownSource === "clip-remaining"
      ? clip.durationSeconds
      : startSeconds + settings.durationSeconds;
    if (context.preset) {
      pushLayer(context, clip, {
        endSeconds,
        name: `${context.effect.name} plate`,
        renderKey: presetCaptionRender(
          context,
          settings.captionKey,
          settings.captionText,
          dynamicField,
          fitSample,
        ),
        startSeconds,
      });
    }
    pushTextOverlay(context, clip, {
      clockFormat: settings.format,
      content: "",
      countdownFromSeconds: settings.mode === "countdown" ? countdownSeconds : 0,
      endSeconds,
      mode: settings.mode === "countdown" ? "countdown" : "clock",
      startSeconds,
      style,
      timezoneOffsetMinutes: settings.timezoneOffsetMinutes,
    });
    if (
      settings.mode === "countdown" &&
      settings.countdownSource === "fixed" &&
      settings.countdownSeconds > settings.durationSeconds
    ) {
      context.plan.warnings.push(
        `"${clip.name}": the window is shorter than the countdown, so it disappears before zero`,
      );
    }
  }
}

/** Самое широкое значение формата: по нему и садится плашка. */
function clockSample(format: string): string {
  if (format === "HH:MM" || format === "MM:SS") return "00:00";
  if (format === "SS") return "00";
  return "00:00:00";
}

/* -------------------------------------------------------------------------- *
 * Stinger transition
 * -------------------------------------------------------------------------- */

/**
 * Брендированный переход через стык роликов.
 *
 * Эфир катится независимыми рендерерами — по одному на ролик, — поэтому стык
 * между A и B физически проходит по границе двух процессов, и один общий
 * оверлей поверх обоих роликов невозможен. Переход режется по Cut point: кадры
 * до него ложатся на хвост A, кадры после — на голову B из того же файла со
 * смещением `sourceInSeconds`. Переключение источника остаётся штатным стыком
 * плейлиста и происходит ровно там, где графика полностью закрывает кадр, а
 * длительность расписания, PCR и SCTE-35 не меняются.
 */
function planStingerTransition(context: PlanContext): void {
  const settings = context.definition.settings.stingerTransition;
  const assetPath = settings.assetPath ?? context.preset?.filePath ?? null;
  if (!assetPath) {
    context.plan.errors.push("The stinger needs an alpha video or a preset");
    return;
  }
  const duration = snapToFrameGrid(settings.durationSeconds, context.frameRate);
  const cutPoint = snapToFrameGrid(settings.cutPointSeconds, context.frameRate);
  if (duration !== settings.durationSeconds || cutPoint !== settings.cutPointSeconds) {
    context.plan.warnings.push(
      `Duration and cut point were snapped to the ${context.frameRate} fps grid: ` +
        `${duration.toFixed(3)} s / ${cutPoint.toFixed(3)} s`,
    );
  }
  if (cutPoint <= 0 || cutPoint >= duration) {
    context.plan.errors.push("The cut point must sit strictly inside the transition");
    return;
  }

  for (const clip of context.targets) {
    const position = context.clips.findIndex((candidate) => candidate.id === clip.id);
    const next = position >= 0 ? context.clips[position + 1] : undefined;
    if (!next) {
      context.plan.warnings.push(
        `"${clip.name}" is the last clip, so there is no cut for the stinger to cover`,
      );
      continue;
    }
    // Обе половины тоже ложатся на кадровую сетку: иначе разность двух
    // округлённых величин даёт «хвост» вида 0.6799999999999999.
    const headLength = snapToFrameGrid(duration - cutPoint, context.frameRate);
    const tailSeconds = Math.min(cutPoint, clip.durationSeconds - minimumWindowSeconds);
    const headSeconds = Math.min(headLength, next.durationSeconds - minimumWindowSeconds);
    if (tailSeconds < cutPoint || headSeconds < headLength) {
      context.plan.warnings.push(
        `"${clip.name}" → "${next.name}": one of the clips is shorter than its half of the ` +
          "transition, so the stinger was trimmed",
      );
    }

    pushLayer(context, clip, {
      assetPath,
      endSeconds: clip.durationSeconds,
      name: `${context.effect.name} → ${next.name}`,
      renderKey: null,
      sourceInSeconds: 0,
      startSeconds: clip.durationSeconds - tailSeconds,
    });
    pushLayer(context, next, {
      assetPath,
      endSeconds: headSeconds,
      name: `${context.effect.name} ← ${clip.name}`,
      renderKey: null,
      sourceInSeconds: cutPoint,
      startSeconds: 0,
    });

    if (!settings.audioEnabled) continue;
    context.plan.audioOverlays.push({
      assetId: clip.id,
      overlay: {
        durationSeconds: tailSeconds,
        effectId: context.effect.id,
        filePath: assetPath,
        gainDb: settings.audioLevelDb,
        id: `sfx-${context.createId()}`,
        sourceInSeconds: 0,
        startSeconds: clip.durationSeconds - tailSeconds,
      },
    });
    context.plan.audioOverlays.push({
      assetId: next.id,
      overlay: {
        durationSeconds: headSeconds,
        effectId: context.effect.id,
        filePath: assetPath,
        gainDb: settings.audioLevelDb,
        id: `sfx-${context.createId()}`,
        sourceInSeconds: cutPoint,
        startSeconds: 0,
      },
    });
  }
}

/** Ближайшая граница кадра. Переход обязан рваться ровно на кадре, а не между. */
export function snapToFrameGrid(seconds: number, frameRate: number): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return seconds;
  return Math.round(seconds * frameRate) / frameRate;
}

/* -------------------------------------------------------------------------- *
 * Общие помощники планирования
 * -------------------------------------------------------------------------- */

function pushLayer(
  context: PlanContext,
  clip: BroadcastTargetClip,
  options: {
    assetPath?: string;
    endSeconds: number;
    name: string;
    renderKey: string | null;
    sourceInSeconds?: number;
    startSeconds: number;
  },
): void {
  const settings = context.definition.settings.stingerTransition;
  const filePath = options.assetPath ?? context.preset?.filePath ?? context.effect.filePath;
  const startSeconds = clampStart(options.startSeconds, clip.durationSeconds);
  const endSeconds = clampEnd(options.endSeconds, startSeconds, clip.durationSeconds);
  if (endSeconds - startSeconds < minimumWindowSeconds) {
    context.plan.warnings.push(
      `"${clip.name}" is too short for ${options.name}, so the window was clipped to the roll`,
    );
  }
  const isStinger = context.definition.kind === "stinger-transition";
  context.plan.layers.push({
    assetId: clip.id,
    renderKey: options.renderKey,
    layer: {
      backgroundPath: filePath,
      blendMode: isStinger ? settings.blendMode : "alpha",
      effectId: context.effect.id,
      endSeconds,
      filePath,
      id: `layer-${clip.id}-${context.effect.id}-${context.createId()}`,
      kind: "video",
      lumaThreshold: settings.lumaThreshold,
      name: options.name,
      // Стингер закрывает кадр целиком — двигать его нельзя, иначе на стыке
      // откроется полоса исходного кадра.
      offsetXPercent: isStinger ? 0 : context.definition.placement.offsetXPercent,
      offsetYPercent: isStinger ? 0 : context.definition.placement.offsetYPercent,
      sourceDurationSeconds: context.preset?.durationSeconds ?? context.effect.durationSeconds,
      sourceInSeconds: options.sourceInSeconds ?? 0,
      startSeconds,
      tier: 2,
      titlePath: null,
      titlePaths: [],
    },
  });
}

/**
 * Кириллица без выбранного шрифта — самая частая причина «пустых прямоугольников»
 * в эфире: шрифт FFmpeg по умолчанию её может не содержать, и узнаётся это уже
 * на выходе. Предупреждаем на этапе применения.
 */
function warnAboutCyrillicFont(context: PlanContext, style: { fontFilePath: string | null }, text: string): void {
  if (style.fontFilePath || !/[А-Яа-яЁё]/.test(text)) return;
  const warning = "В тексте есть кириллица, но шрифт не выбран. Шрифт FFmpeg по умолчанию " +
    "может её не содержать — выберите системный шрифт с кириллицей в блоке «Оформление надписи».";
  if (!context.plan.warnings.includes(warning)) context.plan.warnings.push(warning);
}

function pushTextOverlay(
  context: PlanContext,
  clip: BroadcastTargetClip,
  overlay: Pick<BroadcastTextOverlay, "content" | "mode" | "style"> &
    Partial<BroadcastTextOverlay> & { endSeconds: number; startSeconds: number },
): void {
  const startSeconds = clampStart(overlay.startSeconds, clip.durationSeconds);
  const endSeconds = clampEnd(overlay.endSeconds, startSeconds, clip.durationSeconds);
  warnAboutCyrillicFont(context, overlay.style, overlay.content);
  const placement = context.definition.placement;
  const shifted = placeOverlay(overlay, placement);
  context.plan.textOverlays.push({
    assetId: clip.id,
    overlay: {
      clockFormat: "HH:MM:SS",
      countdownFromSeconds: 0,
      direction: "left",
      regionWidthPercent: 100,
      regionXPercent: 0,
      repeat: 0,
      speedPixelsPerSecond: 120,
      timezoneOffsetMinutes: 0,
      ...shifted,
      effectId: context.effect.id,
      endSeconds,
      id: `text-${clip.id}-${context.effect.id}-${context.createId()}`,
      name: context.effect.name,
      startSeconds,
    },
  });
}

/**
 * Тот же сдвиг, что у графики эффекта, но для надписи.
 *
 * Плашка и живое значение обязаны ехать вместе: слой двигает `overlay` в
 * FFmpeg, а надпись рисуется отдельным `drawtext` по своим процентам кадра.
 * Полоса бегущей строки сдвигается вместе с ней, иначе текст поедет мимо
 * плашки.
 */
function placeOverlay<T extends Pick<BroadcastTextOverlay, "style"> & Partial<BroadcastTextOverlay>>(
  overlay: T,
  placement: EffectPlacement,
): T {
  if (placement.offsetXPercent === 0 && placement.offsetYPercent === 0) return overlay;
  const shifted: T = {
    ...overlay,
    style: {
      ...overlay.style,
      xPercent: clampPercent(overlay.style.xPercent + placement.offsetXPercent),
      yPercent: clampPercent(overlay.style.yPercent + placement.offsetYPercent),
    },
  };
  return overlay.regionXPercent == null
    ? shifted
    : { ...shifted, regionXPercent: clampPercent(overlay.regionXPercent + placement.offsetXPercent) };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

/**
 * Постоянная подпись на подложке: текст уходит в выбранное текстовое поле
 * пресета так же, как у Next program. Живое значение — бегущая строка, часы,
 * отсчёт — по-прежнему рисует drawtext: оно меняется покадрово, и в
 * запечённый Lottie его не положить.
 */
function presetCaptionRender(
  context: PlanContext,
  captionKey: string,
  captionText: string,
  dynamicField: LottieEditableProperty | null = null,
  fitSample: LottieFitSample | null = null,
): string | null {
  if (!context.preset) return null;
  const fields = lottieTextFields(context.preset);
  const overrides: Record<string, string> = {};
  const fitSamples: Record<string, LottieFitSample> = {};

  if (captionKey && captionText) {
    const field = fields.get(captionKey);
    if (field) overrides[field.id] = captionText;
    else {
      context.plan.warnings.push(
        `В пресете нет текстового поля "${captionKey}" — подпись не подставлена`,
      );
    }
  }
  // Поле под живое значение очищается: Lottie рендерится один раз, и меняющиеся
  // часы или бегущая строка в него не запекаются. Шаблонный текст обязан
  // исчезнуть, иначе он останется в кадре под живой надписью.
  if (dynamicField) {
    overrides[dynamicField.id] = "";
    // Плашке с меткой `fit:` мерить в документе будет нечего, поэтому ширину
    // задаёт образец: тот же шрифт и кегль, которыми выйдет живая надпись.
    if (fitSample) fitSamples[dynamicField.id] = fitSample;
  }
  return Object.keys(overrides).length > 0 ? registerRender(context, overrides, fitSamples) : null;
}

/**
 * Текстовое поле пресета, на место которого встаёт живое значение эффекта.
 *
 * Ключ выбирает оператор, но пустой ключ — не «ничего не делать»: шаблонный
 * текст остался бы в кадре и читался бы вторым слоем под живой надписью. Когда
 * поле в пресете одно, выбирать не из чего — оно и берётся; когда их несколько,
 * молча угадывать нельзя, и остаётся предупредить.
 */
function resolveDynamicField(
  context: PlanContext,
  dynamicKey: string,
  captionKey: string,
): LottieEditableProperty | null {
  if (!context.preset) return null;
  const fields = lottieTextFields(context.preset);
  if (dynamicKey) {
    const field = fields.get(dynamicKey);
    if (field) return field;
    context.plan.warnings.push(
      `В пресете нет текстового поля "${dynamicKey}" — значение эффекта не привязано`,
    );
    return null;
  }
  const candidates = [...fields].filter(([key]) => key !== captionKey);
  const single = candidates.length === 1 ? candidates[0] : null;
  if (single) {
    context.plan.warnings.push(
      `Поле под живое значение не выбрано — взято единственное поле пресета "${single[0]}"`,
    );
    return single[1];
  }
  if (candidates.length > 1) {
    context.plan.warnings.push(
      "Поле под живое значение не выбрано: шаблонный текст пресета останется в кадре под надписью",
    );
  }
  return null;
}

/**
 * Оформление надписи, снятое с текстового слоя пресета: положение, кегль, цвет
 * и выключка. Живое значение встаёт ровно на место слоя шаблона и выглядит его
 * частью, а не наклейкой поверх. Подложка при этом не нужна — её роль играет
 * сама плашка.
 */
function styleFromPreset(
  context: PlanContext,
  dynamicField: LottieEditableProperty | null,
  style: BroadcastTextStyle,
): BroadcastTextStyle {
  if (!dynamicField || !context.preset) return style;
  const box = dynamicField.textBox;
  if (!box) return style;
  return {
    ...style,
    align: box.align,
    boxEnabled: false,
    color: box.color,
    fontSizePercent: box.fontSizePercent,
    xPercent: box.xPercent,
    yPercent: box.yPercent,
  };
}

/**
 * Регистрирует Lottie-рендер и возвращает его ключ. Одинаковые наборы значений
 * склеиваются: недельная сетка на сотни роликов иначе заказала бы сотни
 * одинаковых рендеров.
 */
function registerRender(
  context: PlanContext,
  overrides: Record<string, string>,
  fitSamples: Record<string, LottieFitSample> = {},
): string | null {
  if (!context.preset?.lottie) return null;
  if (Object.keys(overrides).length === 0) return null;
  // Образец входит в ключ: под разную ширину нужен разный рендер плашки.
  const key = JSON.stringify([
    Object.fromEntries(Object.entries(overrides).sort(([left], [right]) =>
      left.localeCompare(right))),
    Object.fromEntries(Object.entries(fitSamples).sort(([left], [right]) =>
      left.localeCompare(right))),
  ]);
  if (!context.plan.renders.some((render) => render.key === key)) {
    context.plan.renders.push({ key, overrides, fitSamples });
  }
  return key;
}

/**
 * Ключи редактируемых текстовых полей Lottie. Ключ — это имя текстового слоя из
 * After Effects, а для Essential Graphics — идентификатор слота; именно они
 * пишутся в файл задания. Сравнение точное и с учётом регистра.
 */
export function lottieTextFields(
  preset: GraphicEffectAsset,
): Map<string, LottieEditableProperty> {
  const fields = new Map<string, LottieEditableProperty>();
  for (const property of preset.lottie?.properties ?? []) {
    if (property.type !== "text") continue;
    const key = lottieTextFieldKey(property);
    if (key && !fields.has(key)) fields.set(key, property);
  }
  return fields;
}

export function lottieTextFieldKey(property: LottieEditableProperty): string {
  const segments = property.group.split("·").map((segment) => segment.trim());
  const last = segments.at(-1) ?? "";
  const slot = /^Slot\s+(.+)$/.exec(last);
  return slot?.[1]?.trim() ?? last;
}

function clampStart(value: number, clipDuration: number): number {
  return Math.min(Math.max(0, value), Math.max(0, clipDuration - minimumWindowSeconds));
}

function clampEnd(value: number, startSeconds: number, clipDuration: number): number {
  return Math.min(Math.max(value, startSeconds + minimumWindowSeconds), clipDuration);
}

function emptyPlan(): BroadcastEffectPlan {
  return { audioOverlays: [], errors: [], layers: [], renders: [], textOverlays: [], warnings: [] };
}

/* -------------------------------------------------------------------------- *
 * Применение плана к плейлисту
 * -------------------------------------------------------------------------- */

/**
 * Кладёт рассчитанный план в плейлист. `renderedPathByKey` — готовые рендеры
 * Lottie: их заказывает вызывающий код, потому что рендер идёт на сервере, а сам
 * план обязан оставаться чистым.
 */
export function applyBroadcastPlan(
  assets: readonly MediaAsset[],
  plan: BroadcastEffectPlan,
  renderedPathByKey: ReadonlyMap<string, string> = new Map(),
): { items: MediaAsset[]; touched: number } {
  const layersByAsset = groupBy(plan.layers, (entry) => entry.assetId);
  const textByAsset = groupBy(plan.textOverlays, (entry) => entry.assetId);
  const audioByAsset = groupBy(plan.audioOverlays, (entry) => entry.assetId);
  let touched = 0;
  const items = assets.map((asset) => {
    const layers = layersByAsset.get(asset.id) ?? [];
    const texts = textByAsset.get(asset.id) ?? [];
    const audio = audioByAsset.get(asset.id) ?? [];
    if (layers.length === 0 && texts.length === 0 && audio.length === 0) return asset;
    touched += 1;
    return {
      ...asset,
      effects: [
        ...(asset.effects ?? []),
        ...layers.map(({ layer, renderKey }) => {
          const renderedPath = renderKey ? renderedPathByKey.get(renderKey) : undefined;
          return renderedPath
            ? { ...layer, backgroundPath: renderedPath, filePath: renderedPath }
            : layer;
        }),
      ],
      textOverlays: [...(asset.textOverlays ?? []), ...texts.map((entry) => entry.overlay)],
      audioOverlays: [...(asset.audioOverlays ?? []), ...audio.map((entry) => entry.overlay)],
    };
  });
  return { items, touched };
}

/** Снимает с плейлиста всё, что положил эффект второго уровня. */
export function removeBroadcastEffect(
  assets: readonly MediaAsset[],
  effectId: string,
): MediaAsset[] {
  return assets.map((asset) => ({
    ...asset,
    effects: asset.effects?.filter((layer) => layer.effectId !== effectId),
    textOverlays: asset.textOverlays?.filter((overlay) => overlay.effectId !== effectId),
    audioOverlays: asset.audioOverlays?.filter((overlay) => overlay.effectId !== effectId),
  }));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
