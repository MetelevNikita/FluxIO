import type {
  BroadcastDataMapping,
  BroadcastEffectKind,
  BroadcastEffectSettings,
  BroadcastTextStyle,
  ClipAudioOverlay,
  EffectDecoration,
  GraphicEffectAsset,
  GraphicEffectLayer,
  PlayoutSceneShow,
  SceneLayoutTarget,
  SceneTemplate,
  SystemFont,
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
 * что и куда положить, а `applyBroadcastPlan` возвращает новый плейлист.
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
 * Предпросмотр массового назначения до применения.
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

export interface PlannedEffectLayer {
  assetId: string;
  layer: GraphicEffectLayer;
}

/** Показ сцены, поставленный на ролик. */
export interface PlannedSceneShow {
  assetId: string;
  show: PlayoutSceneShow;
}

export interface BroadcastEffectPlan {
  layers: PlannedEffectLayer[];
  scenes: PlannedSceneShow[];
  audioOverlays: { assetId: string; overlay: ClipAudioOverlay }[];
  errors: string[];
  warnings: string[];
}

export interface PlanBroadcastEffectInput {
  effect: GraphicEffectAsset;
  clips: BroadcastTargetClip[];
  /** null — «на весь проект»; иначе только выбранные ролики. */
  targetIds: Set<string> | null;
  taskEntries: BroadcastTaskEntry[];
  frameRate: number;
  /** Размер эфирного кадра. */
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

/**
 * Семейства, с которых начинается поиск шрифта по умолчанию.
 *
 * Порядок не случаен: сначала то, что есть почти везде и уверенно несёт
 * кириллицу, потом системные гарнитуры конкретных ОС.
 */
const preferredFontFamilies = [
  "arial",
  "helvetica",
  "pt sans",
  "noto sans",
  "dejavu sans",
  "liberation sans",
  "roboto",
  "segoe ui",
  "tahoma",
  "verdana",
];

/**
 * Шрифт, которым эфирная надпись рисуется, пока оператор не выбрал свой.
 *
 * Без явного файла `drawtext` берёт встроенный шрифт FFmpeg, и кириллица
 * выходит пустыми прямоугольниками — заметно это только на выходе. Хуже того,
 * без файла нечем измерить надпись, поэтому подложка `fit:` остаётся исходной
 * ширины и длинный текст вылезает за её край.
 *
 * Поэтому берётся первый доступный шрифт с кириллицей: сначала из знакомых
 * семейств, потом любой подходящий.
 */
export function preferredTextFont(fonts: readonly SystemFont[]): SystemFont | null {
  const cyrillic = fonts.filter((font) => font.cyrillic);
  if (cyrillic.length === 0) return null;
  for (const family of preferredFontFamilies) {
    const match = cyrillic.find((font) => font.family.toLowerCase() === family);
    if (match) return match;
  }
  for (const family of preferredFontFamilies) {
    const match = cyrillic.find((font) => font.family.toLowerCase().startsWith(family));
    if (match) return match;
  }
  return cyrillic[0] ?? null;
}

/**
 * Проставляет шрифт во все стили надписей эффекта. Вид использует только свой
 * блок, но эффект можно переключить, и оставлять в остальных пустой шрифт
 * значит откладывать ту же поломку на потом.
 */
/**
 * Подставляет шрифт в текстовые узлы сцены.
 *
 * Без этого каждая новая сцена начинается с предупреждения, а шрифт по
 * умолчанию может оказаться без кириллицы — и заметно это только в эфире,
 * пустыми прямоугольниками вместо букв. Уже выбранный шрифт не трогаем:
 * это правка дизайнера.
 */
export function withSceneFont(
  scene: SceneTemplate | null,
  font: SystemFont | null,
): SceneTemplate | null {
  if (!scene || !font) return scene;
  return {
    ...scene,
    nodes: scene.nodes.map((node) => (node.kind !== "text" || node.textStyle.fontFilePath
      ? node
      : { ...node, textStyle: { ...node.textStyle, fontFilePath: font.filePath, fontFamily: font.family } })),
  };
}

/** Заявленные раскладки шаблона. Незаявленная в эфир не пойдёт. */
export function withSceneTargets(
  scene: SceneTemplate | null,
  targets: readonly SceneLayoutTarget[],
): SceneTemplate | null {
  if (!scene || targets.length === 0) return scene;
  return { ...scene, targets: [...targets] };
}

export function withDefaultTextFont(
  settings: BroadcastEffectSettings,
  font: SystemFont | null,
): BroadcastEffectSettings {
  if (!font) return settings;
  const apply = <T extends { style: BroadcastTextStyle }>(block: T): T => (
    block.style.fontFilePath
      ? block
      : { ...block, style: { ...block.style, fontFilePath: font.filePath, fontFamily: font.family } }
  );
  return {
    ...settings,
    dynamicTitle: apply(settings.dynamicTitle),
    nextProgram: apply(settings.nextProgram),
    tickerCrawl: apply(settings.tickerCrawl),
    clockCountdown: apply(settings.clockCountdown),
  };
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
  // Виды со сценой файлом не оформляются: подложку рисует сама сцена. Запись
  // остаётся ради полноты словаря — выбор файла им не предлагается.
  "dynamic-title": {
    extensions: [],
    accepts: "оформление сценой, файл не требуется",
    template: false,
  },
  "next-program": {
    extensions: [],
    accepts: "оформление сценой, файл не требуется",
    template: false,
  },
  "ticker-crawl": {
    extensions: [],
    accepts: "оформление сценой, файл не требуется",
    template: false,
  },
  "clock-countdown": {
    extensions: [],
    accepts: "оформление сценой, файл не требуется",
    template: false,
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
): string | null {
  const definition = effect.broadcast;
  if (!definition) return null;
  if (definition.kind === "stinger-transition") {
    return definition.settings.stingerTransition.assetPath
      ? null
      : "Не выбран файл перехода";
  }
  // Сцена и есть оформление: файла такому эффекту не нужно.
  if (definition.scene) return null;
  if (effectDecoration(definition) !== "file") return null;
  return definition.decorationFilePath ? null : "Не выбран файл оформления";
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
 * Универсальная плашка: сцена отвечает за декор и за строку, поэтому
 * FFmpeg. Поэтому значение можно менять для каждого ролика без повторной
 * сборки проекта After Effects, а слой `fit:<имя поля>` садится по её ширине.
 */
function planDynamicTitle(context: PlanContext): void {
  const settings = context.definition.settings.dynamicTitle;
  const scene = context.definition.scene;
  if (!scene) {
    context.plan.errors.push("У эффекта нет оформления: сцена не задана");
    return;
  }

  for (const clip of context.targets) {
    const content = resolveDynamicTitleContent(context, clip);
    if (!content) {
      context.plan.warnings.push(`"${clip.name}": текст динамической плашки пуст — эффект пропущен`);
      continue;
    }
    // Плашка и надпись — узлы одной сцены с одним временем: разойтись им нечем.
    pushScene(context, clip, scene, {
      title: content,
      subtitle: settings.captionText,
    }, settings.startSeconds, settings.durationSeconds);
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
  const filePath = context.definition.decorationFilePath;
  if (!filePath) {
    // Сам эффект и есть «показать графику»: без файла показывать нечего.
    context.plan.errors.push("Animation in/out needs an alpha media file");
    return;
  }

  for (const clip of context.targets) {
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
        assetPath: filePath,
        endSeconds: window.endSeconds,
        name: `${context.effect.name} ${window.label}`,
        startSeconds: window.startSeconds,
      });
    }
  }
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
  const scene = context.definition.scene;
  if (!scene) {
    context.plan.errors.push("У эффекта нет оформления: сцена не задана");
    return;
  }
  const entriesByName = groupTaskEntriesByTitle(context.taskEntries);

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
    const nextTitle = next ? clipDisplayTitle(next.name) : "";
    const title = next
      ? (settings.source === "task-file" && nextEntries.length === 1
          ? nextEntries[0]?.values[settings.titleKey] ?? nextTitle
          : nextTitle)
      : settings.fallbackTitle;
    if (!title) {
      context.plan.warnings.push(
        `"${clip.name}" is the last clip and has no fallback title, so the promo is skipped`,
      );
      continue;
    }
    pushScene(context, clip, scene, {
      title,
      subtitle: settings.subtitleText,
    }, clip.durationSeconds - settings.startOffsetSeconds, settings.durationSeconds);
  }
}

/**
 * Ближайший фильм после позиции `position`. Если расписание не размечено по
 * типам вовсе, берётся просто следующий элемент — иначе на ручном плейлисте
 * эффект не сработал бы никогда.
 */
/**
 * Имя ролика в том виде, в котором его не стыдно показать в эфире.
 *
 * В расписании лежит имя файла, и в анонс уходило оно целиком — вместе с путём
 * и расширением: «… setup Ive always wanted [get-save.com].mp4». Убираем
 * каталог и расширение; остальное трогать нельзя, иначе у фильма вида
 * «Титаник [1997]» пропал бы год.
 *
 * Настоящее название всё равно берётся из файла задания — это лишь то, что
 * можно сделать, имея одно имя файла.
 */
export function clipDisplayTitle(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base.trim() || name.trim();
  // Список, а не длина хвоста: «S01.E02.Пилот» расширения не имеет, а по длине
  // «.Пилот» на него похож — и название потеряло бы последнее слово.
  const extension = base.slice(dot + 1).toLowerCase();
  const withoutExtension = mediaExtensions.has(extension) ? base.slice(0, dot) : base;
  return withoutExtension.trim() || name.trim();
}

const mediaExtensions = new Set([
  "mp4", "mov", "mxf", "mkv", "avi", "m4v", "webm", "ts", "m2ts", "mts",
  "mpg", "mpeg", "wmv", "flv", "vob", "m2v", "dv", "gxf", "lxf",
]);

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
  const scene = context.definition.scene;
  if (!scene) {
    context.plan.errors.push("У эффекта нет оформления: сцена не задана");
    return;
  }
  const content = joinTickerItems(settings.items, settings.separator);
  if (!content) {
    context.plan.errors.push("The ticker has no messages to show");
    return;
  }

  // Строка обрезается по своему узлу сцены, поэтому отдельный прозрачный холст
  // ради обрезки больше не нужен.
  const withItems = withTickerItems(scene, settings.items, settings.separator);
  for (const clip of context.targets) {
    pushScene(
      context, clip, withItems, { ticker: content },
      settings.startSeconds, settings.durationSeconds,
    );
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
  const scene = context.definition.scene;
  if (!scene) {
    context.plan.errors.push("У эффекта нет оформления: сцена не задана");
    return;
  }

  // Часы идут по эфирному времени ролика, а не по системным: рендерер
  // следующего ролика запускается заранее и нарисовал бы будущее.
  const withMode = withClockMode(scene, settings);
  for (const clip of context.targets) {
    pushScene(context, clip, withMode, {}, settings.startSeconds, settings.durationSeconds);
  }
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
  // Переход берётся только из собственного файла. Шаблон здесь больше
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
      sourceInSeconds: 0,
      startSeconds: clip.durationSeconds - tailSeconds,
    });
    pushLayer(context, next, {
      assetPath,
      endSeconds: headSeconds,
      name: `${context.effect.name} ← ${clip.name}`,
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

/**
 * Переносит сообщения бегущей строки в её узел.
 *
 * Список живёт в настройках эффекта — оператор правит его там же, где источник
 * и скорость, — а рисует его узел сцены. Здесь они встречаются.
 */
function withTickerItems(
  scene: SceneTemplate,
  items: readonly string[],
  separator: string,
): SceneTemplate {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => node.text?.kind !== "ticker" ? node : {
      ...node,
      text: { ...node.text, items: [...items], separator },
    }),
  };
}

/** Переносит режим часов и формат из настроек эффекта в узел сцены. */
function withClockMode(
  scene: SceneTemplate,
  settings: BroadcastEffectSettings["clockCountdown"],
): SceneTemplate {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      if (node.text?.kind !== "clock" && node.text?.kind !== "countdown") return node;
      return {
        ...node,
        text: settings.mode === "clock"
          ? {
              kind: "clock" as const,
              format: settings.format,
              timezoneOffsetMinutes: settings.timezoneOffsetMinutes,
            }
          : {
              kind: "countdown" as const,
              format: settings.format,
              source: settings.countdownSource,
              seconds: settings.countdownSeconds,
            },
      };
    }),
  };
}

/**
 * Ставит показ сцены на ролик.
 *
 * Оператор задаёт момент и длительность; как титр появляется и уходит — дело
 * шаблона. Поэтому окна показа здесь нет: режиссёр укладывает вход и выход
 * внутрь длительности сам, и текст с плашкой разойтись не могут.
 */
function pushScene(
  context: PlanContext,
  clip: BroadcastTargetClip,
  scene: SceneTemplate,
  fields: Record<string, string>,
  startSeconds: number,
  durationSeconds: number,
): void {
  const start = Math.max(0, startSeconds);
  const available = clip.durationSeconds - start;
  if (available <= minimumWindowSeconds) {
    context.plan.warnings.push(
      `"${clip.name}": показ не помещается в ролик — пропущен`,
    );
    return;
  }
  if (durationSeconds > available) {
    context.plan.warnings.push(
      `"${clip.name}": показ обрезан по концу ролика`,
    );
  }
  const shown = Math.min(durationSeconds, available);
  context.plan.scenes.push({
    assetId: clip.id,
    show: {
      id: `scene-${context.createId()}`,
      effectId: context.effect.id,
      template: scene,
      fields,
      startSeconds: start,
      durationSeconds: shown,
    },
  });
  pushSceneMedia(context, clip, scene, start, shown);
}

/**
 * Медиа-узлы сцены — отдельными FX-слоями.
 *
 * Растеризатор сцены их не рисует: декодировать видео покадрово в том же
 * однопоточном процессе, что считает титр, — верный способ не успеть к кадру.
 * Слои кладутся **до** показа сцены, поэтому текст ложится поверх подложки.
 */
function pushSceneMedia(
  context: PlanContext,
  clip: BroadcastTargetClip,
  scene: SceneTemplate,
  startSeconds: number,
  durationSeconds: number,
): void {
  for (const node of scene.nodes) {
    if (node.kind !== "video" && node.kind !== "image") continue;
    const filePath = node.media.filePath;
    if (!filePath) continue;
    if (!node.media.hasAlpha) {
      context.plan.warnings.push(
        `"${clip.name}": подложка «${node.name}» без альфа-канала закроет собой всё, что под ней`,
      );
    }
    context.plan.layers.push({
      assetId: clip.id,
      layer: {
        id: `fx-${context.createId()}`,
        effectId: context.effect.id,
        name: node.name,
        filePath,
        kind: node.kind === "video" ? "video" : "static",
        sourceDurationSeconds: node.media.durationSeconds,
        sourceInSeconds: 0,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        blendMode: "alpha",
        lumaThreshold: 0.08,
        sequenceFrameRate: node.media.sequenceFrameRate,
        sequenceStartNumber: node.media.sequenceStartNumber,
        // Медиа-узел стоит там же, где стоял бы нарисованный: положение
        // задаётся сценой, а слой накрывает кадр целиком со сдвигом.
        offsetXPercent: context.definition.placement.offsetXPercent,
        offsetYPercent: context.definition.placement.offsetYPercent,
        tier: 2,
        titlePaths: [],
      },
    });
  }
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
    sourceInSeconds?: number;
    startSeconds: number;
  },
): void {
  const settings = context.definition.settings.stingerTransition;
  const filePath = options.assetPath
    ?? context.definition.decorationFilePath
    ?? context.effect.filePath;
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
        : context.effect.durationSeconds,
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

function clampStart(value: number, clipDuration: number): number {
  return Math.min(Math.max(0, value), Math.max(0, clipDuration - minimumWindowSeconds));
}

function clampEnd(value: number, startSeconds: number, clipDuration: number): number {
  return Math.min(Math.max(value, startSeconds + minimumWindowSeconds), clipDuration);
}

function emptyPlan(): BroadcastEffectPlan {
  return {
    audioOverlays: [], errors: [], layers: [], scenes: [], warnings: [],
  };
}

/* -------------------------------------------------------------------------- *
 * Применение плана к плейлисту
 * -------------------------------------------------------------------------- */

/** Кладёт рассчитанный план в плейлист. */
export function applyBroadcastPlan(
  assets: readonly MediaAsset[],
  plan: BroadcastEffectPlan,
): { items: MediaAsset[]; touched: number } {
  const layersByAsset = groupBy(plan.layers, (entry) => entry.assetId);
  const audioByAsset = groupBy(plan.audioOverlays, (entry) => entry.assetId);
  const scenesByAsset = groupBy(plan.scenes, (entry) => entry.assetId);
  let touched = 0;
  const items = assets.map((asset) => {
    const layers = layersByAsset.get(asset.id) ?? [];
    const audio = audioByAsset.get(asset.id) ?? [];
    const scenes = scenesByAsset.get(asset.id) ?? [];
    if (
      layers.length === 0 && audio.length === 0 && scenes.length === 0
    ) return asset;
    touched += 1;
    return {
      ...asset,
      effects: [
        ...(asset.effects ?? []),
        ...layers.map((entry) => entry.layer),
      ],
      audioOverlays: [...(asset.audioOverlays ?? []), ...audio.map((entry) => entry.overlay)],
      scenes: [...(asset.scenes ?? []), ...scenes.map((entry) => entry.show)],
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
    audioOverlays: asset.audioOverlays?.filter((overlay) => overlay.effectId !== effectId),
    scenes: asset.scenes?.filter((show) => show.effectId !== effectId),
  }));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/* -------------------------------------------------------------------------- *
 * Эффект как одна сущность на таймлайне
 * -------------------------------------------------------------------------- */

/**
 * Эффект второго уровня лежит на ролике несколькими сущностями сразу: файл
 * оформления, живая надпись, иногда звуковая вставка. Планировщик создаёт их
 * с одним и тем же окном, но на таймлайне они были отдельными дорожками — и
 * подрезка одной не двигала остальные. Снаружи это выглядело так: плашка
 * отыграла и исчезла, а надпись осталась висеть в кадре.
 *
 * Поэтому окно у эффекта одно, а дорожка на таймлайне — одна на эффект.
 */
export interface BroadcastEffectSpan {
  key: string;
  effectId: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  layerIds: string[];
  sceneShowIds: string[];
  audioOverlayIds: string[];
  /** Из чего собрана дорожка — показывается оператору в подписи. */
  parts: ("graphics" | "scene" | "audio")[];
}

interface BroadcastSpanSource {
  effects?: GraphicEffectLayer[] | undefined;
  scenes?: PlayoutSceneShow[] | undefined;
  audioOverlays?: ClipAudioOverlay[] | undefined;
}

/**
 * Чем части эффекта объединяются в одну дорожку: общий эффект и общее окно.
 *
 * Группа считается по окну, но её **ключ окном быть не может**: при
 * перетаскивании окно меняется, ключ бы менялся вместе с ним, и следующее же
 * движение мыши не нашло бы дорожку — эффект замирал после первого шага.
 * Поэтому ключ берётся от опознавателей частей: они переживают любой перенос.
 */
function windowGroup(effectId: string, startSeconds: number, endSeconds: number): string {
  return `${effectId}|${startSeconds.toFixed(3)}|${endSeconds.toFixed(3)}`;
}

/**
 * Дорожки таймлайна: по одной на эффект второго уровня и по одной на каждый
 * слой уровня 3.
 *
 * Уровень 3 намеренно не группируется: один и тот же файл можно положить на
 * ролик несколько раз независимыми слоями, и склеивать их по имени нельзя.
 * Animation in/out даёт два окна — вход и выход — с одним `effectId`; они
 * остаются разными дорожками, потому что ключ включает само окно.
 */
export function broadcastEffectSpans(asset: BroadcastSpanSource): BroadcastEffectSpan[] {
  const spans = new Map<string, BroadcastEffectSpan>();
  const order: string[] = [];

  const ensure = (
    group: string,
    memberId: string,
    effectId: string,
    name: string,
    start: number,
    end: number,
  ) => {
    let span = spans.get(group);
    if (!span) {
      span = {
        // Ключ от первой части группы: он не меняется при переносе дорожки.
        key: `${effectId}:${memberId}`,
        effectId,
        name,
        startSeconds: start,
        endSeconds: end,
        layerIds: [],
        sceneShowIds: [],
        audioOverlayIds: [],
        parts: [],
      };
      spans.set(group, span);
      order.push(group);
    }
    return span;
  };

  for (const layer of asset.effects ?? []) {
    const group = layer.tier === 2
      ? windowGroup(layer.effectId, layer.startSeconds, layer.endSeconds)
      : `layer:${layer.id}`;
    const span = ensure(
      group, layer.id, layer.effectId, layer.name, layer.startSeconds, layer.endSeconds,
    );
    span.layerIds.push(layer.id);
    if (!span.parts.includes("graphics")) span.parts.push("graphics");
  }

  // Показ сцены — такая же часть эффекта, как FX-слой: без него у эффекта со
  // сценой не было бы дорожки вовсе, и оператор не смог бы его ни подвинуть,
  // ни подрезать.
  for (const show of asset.scenes ?? []) {
    const end = show.startSeconds + show.durationSeconds;
    const group = windowGroup(show.effectId, show.startSeconds, end);
    const span = ensure(
      group, show.id, show.effectId, show.template.name, show.startSeconds, end,
    );
    span.sceneShowIds.push(show.id);
    if (!span.parts.includes("scene")) span.parts.push("scene");
  }

  for (const overlay of asset.audioOverlays ?? []) {
    const end = overlay.startSeconds + overlay.durationSeconds;
    const group = windowGroup(overlay.effectId, overlay.startSeconds, end);
    const span = ensure(group, overlay.id, overlay.effectId, "", overlay.startSeconds, end);
    span.audioOverlayIds.push(overlay.id);
    if (!span.parts.includes("audio")) span.parts.push("audio");
  }

  return order.map((group) => spans.get(group)!);
}

/**
 * Переносит окно эффекта целиком: все его части получают одно и то же начало и
 * конец. Половину эффекта сдвинуть нельзя — именно из-за этого надпись
 * переживала свою плашку.
 */
export function retimeBroadcastEffectSpan(
  asset: BroadcastSpanSource,
  span: BroadcastEffectSpan,
  startSeconds: number,
  endSeconds: number,
): {
  effects: GraphicEffectLayer[];
  scenes: PlayoutSceneShow[];
  audioOverlays: ClipAudioOverlay[];
} {
  const layerIds = new Set(span.layerIds);
  const sceneIds = new Set(span.sceneShowIds);
  const audioIds = new Set(span.audioOverlayIds);
  return {
    effects: (asset.effects ?? []).map((layer) =>
      layerIds.has(layer.id) ? { ...layer, startSeconds, endSeconds } : layer),
    scenes: (asset.scenes ?? []).map((show) =>
      sceneIds.has(show.id)
        ? { ...show, startSeconds, durationSeconds: Math.max(0.04, endSeconds - startSeconds) }
        : show),
    audioOverlays: (asset.audioOverlays ?? []).map((overlay) =>
      audioIds.has(overlay.id)
        ? { ...overlay, startSeconds, durationSeconds: Math.max(0.04, endSeconds - startSeconds) }
        : overlay),
  };
}

/** Снимает с ролика все части одной дорожки. */
export function removeBroadcastEffectSpan(
  asset: BroadcastSpanSource,
  span: BroadcastEffectSpan,
): {
  effects: GraphicEffectLayer[];
  scenes: PlayoutSceneShow[];
  audioOverlays: ClipAudioOverlay[];
} {
  const layerIds = new Set(span.layerIds);
  const sceneIds = new Set(span.sceneShowIds);
  const audioIds = new Set(span.audioOverlayIds);
  return {
    effects: (asset.effects ?? []).filter((layer) => !layerIds.has(layer.id)),
    scenes: (asset.scenes ?? []).filter((show) => !sceneIds.has(show.id)),
    audioOverlays: (asset.audioOverlays ?? []).filter((overlay) => !audioIds.has(overlay.id)),
  };
}
