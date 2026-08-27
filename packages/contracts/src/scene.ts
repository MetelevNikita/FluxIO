import { z } from "zod";

/* -------------------------------------------------------------------------- *
 * Модель сцены — шаблон титра, живущий внутри приложения.
 *
 * Сцена это дерево узлов со свойствами, а не набор кадров. Её рисует один и тот
 * же код в редакторе и в эфире, поэтому предпросмотр не может разойтись
 * с выходом, а текст не может появиться раньше своей плашки: у них одно время.
 *
 * Три правила, из которых растёт всё остальное.
 *
 * 1. Координаты и размеры — в долях кадра, не в пикселях. `x` и ширина считаются
 *    от ширины кадра, `y` и высота — от высоты. Кегли, толщины и радиусы — всегда
 *    от высоты: иначе круг перестал бы быть кругом при смене соотношения сторон.
 *
 * 2. Время берётся только из номера кадра. Рендерер следующего ролика
 *    запускается заранее, и сцена, посмотревшая на системные часы, нарисовала бы
 *    будущее — тот же капкан, что с экранными часами.
 *
 * 3. Сцена обязана уметь назвать свой ограничивающий прямоугольник. Разведка
 *    показала, что полный кадр 2160 не проходит через трубу в реальном времени,
 *    а полоса под титром проходит с запасом. Поэтому область — часть модели,
 *    а не поздняя оптимизация.
 * ------------------------------------------------------------------------- */

/**
 * Раскладочная цель. Разрешение почти ни на что не влияет — доли кадра его
 * скрывают, — а вот соотношение сторон влияет: раскладка для 16:9 в 4:3
 * не помещается, это другой кадр, а не тот же поуже.
 */
export const sceneLayoutTargetSchema = z.enum(["sd-4x3", "sd-16x9", "hd", "uhd"]);

export const sceneScanSchema = z.enum(["progressive", "interlaced"]);

/**
 * Конкретный формат выдачи. `drawRate` — сколько раз в секунду рисовать, и для
 * чересстрочной выдачи это **число полей**, а не кадров: движение, посчитанное
 * 25 раз и разложенное по 50 полям, идёт в эфире рывками.
 */
export const sceneFormatSchema = z.object({
  layout: sceneLayoutTargetSchema,
  width: z.number().int().min(160).max(7_680),
  height: z.number().int().min(120).max(4_320),
  /** Отношение сторон пикселя. У SD пиксели не квадратные, у HD и UHD равно 1. */
  pixelAspect: z.number().positive().max(4).default(1),
  drawRate: z.number().positive().max(120),
  scan: sceneScanSchema.default("progressive"),
});

/* --------------------------------- время --------------------------------- */

export const sceneEasingSchema = z.enum(["linear", "in", "out", "in-out", "bezier"]);

/**
 * Кривая ускорения между этим ключом и следующим.
 *
 * Это кубическая кривая Безье в единичном квадрате — та же математика, что у
 * `cubic-bezier()` в CSS и у графика скорости в After Effects. Именованные
 * режимы остаются: дизайнер берёт кривую тогда, когда готовых не хватает.
 *
 * По X ручки зажаты в 0..1: кривая, у которой время идёт назад, даёт
 * неоднозначное значение. По Y ограничений нет — «отскок» за пределы диапазона
 * это законный приём.
 */
export const sceneBezierSchema = z.object({
  x1: z.number().min(0).max(1).default(0.4),
  y1: z.number().min(-4).max(4).default(0),
  x2: z.number().min(0).max(1).default(0.2),
  y2: z.number().min(-4).max(4).default(1),
});

/**
 * Ключ анимации. `atSeconds` отсчитывается **от начала своего отрезка**, а не от
 * начала ролика: длительность показа задаёт оператор, и удержание растягивается,
 * а вход и выход обязаны отыграть как нарисовал дизайнер.
 */
export const sceneKeyframeSchema = z.object({
  atSeconds: z.number().nonnegative().max(3_600),
  value: z.number().finite(),
  easing: sceneEasingSchema.default("in-out"),
  /**
   * Ручки кривой; читаются только при `easing: "bezier"`. Необязательны
   * намеренно: кривую несут лишь те ключи, которым она нужна.
   */
  bezier: sceneBezierSchema.optional(),
});

/** Свойство: либо постоянное число, либо дорожка ключей внутри отрезка. */
export const sceneTrackSchema = z.object({
  value: z.number().finite(),
  inKeyframes: z.array(sceneKeyframeSchema).max(32).default([]),
  outKeyframes: z.array(sceneKeyframeSchema).max(32).default([]),
});

/**
 * Режиссёр сцены. Дизайнер отвечает за то, КАК титр появляется и уходит,
 * оператор — за то, КОГДА и НАСКОЛЬКО. Окна показа в сцене нет.
 */
export const sceneDirectorSchema = z.object({
  inSeconds: z.number().nonnegative().max(60).default(0.6),
  outSeconds: z.number().nonnegative().max(60).default(0.5),
});

/* --------------------------------- узлы ---------------------------------- */

export const sceneNodeKindSchema = z.enum([
  "group",
  "rect",
  "ellipse",
  "text",
  "image",
  "video",
]);

export const sceneAlignSchema = z.enum(["left", "center", "right"]);
export const sceneBlendSchema = z.enum(["normal", "multiply", "screen", "add"]);

/**
 * Положение и размер узла. `x` и `width` — доли ширины кадра, `y` и `height` —
 * доли высоты. Значения за пределами 0..1 разрешены: узел выезжает из-за края.
 */
export const sceneTransformSchema = z.object({
  x: sceneTrackSchema,
  y: sceneTrackSchema,
  width: sceneTrackSchema,
  height: sceneTrackSchema,
  /** Точка привязки внутри собственного прямоугольника: 0 — левый верх, 1 — правый низ. */
  anchorX: z.number().min(0).max(1).default(0),
  anchorY: z.number().min(0).max(1).default(0),
  scale: sceneTrackSchema,
  rotationDegrees: sceneTrackSchema,
  opacity: sceneTrackSchema,
});

/**
 * Тень и размытие. Радиусы — доли высоты кадра, потому что тень в два пикселя
 * убедительна на 576 и незаметна на 2160.
 */
export const sceneShadowSchema = z.object({
  enabled: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  opacity: z.number().min(0).max(1).default(0.55),
  blur: z.number().min(0).max(0.2).default(0.02),
  offsetY: z.number().min(-0.2).max(0.2).default(0.006),
});

/**
 * Привязка размера к тексту другого узла — то, ради чего сейчас живёт
 * соглашение `fit:` с промером таблиц шрифта. Здесь это свойство узла.
 */
export const sceneFitToTextSchema = z.object({
  nodeId: z.string().min(1).max(64),
  padX: z.number().min(0).max(0.5).default(0.02),
  padY: z.number().min(0).max(0.5).default(0.01),
  /** Тянуть только по ширине, только по высоте или по обеим сторонам. */
  axis: z.enum(["x", "y", "both"]).default("x"),
  /**
   * Что делать с положением, когда привязанный текст меняет длину.
   *
   * `grow` — узел стоит на месте и растёт вправо: так ведёт себя подложка.
   * `follow` — узел сохраняет свою ширину и **едет** за правым краем текста:
   * так ведёт себя хвост плашки. Без этого хвост отрывается от подложки, как
   * только текст оказывается короче или длиннее образца, — и заметно это
   * только на реальном заголовке.
   */
  anchor: z.enum(["grow", "follow"]).default("grow"),
});

export const sceneTextSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("static"), text: z.string().max(2_000).default("") }),
  z.object({ kind: z.literal("field"), fieldKey: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("clock"),
    format: z.enum(["HH:MM:SS", "HH:MM", "MM:SS", "SS"]).default("HH:MM:SS"),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  }),
  z.object({
    kind: z.literal("countdown"),
    format: z.enum(["HH:MM:SS", "HH:MM", "MM:SS", "SS"]).default("MM:SS"),
    source: z.enum(["fixed", "clip-remaining"]).default("fixed"),
    seconds: z.number().positive().max(86_400).default(60),
  }),
  z.object({
    kind: z.literal("ticker"),
    items: z.array(z.string().max(2_000)).max(200).default([]),
    separator: z.string().max(32).default("   •   "),
    speed: z.number().positive().max(2).default(0.06),
    direction: z.enum(["left", "right"]).default("left"),
  }),
]);

export const sceneTextStyleSchema = z.object({
  /** Файл шрифта, а не семейство: `drawtext` рисует конкретным файлом, и подстановка семейства уже дважды приводила к пустым прямоугольникам вместо кириллицы. */
  fontFilePath: z.string().min(1).nullable().default(null),
  fontFamily: z.string().max(256).default(""),
  size: z.number().positive().max(0.4).default(0.05),
  lineHeight: z.number().positive().max(4).default(1.2),
  letterSpacing: z.number().min(-0.02).max(0.2).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  align: sceneAlignSchema.default("left"),
  /** Обводка вокруг букв: спасает читаемость там, где нет подложки. */
  strokeWidth: z.number().min(0).max(0.02).default(0),
  strokeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
});

export const sceneRectStyleSchema = z.object({
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  fillOpacity: z.number().min(0).max(1).default(0.7),
  cornerRadius: z.number().min(0).max(0.5).default(0),
  strokeWidth: z.number().min(0).max(0.05).default(0),
  strokeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
});

/**
 * Медиа-узел сцены: подложка из видео с альфой или из последовательности `.png`.
 *
 * Такой узел **не рисуется растеризатором сцены**. Декодировать видео покадрово
 * в том же однопоточном процессе, что считает титр, — верный способ не успеть
 * к кадру; вместо этого узел разрешается в обычный FX-слой, и его кладёт
 * FFmpeg тем же путём, каким уже идут стингер и Animation in/out.
 */
export const sceneMediaStyleSchema = z.object({
  filePath: z.string().min(1).nullable().default(null),
  /** Как вписать в прямоугольник узла. */
  fit: z.enum(["contain", "cover", "stretch"]).default("contain"),
  loop: z.boolean().default(true),
  /**
   * Длительность источника в секундах, измеренная при выборе файла.
   * От неё подгоняется длина показа: титр, который короче своей подложки,
   * обрывает её на середине.
   */
  durationSeconds: z.number().nonnegative().max(86_400).default(0),
  /** Есть ли альфа-канал. Без неё узел закроет собой всё, что под ним. */
  hasAlpha: z.boolean().default(false),
  /**
   * Частота кадров последовательности. В `.png` её нет, и без неё FFmpeg
   * возьмёт своё умолчание — подложка поедет по длительности.
   */
  sequenceFrameRate: z.number().positive().max(120).nullable().default(null),
  /** Номер первого кадра последовательности. */
  sequenceStartNumber: z.number().int().nonnegative().nullable().default(null),
});

/**
 * Поправка на раскладочную цель. Обязательна, а не желательна: из-за SD 4:3
 * без неё пришлось бы держать отдельный шаблон, а это ровно то, чего мы
 * избегаем. Не заданное поле означает «как в общей сцене».
 */
export const sceneOverrideSchema = z.object({
  x: z.number().finite().nullable().default(null),
  y: z.number().finite().nullable().default(null),
  width: z.number().finite().nullable().default(null),
  height: z.number().finite().nullable().default(null),
  fontSize: z.number().positive().max(0.4).nullable().default(null),
  hidden: z.boolean().nullable().default(null),
});

const sceneNodeBase = {
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  kind: sceneNodeKindSchema,
  transform: sceneTransformSchema,
  blend: sceneBlendSchema.default("normal"),
  shadow: sceneShadowSchema.default(() => sceneShadowSchema.parse({})),
  fitToText: sceneFitToTextSchema.nullable().default(null),
  /** Поправки по раскладочным целям; ключи — значения `sceneLayoutTargetSchema`. */
  overrides: z.partialRecord(sceneLayoutTargetSchema, sceneOverrideSchema).default({}),
  text: sceneTextSourceSchema.nullable().default(null),
  textStyle: sceneTextStyleSchema.default(() => sceneTextStyleSchema.parse({})),
  rectStyle: sceneRectStyleSchema.default(() => sceneRectStyleSchema.parse({})),
  media: sceneMediaStyleSchema.default(() => sceneMediaStyleSchema.parse({})),
};

/**
 * Узел дерева. Дети хранятся плоским списком с ссылкой на родителя, а не
 * вложенностью: так проще переставлять узлы и держать порядок наложения,
 * который у нас совпадает с порядком в списке.
 */
export const sceneNodeSchema = z.object({
  ...sceneNodeBase,
  parentId: z.string().min(1).max(64).nullable().default(null),
});

/** Поле шаблона: то, что подставляет эфир. Ключ создаёт редактор, а не человек. */
export const sceneFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  type: z.enum(["text", "image", "color", "number"]).default("text"),
  /** Значение по умолчанию — оно же образец для промера плашки в редакторе. */
  sample: z.string().max(2_000).default(""),
});

export const sceneTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  /** Какие цели шаблон обязан поддерживать. Канал вещает в одном-двух форматах, проверять шесть — лишняя работа. */
  targets: z.array(sceneLayoutTargetSchema).min(1).max(4).default(["hd"]),
  director: sceneDirectorSchema.default(() => sceneDirectorSchema.parse({})),
  fields: z.array(sceneFieldSchema).max(64).default([]),
  /** Порядок в списке — порядок наложения, как и в библиотеке эффектов. */
  nodes: z.array(sceneNodeSchema).max(200).default([]),
});

export type SceneLayoutTarget = z.infer<typeof sceneLayoutTargetSchema>;
export type SceneFormat = z.infer<typeof sceneFormatSchema>;
export type SceneEasing = z.infer<typeof sceneEasingSchema>;
export type SceneBezier = z.infer<typeof sceneBezierSchema>;
export type SceneKeyframe = z.infer<typeof sceneKeyframeSchema>;
export type SceneTrack = z.infer<typeof sceneTrackSchema>;
export type SceneDirector = z.infer<typeof sceneDirectorSchema>;
export type SceneTransform = z.infer<typeof sceneTransformSchema>;
export type SceneTextSource = z.infer<typeof sceneTextSourceSchema>;
export type SceneTextStyle = z.infer<typeof sceneTextStyleSchema>;
export type SceneOverride = z.infer<typeof sceneOverrideSchema>;
export type SceneNodeKind = z.infer<typeof sceneNodeKindSchema>;
export type SceneAlign = z.infer<typeof sceneAlignSchema>;
export type SceneBlend = z.infer<typeof sceneBlendSchema>;
export type SceneShadow = z.infer<typeof sceneShadowSchema>;
export type SceneFitToText = z.infer<typeof sceneFitToTextSchema>;
export type SceneRectStyle = z.infer<typeof sceneRectStyleSchema>;
export type SceneMediaStyle = z.infer<typeof sceneMediaStyleSchema>;
export type SceneNode = z.infer<typeof sceneNodeSchema>;
export type SceneField = z.infer<typeof sceneFieldSchema>;
export type SceneTemplate = z.infer<typeof sceneTemplateSchema>;

/** Постоянное значение без анимации — самый частый случай. */
export function sceneTrack(value: number): SceneTrack {
  return { value, inKeyframes: [], outKeyframes: [] };
}
