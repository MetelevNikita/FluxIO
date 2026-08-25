import type {
  BroadcastDataMapping,
  BroadcastEffectKind,
  BroadcastTextStyle,
  BroadcastTextOverlay,
  ClipAudioOverlay,
  EffectDecoration,
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

export interface BroadcastTaskMatchSummary {
  recordCount: number;
  matchedRecordCount: number;
  matchedClipCount: number;
  unmatchedRecordCount: number;
  unmatchedClipCount: number;
  duplicateTitles: string[];
}

interface BroadcastTaskMatchClip {
  id: string;
  name: string;
  durationSeconds?: number;
}

/**
 * Применяет mapping из JSON Parser к сырым строкам источника. Результат уже
 * использует имена полей шаблона, поэтому планировщикам эффектов не важно,
 * как поля назывались во внешней newsroom/MAM-системе.
 */
export function mapBroadcastTaskRecords(
  records: readonly Record<string, string>[],
  mapping: BroadcastDataMapping,
): BroadcastTaskEntry[] {
  const result: BroadcastTaskEntry[] = [];
  for (const record of records) {
    const name = record[mapping.matchSourceKey]?.trim() ?? "";
    if (!name) continue;
    const values: Record<string, string> = {};
    if (mapping.bindings.length === 0) {
      for (const [key, value] of Object.entries(record)) {
        if (key !== mapping.matchSourceKey) values[key] = value;
      }
    } else {
      for (const binding of mapping.bindings) {
        const value = record[binding.sourceKey];
        if (value != null) values[binding.targetKey] = value;
      }
    }
    result.push({ name, values });
  }
  return result;
}

/**
 * Предпросмотр массового назначения до тяжёлого Lottie-рендера.
 *
 * `title` в JSON и имя материала сравниваются как имена файлов: без пути,
 * расширения, различий регистра и окружающих пробелов. Поэтому запись
 * `NEWS_01` честно совпадает и с `D:\Rundown\News_01.mov`, и с повтором того
 * же ролика в Future. Несколько JSON-записей с одним title неоднозначны и не
 * считаются совпадением.
 */
export function summarizeBroadcastTaskMatches(
  entries: readonly BroadcastTaskEntry[],
  clips: readonly BroadcastTaskMatchClip[],
): BroadcastTaskMatchSummary {
  const entriesByTitle = groupTaskEntriesByTitle(entries);
  const clipKeys = new Set(clips.map((clip) => normalizeTaskTitle(clip.name)).filter(Boolean));
  const matchedEntryKeys = new Set<string>();
  let matchedClipCount = 0;
  let unmatchedClipCount = 0;

  for (const clip of clips) {
    const key = normalizeTaskTitle(clip.name);
    const matches = key ? entriesByTitle.get(key) ?? [] : [];
    if (matches.length === 1) {
      matchedClipCount += 1;
      matchedEntryKeys.add(key);
    } else {
      unmatchedClipCount += 1;
    }
  }

  const duplicateTitles: string[] = [];
  let unmatchedRecordCount = 0;
  for (const [key, grouped] of entriesByTitle) {
    if (grouped.length > 1) duplicateTitles.push(grouped[0]!.name.trim());
    if (grouped.length !== 1 || !clipKeys.has(key)) unmatchedRecordCount += grouped.length;
  }

  return {
    recordCount: entries.length,
    matchedRecordCount: matchedEntryKeys.size,
    matchedClipCount,
    unmatchedRecordCount,
    unmatchedClipCount,
    duplicateTitles,
  };
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
  /** Размер эфирного кадра, в который FFmpeg вписывает Lottie через contain. */
  frameWidth: number;
  frameHeight: number;
  createId?: () => string;
}

const minimumWindowSeconds = 0.04;

/**
 * Виды, у которых оформление — только файл. Сам эффект и есть «показать
 * графику»: без неё показывать нечего, поэтому выбора «файл или плашка» у них
 * нет ни в интерфейсе, ни в плане.
 */
export const fileOnlyEffectKinds: ReadonlySet<BroadcastEffectKind> = new Set([
  "animation-in-out",
  "stinger-transition",
]);

/** Оформление с поправкой на вид: у файловых видов выбор оператора игнорируется. */
export function effectDecoration(
  definition: NonNullable<GraphicEffectAsset["broadcast"]>,
): EffectDecoration {
  return fileOnlyEffectKinds.has(definition.kind) ? "file" : definition.decoration;
}

/** Что вид принимает как оформление. */
export interface EffectGraphicPolicy {
  extensions: readonly string[];
  /** Чем объяснить отказ оператору. */
  accepts: string;
  /**
   * Шаблон титров: `.json` обязан быть экспортом FluxIO Title Studio. Обычный
   * Bodymovin не несёт ни списка редактируемых слоёв, ни связей с полями JSON,
   * поэтому оператору пришлось бы набирать имена слоёв руками — а промах в
   * имени не виден до эфира.
   */
  template: boolean;
}

/**
 * Набор форматов у каждого вида свой, и это не украшение: у стингера файл
 * обязан нести альфу, у титров — метаданные шаблона, а бегущей строке нужна
 * подложка, а не шаблон с текстовыми слоями.
 */
export const effectGraphicPolicies: Record<BroadcastEffectKind, EffectGraphicPolicy> = {
  "animation-in-out": {
    extensions: [".mov", ".webm", ".png"],
    accepts: "видео или картинку с альфа-каналом",
    template: false,
  },
  "dynamic-title": {
    extensions: [".json"],
    accepts: "шаблон FluxIO Title Studio",
    template: true,
  },
  "next-program": {
    extensions: [".json"],
    accepts: "шаблон FluxIO Title Studio",
    template: true,
  },
  "ticker-crawl": {
    extensions: [".mov", ".webm", ".png"],
    accepts: "видео или картинку с альфа-каналом для подложки",
    template: false,
  },
  "clock-countdown": {
    extensions: [".json"],
    accepts: "шаблон FluxIO Title Studio",
    template: true,
  },
  "stinger-transition": {
    extensions: [".mov", ".png"],
    accepts: ".mov с альфой или последовательность .png",
    template: false,
  },
};

function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Почему файл не подходит этому виду — или `null`, если подходит.
 *
 * Проверка идёт по расширению до обращения к службе: разбирать файл, который
 * заведомо будет отвергнут, незачем, а оператору важно увидеть причину сразу
 * при выборе, а не при попытке применить эффект.
 */
export function graphicFileRejection(kind: BroadcastEffectKind, filePath: string): string | null {
  const policy = effectGraphicPolicies[kind];
  const extension = fileExtension(filePath);
  if (policy.extensions.includes(extension)) return null;
  return `${broadcastEffectTitleFor(kind)} принимает ${policy.accepts}` +
    ` (${policy.extensions.join(", ")}), а выбран «${extension || "файл без расширения"}»`;
}

const effectTitles: Record<BroadcastEffectKind, string> = {
  "animation-in-out": "Анимация входа/выхода",
  "dynamic-title": "Динамическая плашка",
  "next-program": "Следующая программа",
  "ticker-crawl": "Бегущая строка",
  "clock-countdown": "Часы / отсчёт",
  "stinger-transition": "Стингер-переход",
};

function broadcastEffectTitleFor(kind: BroadcastEffectKind): string {
  return effectTitles[kind];
}

/**
 * Чего эффекту не хватает, чтобы его можно было применить, — или `null`, если
 * он готов.
 *
 * Раньше это выяснялось только при попытке применить: план возвращал ошибку, а
 * до того карточка выглядела рабочей. Теперь состояние видно в списке, и кнопки
 * применения выключены, пока эффект не собран.
 */
export function effectBlocker(
  effect: GraphicEffectAsset,
  library: readonly GraphicEffectAsset[],
): string | null {
  const definition = effect.broadcast;
  if (!definition) return null;
  if (definition.kind === "stinger-transition") {
    return definition.settings.stingerTransition.assetPath
      ? null
      : "Не выбран файл перехода";
  }
  if (effectDecoration(definition) !== "file") return null;
  if (!definition.presetEffectId) return "Не выбран файл оформления";
  return library.some((entry) => entry.id === definition.presetEffectId)
    ? null
    : "Файл оформления потерян";
}

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
    // Оформление выбирает оператор. При «плашке» назначенный файл не
    // используется, даже если он остался в эффекте: иначе переключение
    // ничего бы не меняло, а плашку рисовали бы обе стороны сразу.
    preset: effectDecoration(definition) === "file" ? input.preset : null,
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
          clip.name,
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
  const clipKey = normalizeTaskTitle(clip.name);
  const matches = context.taskEntries.filter((entry) => normalizeTaskTitle(entry.name) === clipKey);
  if (matches.length > 1) {
    context.plan.warnings.push(
      `"${clip.name}": в файле задания несколько записей с таким идентификатором — ` +
        "использован резервный текст",
    );
    return settings.text.trim();
  }
  const value = matches[0]?.values[settings.dynamicKey]?.trim()
    ?? matches[0]?.values[settings.taskKey]?.trim()
    ?? "";
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
 * файлом задания. Ролик ищется по служебному ключу mapping (`title` в
 * рекомендуемом формате). Сравниваются basename без расширения и регистр.
 * Одна запись может лечь на несколько повторений ролика в расписании. А вот
 * несколько JSON-записей с одним title неоднозначны и пропускаются.
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
  const entriesByTitle = groupTaskEntriesByTitle(context.taskEntries);
  const fieldsByNormalizedKey = new Map<string, LottieEditableProperty>();
  for (const [key, field] of fields) fieldsByNormalizedKey.set(normalizeFieldKey(key), field);
  const reportedDuplicateTitles = new Set<string>();

  for (const clip of context.targets) {
    const title = normalizeTaskTitle(clip.name);
    const matches = title ? entriesByTitle.get(title) ?? [] : [];
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      if (!reportedDuplicateTitles.has(title)) {
        context.plan.errors.push(
          `"${matches[0]!.name}": ${matches.length} JSON records share this title, the binding is ambiguous`,
        );
        reportedDuplicateTitles.add(title);
      }
      continue;
    }
    const entry = matches[0]!;
    const overrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.values)) {
      const field = fields.get(key) ?? fieldsByNormalizedKey.get(normalizeFieldKey(key));
      if (!field) {
        context.plan.warnings.push(
          `"${entry.name}": key "${key}" has no matching Lottie text field and is ignored`,
        );
        continue;
      }
      overrides[field.id] = value;
    }
    bindings.push({ clip, overrides });
  }
  return bindings;
}

function groupTaskEntriesByTitle(
  entries: readonly BroadcastTaskEntry[],
): Map<string, BroadcastTaskEntry[]> {
  const grouped = new Map<string, BroadcastTaskEntry[]>();
  for (const entry of entries) {
    const key = normalizeTaskTitle(entry.name);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(entry);
    grouped.set(key, current);
  }
  return grouped;
}

export function normalizeTaskTitle(value: string): string {
  const fileName = value.replaceAll("\\", "/").split("/").at(-1)?.trim() ?? value.trim();
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.trim().toLocaleLowerCase();
}

function normalizeFieldKey(value: string): string {
  return value.trim().toLocaleLowerCase();
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
  const entriesByName = groupTaskEntriesByTitle(context.taskEntries);
  const dynamicField = resolveDynamicField(context, settings.titleKey, settings.subtitleKey);
  const style = styleFromPreset(context, dynamicField, settings.style);

  for (const clip of context.targets) {
    const position = context.clips.findIndex((candidate) => candidate.id === clip.id);
    // Анонсируем следующий фильм, а не следующую строку расписания: между
    // фильмами стоят отбивки и ролики, объявлять их незачем.
    const next = position >= 0 ? nextMovieAfter(context.clips, position) : undefined;
    const nextEntries = next ? entriesByName.get(normalizeTaskTitle(next.name)) ?? [] : [];
    if (settings.source === "task-file" && nextEntries.length > 1 && next) {
      context.plan.warnings.push(
        `"${next.name}": в файле задания несколько записей с таким идентификатором — ` +
          "использовано имя ролика",
      );
    }
    const title = next
      ? (settings.source === "task-file"
          ? (nextEntries.length === 1
              ? nextEntries[0]?.values[settings.titleKey] ?? next.name
              : next.name)
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
      pushLayer(context, clip, {
        endSeconds,
        name: `${context.effect.name} → ${title}`,
        renderKey: presetCaptionRender(
          context,
          next?.name ?? clip.name,
          settings.subtitleKey,
          settings.subtitleText,
          dynamicField,
          {
            text: title,
            fontFilePath: style.fontFilePath,
            fontSizePercent: style.fontSizePercent,
          },
        ),
        startSeconds,
      });
      // Название следующего фильма остаётся настоящей надписью FFmpeg. Lottie
      // хранит только анимированный декор и подложку, ширина которой считается
      // по fitSample для конкретного следующего материала.
      pushTextOverlay(context, clip, {
        content: title,
        endSeconds,
        mode: "static",
        startSeconds,
        style,
      });
    } else {
      // Без пресета плашка рисуется штатным drawtext: эффект остаётся рабочим,
      // даже когда шаблон из After Effects ещё не готов.
      pushTextOverlay(context, clip, {
        content: settings.subtitleText ? `${title} — ${settings.subtitleText}` : title,
        endSeconds,
        mode: "static",
        startSeconds,
        style,
      });
    }
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
          clip.name,
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
          clip.name,
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
  // Переход берётся только из собственного файла. Lottie-пресет здесь больше
  // не принимается: у файла ffprobe проверяет альфу, частоту кадров и звук до
  // применения, а у шаблона проверять нечего — несовместимость всплыла бы
  // только на рендере.
  const assetPath = settings.assetPath;
  if (!assetPath) {
    context.plan.errors.push("Переход не применится: не выбран файл перехода");
    return;
  }
  if (settings.sourceKind === "sequence") {
    if (!settings.sourceFrameRate) {
      context.plan.errors.push(
        "Для последовательности .png задайте частоту кадров: в самих файлах её нет",
      );
      return;
    }
    if (settings.audioEnabled) {
      context.plan.errors.push("У последовательности .png нет звуковой дорожки");
      return;
    }
  }
  if (settings.blendMode === "alpha" && settings.sourceHasAlpha === false) {
    context.plan.errors.push(
      "У файла стингера не обнаружен альфа-канал: выберите Luma или подготовьте alpha-видео",
    );
    return;
  }
  if (settings.assetPath && settings.audioEnabled && settings.sourceHasAudio === false) {
    context.plan.errors.push("В стингере нет звуковой дорожки, но подмешивание звука включено");
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
      sourceDurationSeconds: isStinger
        ? settings.durationSeconds
        : context.preset?.durationSeconds ?? context.effect.durationSeconds,
      // Переход из пронумерованных кадров: частота задана оператором, в самих
      // .png её нет. Признаком служит именно она — по ней command-builder
      // отличает шаблон от одиночной картинки.
      sequenceFrameRate: isStinger && settings.sourceKind === "sequence"
        ? settings.sourceFrameRate
        : null,
      sequenceStartNumber: isStinger && settings.sourceKind === "sequence"
        ? settings.sequenceStartNumber
        : null,
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
      xPercent: roundPercent(overlay.style.xPercent + placement.offsetXPercent),
      yPercent: roundPercent(overlay.style.yPercent + placement.offsetYPercent),
    },
  };
  return overlay.regionXPercent == null
    ? shifted
    : { ...shifted, regionXPercent: roundPercent(overlay.regionXPercent + placement.offsetXPercent) };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Постоянная подпись на подложке: текст уходит в выбранное текстовое поле
 * пресета так же, как у Next program. Живое значение — бегущая строка, часы,
 * отсчёт — по-прежнему рисует drawtext: оно меняется покадрово, и в
 * запечённый Lottie его не положить.
 */
function presetCaptionRender(
  context: PlanContext,
  dataRecordName: string,
  captionKey: string,
  captionText: string,
  dynamicField: LottieEditableProperty | null = null,
  fitSample: LottieFitSample | null = null,
): string | null {
  if (!context.preset) return null;
  const fields = lottieTextFields(context.preset);
  const overrides: Record<string, string> = {};
  const fitSamples: Record<string, LottieFitSample> = {};

  // Все дополнительные связи из JSON Parser запекаются в соответствующие
  // поля пользовательского шаблона. Поле с живым значением ниже очищается и
  // поверх него рисуется drawtext, поэтому часы/строка остаются покадровыми.
  const record = context.taskEntries.find((entry) => entry.name.trim() === dataRecordName.trim());
  for (const [key, value] of Object.entries(record?.values ?? {})) {
    const field = fields.get(key);
    if (field) overrides[field.id] = value;
  }

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
  const sourceBox = dynamicField.textBox;
  const box = sourceBox && containTextBox(
    sourceBox,
    context.preset.width,
    context.preset.height,
    context.frameWidth,
    context.frameHeight,
  );
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
 * Переносит геометрию Text Layer из холста Lottie в эфирный кадр тем же
 * `contain`, которым command-builder масштабирует и дополняет прозрачными
 * полями сам MOV. Без этого у узкой композиции, например 1080×200, плашка
 * оказывалась по центру 16:9, а drawtext сохранял проценты исходного холста:
 * текст уезжал вниз и становился в несколько раз крупнее.
 */
export function containTextBox(
  box: NonNullable<LottieEditableProperty["textBox"]>,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): NonNullable<LottieEditableProperty["textBox"]> {
  if (
    sourceWidth <= 0 || sourceHeight <= 0 || frameWidth <= 0 || frameHeight <= 0 ||
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)
  ) return box;
  // Кроме сохранения точных значений это не даёт плавающей арифметике
  // превратить, например, 48 в 47.99999999999999 у обычного 16:9 пресета.
  if (sourceWidth * frameHeight === frameWidth * sourceHeight) return box;
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  const left = (frameWidth - fittedWidth) / 2;
  const top = (frameHeight - fittedHeight) / 2;
  return {
    ...box,
    xPercent: ((left + (box.xPercent / 100) * fittedWidth) / frameWidth) * 100,
    yPercent: ((top + (box.yPercent / 100) * fittedHeight) / frameHeight) * 100,
    fontSizePercent: ((box.fontSizePercent / 100) * sourceHeight * scale / frameHeight) * 100,
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
