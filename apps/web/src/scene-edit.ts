import {
  sceneNodeSchema,
  sceneTrack,
  type SceneFormat,
  type SceneKeyframe,
  type SceneLayoutTarget,
  type SceneNode,
  type SceneNodeKind,
  type SceneTemplate,
  type SceneTrack,
  type SceneBezier,
} from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Правка сцены — чистые функции.
 *
 * Здесь нет ни React, ни канвы: редактор только вызывает эти функции и кладёт
 * результат в состояние. Так же устроен планировщик эффектов, и по той же
 * причине — эту логику надо проверять тестом, а не глазами на экране.
 *
 * Все координаты — доли кадра. `x` и `width` считаются от ширины, `y`,
 * `height`, кегль и радиусы — от высоты. Смешивать нельзя: раскладка поедет
 * между 4:3 и 16:9.
 * ------------------------------------------------------------------------- */

/** Порядок в списке — порядок наложения. Первый узел лежит ниже всех. */
export type SceneNodeId = string;

let counter = 0;

/**
 * Опознаватель узла. Берётся счётчиком, а не случайным числом: шаблон
 * сравнивается в тестах, и случайность сделала бы сравнение невозможным.
 * Столкновение с уже существующим id разрешается суффиксом.
 */
export function nextNodeId(template: SceneTemplate, kind: SceneNodeKind): SceneNodeId {
  const taken = new Set(template.nodes.map((node) => node.id));
  let id = `${kind}-${++counter}`;
  while (taken.has(id)) id = `${kind}-${++counter}`;
  return id;
}

/** Имя нового узла: «Прямоугольник 2», а не «rect-7». */
export function nextNodeName(template: SceneTemplate, kind: SceneNodeKind): string {
  const base = nodeKindTitles[kind];
  const used = template.nodes.filter((node) => node.name.startsWith(base)).length;
  return used === 0 ? base : `${base} ${used + 1}`;
}

const nodeKindTitles: Record<SceneNodeKind, string> = {
  group: "Группа",
  rect: "Прямоугольник",
  ellipse: "Эллипс",
  text: "Текст",
  image: "Картинка",
  video: "Видео",
};

export function nodeKindTitle(kind: SceneNodeKind): string {
  return nodeKindTitles[kind];
}

/**
 * Новый узел по центру кадра.
 *
 * Размер намеренно крупный: узел в два процента кадра оператор не найдёт
 * мышью, а уменьшить проще, чем искать.
 */
export function createSceneNode(
  template: SceneTemplate,
  kind: SceneNodeKind,
): SceneNode {
  const width = kind === "text" ? 0.36 : 0.3;
  const height = kind === "text" ? 0.08 : 0.14;
  return sceneNodeSchema.parse({
    id: nextNodeId(template, kind),
    name: nextNodeName(template, kind),
    kind,
    transform: {
      x: sceneTrack(0.5 - width / 2),
      y: sceneTrack(0.5 - height / 2),
      width: sceneTrack(width),
      height: sceneTrack(height),
      scale: sceneTrack(1),
      rotationDegrees: sceneTrack(0),
      opacity: sceneTrack(1),
    },
    text: kind === "text" ? { kind: "static", text: "Текст" } : null,
  });
}

/* ------------------------------ состав дерева ----------------------------- */

/** Дописывает узел в конец — то есть поверх всех остальных. */
export function addNode(template: SceneTemplate, node: SceneNode): SceneTemplate {
  return { ...template, nodes: [...template.nodes, node] };
}

/**
 * Убирает узел вместе с потомками и снимает ссылки на него.
 *
 * Осиротевшая привязка `fitToText` тише всего ломает шаблон: плашка перестаёт
 * тянуться и молча выходит в эфир шаблонной ширины.
 */
export function removeNode(template: SceneTemplate, nodeId: SceneNodeId): SceneTemplate {
  const doomed = new Set<SceneNodeId>([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of template.nodes) {
      if (node.parentId && doomed.has(node.parentId) && !doomed.has(node.id)) {
        doomed.add(node.id);
        grew = true;
      }
    }
  }
  return {
    ...template,
    nodes: template.nodes
      .filter((node) => !doomed.has(node.id))
      .map((node) => (node.fitToText && doomed.has(node.fitToText.nodeId)
        ? { ...node, fitToText: null }
        : node)),
  };
}

/** Копия узла со сдвигом, чтобы её было видно из-под оригинала. */
export function duplicateNode(
  template: SceneTemplate,
  nodeId: SceneNodeId,
): SceneTemplate {
  const source = template.nodes.find((node) => node.id === nodeId);
  if (!source) return template;
  const copy: SceneNode = {
    ...source,
    id: nextNodeId(template, source.kind),
    name: `${source.name} — копия`,
    transform: {
      ...source.transform,
      x: shiftTrack(source.transform.x, 0.02),
      y: shiftTrack(source.transform.y, 0.02),
    },
    // Привязка ведёт на исходный узел: копировать её вслепую значит завести
    // две плашки на одном тексте, и вторая молча накроет первую.
    fitToText: null,
  };
  return addNode(template, copy);
}

/**
 * Сдвигает дорожку целиком — базовое значение и все ключи.
 *
 * Именно так обязано работать перетаскивание анимированного узла: холст рисует
 * значение **с ключей**, а не базовое, поэтому запись дельты в одно только
 * базовое значение увела бы узел куда угодно, кроме места, куда его положили.
 */
export function shiftTrack(track: SceneTrack, delta: number): SceneTrack {
  return {
    ...track,
    value: track.value + delta,
    inKeyframes: track.inKeyframes.map((key) => ({ ...key, value: key.value + delta })),
    outKeyframes: track.outKeyframes.map((key) => ({ ...key, value: key.value + delta })),
  };
}

/**
 * Переставляет узел перед указанным; `null` — в самый верх стопки.
 *
 * Порядок здесь тот же, что в библиотеке эффектов: список — это и есть
 * порядок наложения, и сортировать его нельзя.
 */
export function reorderNode(
  template: SceneTemplate,
  movedId: SceneNodeId,
  beforeId: SceneNodeId | null,
): SceneTemplate {
  if (movedId === beforeId) return template;
  const moved = template.nodes.find((node) => node.id === movedId);
  if (!moved) return template;
  const rest = template.nodes.filter((node) => node.id !== movedId);
  const target = beforeId ? rest.findIndex((node) => node.id === beforeId) : -1;
  const nodes = target < 0
    ? [...rest, moved]
    : [...rest.slice(0, target), moved, ...rest.slice(target)];
  return { ...template, nodes };
}

/** Точечная правка одного узла. */
export function updateNode(
  template: SceneTemplate,
  nodeId: SceneNodeId,
  update: (node: SceneNode) => SceneNode,
): SceneTemplate {
  return {
    ...template,
    nodes: template.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
  };
}

/* -------------------------------- группы --------------------------------- */

/**
 * Собирает выбранные узлы в группу.
 *
 * Группа — это узел-родитель: анимация ставится на него, а дети едут вместе с
 * ним. Так дизайнер двигает плашку с текстом и маркером как одно целое, а не
 * ставит одинаковые ключи на каждый узел и не ловит потом рассинхрон.
 *
 * Группа встаёт **на место самого верхнего** из выбранных: порядок в списке
 * это порядок наложения, и всплытие группы наверх переставило бы слои.
 */
export function groupNodes(
  template: SceneTemplate,
  nodeIds: readonly SceneNodeId[],
  name?: string,
): { template: SceneTemplate; groupId: SceneNodeId | null } {
  const chosen = new Set(nodeIds);
  const members = template.nodes.filter((node) => chosen.has(node.id));
  if (members.length < 2) return { template, groupId: null };

  const group = sceneNodeSchema.parse({
    id: nextNodeId(template, "group"),
    name: name ?? nextNodeName(template, "group"),
    kind: "group",
    transform: {
      x: sceneTrack(0), y: sceneTrack(0),
      width: sceneTrack(1), height: sceneTrack(1),
      scale: sceneTrack(1), rotationDegrees: sceneTrack(0), opacity: sceneTrack(1),
    },
  });

  const topIndex = Math.max(...members.map((node) => template.nodes.indexOf(node)));
  const nodes = template.nodes.map((node) => (chosen.has(node.id)
    ? { ...node, parentId: group.id }
    : node));
  nodes.splice(topIndex + 1, 0, group);
  return { template: { ...template, nodes }, groupId: group.id };
}

/** Распускает группу: дети остаются на своих местах и в своём порядке. */
export function ungroupNode(
  template: SceneTemplate,
  groupId: SceneNodeId,
): SceneTemplate {
  const group = template.nodes.find((node) => node.id === groupId);
  if (!group || group.kind !== "group") return template;
  return {
    ...template,
    nodes: template.nodes
      .filter((node) => node.id !== groupId)
      .map((node) => (node.parentId === groupId ? { ...node, parentId: group.parentId } : node)),
  };
}

/**
 * Делает группу контейнером по размеру одного из детей — обычно подложки.
 *
 * Без собственных границ у контейнера нечего прятать: раскрытие группы должно
 * резать содержимое по краю плашки, а не по краю кадра.
 */
export function setGroupContainer(
  template: SceneTemplate,
  groupId: SceneNodeId,
  fitToNodeId: string | null,
): SceneTemplate {
  return updateNode(template, groupId, (node) => ({
    ...node,
    fitToNodeId,
    clipsChildren: fitToNodeId !== null,
  }));
}

/** Дети группы в порядке наложения. */
export function groupChildren(
  template: SceneTemplate,
  groupId: SceneNodeId,
): SceneNode[] {
  return template.nodes.filter((node) => node.parentId === groupId);
}

/* ----------------------------- направляющие ------------------------------ */

/**
 * Безопасные зоны вещания.
 *
 * Долю берём от каждой стороны: 3,5 % — зона надписей, 5 % — зона действия
 * по EBU R 95. Это не украшение редактора: текст за границей обрежет
 * приёмник зрителя, а на мониторе дизайнера всё было в кадре.
 */
export const titleSafeInset = 0.05;
export const actionSafeInset = 0.035;

export interface SceneGuide {
  /** Доля кадра по своей оси. */
  at: number;
  axis: "x" | "y";
  kind: "safe" | "center" | "node";
  /** Чей край это, если направляющая пришла от узла. */
  nodeId?: SceneNodeId;
}

/**
 * Направляющие, к которым имеет смысл прилипать: безопасные зоны, середины
 * кадра и края остальных узлов.
 */
export function sceneGuides(
  template: SceneTemplate,
  exceptNodeId: SceneNodeId | null,
): SceneGuide[] {
  const guides: SceneGuide[] = [
    { at: titleSafeInset, axis: "x", kind: "safe" },
    { at: 1 - titleSafeInset, axis: "x", kind: "safe" },
    { at: titleSafeInset, axis: "y", kind: "safe" },
    { at: 1 - titleSafeInset, axis: "y", kind: "safe" },
    { at: 0.5, axis: "x", kind: "center" },
    { at: 0.5, axis: "y", kind: "center" },
  ];
  for (const node of template.nodes) {
    if (node.id === exceptNodeId || node.kind === "group") continue;
    const x = node.transform.x.value;
    const y = node.transform.y.value;
    const w = node.transform.width.value;
    const h = node.transform.height.value;
    guides.push(
      { at: x, axis: "x", kind: "node", nodeId: node.id },
      { at: x + w, axis: "x", kind: "node", nodeId: node.id },
      { at: x + w / 2, axis: "x", kind: "node", nodeId: node.id },
      { at: y, axis: "y", kind: "node", nodeId: node.id },
      { at: y + h, axis: "y", kind: "node", nodeId: node.id },
      { at: y + h / 2, axis: "y", kind: "node", nodeId: node.id },
    );
  }
  return guides;
}

export interface SnapResult {
  value: number;
  guide: SceneGuide | null;
}

/**
 * Притягивает одну координату к ближайшей направляющей.
 *
 * Порог задан **в пикселях экрана**, а не в долях кадра: на мелком
 * предпросмотре доля в полпроцента — это меньше пикселя, и прилипание
 * перестало бы срабатывать ровно там, где оно нужнее всего.
 */
export function snapCoordinate(
  value: number,
  edges: readonly number[],
  guides: readonly SceneGuide[],
  axis: "x" | "y",
  thresholdFraction: number,
): SnapResult {
  let best: { guide: SceneGuide; delta: number } | null = null;
  for (const guide of guides) {
    if (guide.axis !== axis) continue;
    for (const edge of edges) {
      const delta = guide.at - edge;
      if (Math.abs(delta) > thresholdFraction) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { guide, delta };
    }
  }
  return best ? { value: value + best.delta, guide: best.guide } : { value, guide: null };
}

/** Порог прилипания в долях кадра из порога в пикселях предпросмотра. */
export function snapThreshold(pixels: number, previewSizePx: number): number {
  return previewSizePx > 0 ? pixels / previewSizePx : 0;
}

/* -------------------------------- ключи ---------------------------------- */

/** Какой половине режиссёра принадлежит ключ. */
export type SceneSegmentSide = "in" | "out";

/**
 * Ставит или заменяет ключ на дорожке.
 *
 * Время отсчитывается от начала своего отрезка, а не от начала показа: вход и
 * выход живут своими часами, и удержание между ними растягивается. Ключ в той
 * же точке заменяется, а не добавляется вторым — иначе на дорожке копились бы
 * невидимые дубликаты.
 */
export function setKeyframe(
  track: SceneTrack,
  side: SceneSegmentSide,
  atSeconds: number,
  value: number,
  easing: SceneKeyframe["easing"] = "in-out",
  bezier?: SceneBezier,
): SceneTrack {
  const key: SceneKeyframe = {
    atSeconds: round(atSeconds), value, easing,
    ...(easing === "bezier" ? { bezier: bezier ?? { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } } : {}),
  };
  const list = side === "in" ? track.inKeyframes : track.outKeyframes;
  const without = list.filter((existing) => existing.atSeconds !== key.atSeconds);
  const next = [...without, key].sort((a, b) => a.atSeconds - b.atSeconds);
  return side === "in"
    ? { ...track, inKeyframes: next }
    : { ...track, outKeyframes: next };
}

export function removeKeyframe(
  track: SceneTrack,
  side: SceneSegmentSide,
  atSeconds: number,
): SceneTrack {
  const at = round(atSeconds);
  return side === "in"
    ? { ...track, inKeyframes: track.inKeyframes.filter((k) => k.atSeconds !== at) }
    : { ...track, outKeyframes: track.outKeyframes.filter((k) => k.atSeconds !== at) };
}

/** Двигает ключ по времени, сохраняя значение. */
export function moveKeyframe(
  track: SceneTrack,
  side: SceneSegmentSide,
  fromSeconds: number,
  toSeconds: number,
): SceneTrack {
  const from = round(fromSeconds);
  const list = side === "in" ? track.inKeyframes : track.outKeyframes;
  const key = list.find((existing) => existing.atSeconds === from);
  if (!key) return track;
  return setKeyframe(
    removeKeyframe(track, side, from), side, toSeconds, key.value, key.easing, key.bezier,
  );
}

/** Три знака после запятой: миллисекунда точнее любой кадровой сетки. */
function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

/**
 * Меняет кривую у ключа, не трогая его время и значение.
 *
 * Кривая описывает путь **к** этому ключу, а не от него: так же устроен
 * график скорости в After Effects, и дизайнер ждёт именно этого.
 */
export function setKeyframeEasing(
  track: SceneTrack,
  side: SceneSegmentSide,
  atSeconds: number,
  easing: SceneKeyframe["easing"],
  bezier?: SceneBezier,
): SceneTrack {
  const at = round(atSeconds);
  const patch = (key: SceneKeyframe): SceneKeyframe => (key.atSeconds === at
    ? {
        ...key,
        easing,
        ...(easing === "bezier"
          ? { bezier: bezier ?? key.bezier ?? { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } }
          : {}),
      }
    : key);
  return side === "in"
    ? { ...track, inKeyframes: track.inKeyframes.map(patch) }
    : { ...track, outKeyframes: track.outKeyframes.map(patch) };
}

/**
 * Готовые появления текста — те же, что первыми лежат в наборе After Effects.
 *
 * Это не украшение: «печатная машинка» и «буквы снизу» — половина эфирной
 * типографики, и собирать их вручную каждый раз дизайнер не станет.
 */
export const textAnimatorPresets: {
  name: string;
  nameEn: string;
  animator: SceneNode["textAnimator"];
}[] = [
  {
    name: "Буквы снизу", nameEn: "Fade Up Characters",
    animator: { enabled: true, unit: "character", effect: "fade-up", stagger: 0.55, direction: "forward" },
  },
  {
    name: "Печатная машинка", nameEn: "Typewriter",
    animator: { enabled: true, unit: "character", effect: "typewriter", stagger: 1, direction: "forward" },
  },
  {
    name: "Буквы слева", nameEn: "Slide In By Character",
    animator: { enabled: true, unit: "character", effect: "slide", stagger: 0.5, direction: "forward" },
  },
  {
    name: "Слова снизу", nameEn: "Fade Up Words",
    animator: { enabled: true, unit: "word", effect: "fade-up", stagger: 0.7, direction: "forward" },
  },
  {
    name: "Строки снизу", nameEn: "Fade Up Lines",
    animator: { enabled: true, unit: "line", effect: "fade-up", stagger: 0.8, direction: "forward" },
  },
  {
    name: "От середины", nameEn: "Center Spiral In",
    animator: { enabled: true, unit: "character", effect: "scale", stagger: 0.45, direction: "center" },
  },
  {
    name: "Буквы с конца", nameEn: "Alternating Characters In",
    animator: { enabled: true, unit: "character", effect: "fade", stagger: 0.6, direction: "backward" },
  },
];

/** Готовые кривые: то, чем дизайнер пользуется в девяти случаях из десяти. */
export const bezierPresets: { name: string; curve: SceneBezier }[] = [
  { name: "Плавно", curve: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } },
  { name: "Разгон", curve: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { name: "Торможение", curve: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { name: "Отскок", curve: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
  { name: "Резко", curve: { x1: 0.9, y1: 0, x2: 1, y2: 0.1 } },
];

/** Есть ли у дорожки хоть какая-то анимация. */
export function trackIsAnimated(track: SceneTrack): boolean {
  return track.inKeyframes.length > 0 || track.outKeyframes.length > 0;
}

/** Готовые входы: то, что дизайнер ставит первым делом. */
export type ScenePreset = "fade" | "slide-left" | "slide-up" | "wipe" | "reveal";

/**
 * Раскладывает готовый вход и симметричный ему выход по дорожкам узла.
 *
 * Выход обязан начинаться с того значения, на котором закончился вход, иначе
 * узел прыгнет в момент перехода к выходу.
 */
export function applyPreset(
  node: SceneNode,
  preset: ScenePreset,
  inSeconds: number,
  outSeconds: number,
): SceneNode {
  const t = { ...node.transform };
  const x = t.x.value;
  const y = t.y.value;

  if (preset === "fade") {
    t.opacity = setKeyframe(setKeyframe(clear(t.opacity), "in", 0, 0), "in", inSeconds, 1);
    t.opacity = setKeyframe(setKeyframe(t.opacity, "out", 0, 1), "out", outSeconds, 0);
  } else if (preset === "slide-left") {
    t.x = setKeyframe(setKeyframe(clear(t.x), "in", 0, x - 0.25), "in", inSeconds, x);
    t.x = setKeyframe(setKeyframe(t.x, "out", 0, x), "out", outSeconds, x - 0.25);
    t.opacity = setKeyframe(setKeyframe(clear(t.opacity), "in", 0, 0), "in", inSeconds * 0.6, 1);
    t.opacity = setKeyframe(setKeyframe(t.opacity, "out", outSeconds * 0.4, 1), "out", outSeconds, 0);
  } else if (preset === "slide-up") {
    t.y = setKeyframe(setKeyframe(clear(t.y), "in", 0, y + 0.18), "in", inSeconds, y);
    t.y = setKeyframe(setKeyframe(t.y, "out", 0, y), "out", outSeconds, y + 0.18);
    t.opacity = setKeyframe(setKeyframe(clear(t.opacity), "in", 0, 0), "in", inSeconds * 0.6, 1);
    t.opacity = setKeyframe(setKeyframe(t.opacity, "out", outSeconds * 0.4, 1), "out", outSeconds, 0);
  } else if (preset === "wipe") {
    // Развёртка по ширине: сам узел растёт от нуля. Годится для плашки, но не
    // для текста — буквы поедут и сожмутся вместе с ним.
    const w = t.width.value;
    t.width = setKeyframe(setKeyframe(clear(t.width), "in", 0, 0), "in", inSeconds, w);
    t.width = setKeyframe(setKeyframe(t.width, "out", 0, w), "out", outSeconds, 0);
  } else {
    // Раскрытие маской: узел стоит на месте и открывается обрезкой. Текст при
    // этом не деформируется — открывается уже готовая надпись.
    t.reveal = setKeyframe(setKeyframe(clear(t.reveal), "in", 0, 0), "in", inSeconds, 1);
    t.reveal = setKeyframe(setKeyframe(t.reveal, "out", 0, 1), "out", outSeconds, 0);
  }
  return { ...node, transform: t };
}

function clear(track: SceneTrack): SceneTrack {
  return { ...track, inKeyframes: [], outKeyframes: [] };
}

/* -------------------------------- поля ----------------------------------- */

/**
 * Ключ поля выводится из имени, а не набирается руками.
 *
 * Промах в ключе не виден: плашка молча выходит в эфир с образцом вместо
 * данных. Поэтому ключ создаёт редактор, а человек правит только подпись.
 */
export function fieldKeyFromLabel(label: string, taken: readonly string[]): string {
  const base = translit(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "field";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

const cyrillic: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(value: string): string {
  return [...value].map((ch) => cyrillic[ch.toLowerCase()] ?? ch).join("");
}

/** Объявляет поле и привязывает к нему текст узла. */
export function declareField(
  template: SceneTemplate,
  nodeId: SceneNodeId,
  label: string,
): SceneTemplate {
  const node = template.nodes.find((entry) => entry.id === nodeId);
  if (!node || node.kind !== "text") return template;
  const key = fieldKeyFromLabel(label, template.fields.map((field) => field.key));
  // Образец берём из текущего текста: он уже подобран по длине, и плашка,
  // привязанная к этому узлу, не изменит ширину в момент объявления поля.
  const sample = node.text?.kind === "static" && node.text.text ? node.text.text : label;
  return {
    ...template,
    fields: [...template.fields, { key, label, type: "text" as const, sample }],
    nodes: template.nodes.map((entry) => (entry.id === nodeId
      ? { ...entry, text: { kind: "field" as const, fieldKey: key } }
      : entry)),
  };
}

/** Снимает поле и возвращает привязанные к нему узлы к постоянному тексту. */
export function removeField(template: SceneTemplate, key: string): SceneTemplate {
  const field = template.fields.find((entry) => entry.key === key);
  return {
    ...template,
    fields: template.fields.filter((entry) => entry.key !== key),
    nodes: template.nodes.map((node) => (node.text?.kind === "field" && node.text.fieldKey === key
      ? { ...node, text: { kind: "static" as const, text: field?.sample ?? "" } }
      : node)),
  };
}

/** Значения полей для предпросмотра: образцы из объявлений. */
export function sampleFieldValues(template: SceneTemplate): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of template.fields) values[field.key] = field.sample;
  return values;
}

/* ------------------------------ поправки --------------------------------- */

/**
 * Правка узла в конкретной раскладке.
 *
 * Пока смотрят общую сцену — правка идёт в неё. Как только выбрана
 * раскладочная цель, та же правка ложится поправкой: иначе доводка SD 4:3
 * увела бы за собой HD, а это ровно то, чего мы избегаем.
 */
export function applyLayoutEdit(
  node: SceneNode,
  target: SceneLayoutTarget | null,
  patch: { x?: number; y?: number; width?: number; height?: number },
): SceneNode {
  if (!target) {
    const transform = { ...node.transform };
    if (patch.x !== undefined) transform.x = { ...transform.x, value: patch.x };
    if (patch.y !== undefined) transform.y = { ...transform.y, value: patch.y };
    if (patch.width !== undefined) transform.width = { ...transform.width, value: patch.width };
    if (patch.height !== undefined) transform.height = { ...transform.height, value: patch.height };
    return { ...node, transform };
  }
  const current = node.overrides[target] ?? {
    x: null, y: null, width: null, height: null, fontSize: null, hidden: null,
  };
  return {
    ...node,
    overrides: {
      ...node.overrides,
      [target]: {
        ...current,
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
        ...(patch.height !== undefined ? { height: patch.height } : {}),
      },
    },
  };
}

/**
 * Правка коробки узла перетаскиванием.
 *
 * `origin` — **снимок узла на момент захвата**, а `delta` считается от начала
 * перетаскивания. Так результат не зависит от того, сколько событий мыши
 * успело прийти и в каком порядке их свёл React: применение к текущему
 * значению складывало сдвиги сами с собой, и узел улетал из кадра.
 *
 * Поправка раскладки заменяет анимацию целиком, поэтому в неё пишется готовое
 * значение, а в общую сцену — сдвиг всей дорожки от снимка.
 */
export function applyBoxDrag(
  origin: SceneNode,
  target: SceneLayoutTarget | null,
  delta: { dx?: number; dy?: number; dw?: number; dh?: number },
  drawn: { x: number; y: number; width: number; height: number },
): SceneNode {
  if (target) {
    return applyLayoutEdit(origin, target, {
      ...(delta.dx !== undefined ? { x: drawn.x + delta.dx } : {}),
      ...(delta.dy !== undefined ? { y: drawn.y + delta.dy } : {}),
      ...(delta.dw !== undefined ? { width: drawn.width + delta.dw } : {}),
      ...(delta.dh !== undefined ? { height: drawn.height + delta.dh } : {}),
    });
  }
  const transform = { ...origin.transform };
  if (delta.dx !== undefined) transform.x = shiftTrack(transform.x, delta.dx);
  if (delta.dy !== undefined) transform.y = shiftTrack(transform.y, delta.dy);
  if (delta.dw !== undefined) transform.width = shiftTrack(transform.width, delta.dw);
  if (delta.dh !== undefined) transform.height = shiftTrack(transform.height, delta.dh);
  return { ...origin, transform };
}

/**
 * Переносит точку привязки, **не сдвигая узел**.
 *
 * Привязка — это то, от чего считаются поворот, масштаб и само положение.
 * Сместить её и увидеть, как узел уехал, — не то, чего ждёт дизайнер: он
 * выбирает точку отсчёта, а не двигает элемент. Поэтому вместе с привязкой
 * правится и положение, ровно на столько, чтобы картинка не изменилась.
 *
 * `box` — нарисованная коробка в долях кадра: у привязанной к тексту плашки
 * ширина считается по тексту, и брать её из базового значения нельзя.
 */
export function setNodeAnchor(
  node: SceneNode,
  anchorX: number,
  anchorY: number,
  box: { width: number; height: number },
): SceneNode {
  // У группы `x` и `y` — не положение, а сдвиг, который складывается с детьми,
  // и её собственная коробка вообще берётся от узла-подложки. Поправка,
  // которая у обычного узла оставляет картинку на месте, здесь утаскивает всё
  // содержимое группы на ширину плашки. Поэтому у группы привязка переносится
  // без поправки: она задаёт точку отсчёта поворота, масштаба и среза маски,
  // а рисунок от неё не зависит.
  const compensates = node.kind !== "group" && node.fitToNodeId === null;
  const shiftX = compensates ? box.width * (anchorX - node.transform.anchorX) : 0;
  const shiftY = compensates ? box.height * (anchorY - node.transform.anchorY) : 0;
  // Точка среза маски едет за привязкой: раскрытие обязано выезжать оттуда же,
  // откуда считается сам узел. Проверять, «не увели ли срез вручную», нельзя —
  // у шаблонов прежних версий срез стоит по старому умолчанию, и такая проверка
  // молча не сработала бы ровно там, где перенос привязки и нужен. Увести срез
  // отдельно по-прежнему можно — сеткой 3×3, уже после переноса привязки.
  return {
    ...node,
    transform: {
      ...node.transform,
      anchorX,
      anchorY,
      revealOriginX: anchorX,
      revealOriginY: anchorY,
      x: shiftTrack(node.transform.x, shiftX),
      y: shiftTrack(node.transform.y, shiftY),
    },
  };
}

/**
 * Переносит точку среза маски, **не трогая раскрытие**.
 *
 * Точка задаёт, откуда маска растёт: слева, справа, сверху, снизу или из
 * середины в обе стороны. Само раскрытие — отдельная дорожка, и менять её
 * заодно значило бы сбивать уже поставленную анимацию.
 */
export function setRevealOrigin(
  node: SceneNode,
  originX: number,
  originY: number,
): SceneNode {
  return {
    ...node,
    transform: { ...node.transform, revealOriginX: originX, revealOriginY: originY },
  };
}

/** Снимает все поправки узла для раскладки — «как в общей сцене». */
export function clearLayoutOverride(
  node: SceneNode,
  target: SceneLayoutTarget,
): SceneNode {
  const overrides = { ...node.overrides };
  delete overrides[target];
  return { ...node, overrides };
}

/* ------------------------------- проверки -------------------------------- */

export interface SceneIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: SceneNodeId;
}

/**
 * Что не так с шаблоном.
 *
 * Проверяется то, чего не видно на холсте: промах виден только в эфире, а там
 * уже поздно.
 */
export function sceneIssues(
  template: SceneTemplate,
  format: SceneFormat,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ids = new Set(template.nodes.map((node) => node.id));
  const fieldKeys = new Set(template.fields.map((field) => field.key));

  for (const node of template.nodes) {
    if (node.fitToText && !ids.has(node.fitToText.nodeId)) {
      issues.push({
        severity: "error",
        nodeId: node.id,
        message: `«${node.name}»: привязка ведёт на несуществующий узел — плашка не будет тянуться`,
      });
    }
    if (node.text?.kind === "field" && !fieldKeys.has(node.text.fieldKey)) {
      issues.push({
        severity: "error",
        nodeId: node.id,
        message: `«${node.name}»: поле «${node.text.fieldKey}» не объявлено — в эфир уйдёт пустая строка`,
      });
    }
    if (node.kind === "text" && !node.textStyle.fontFilePath) {
      issues.push({
        severity: "warning",
        nodeId: node.id,
        message: `«${node.name}»: шрифт не выбран — кириллица может выйти пустыми прямоугольниками`,
      });
    }
    if (node.kind === "text" && node.text?.kind === "field") {
      const key = node.text.fieldKey;
      const field = template.fields.find((entry) => entry.key === key);
      if (field && !field.sample) {
        issues.push({
          severity: "warning",
          nodeId: node.id,
          message: `«${node.name}»: у поля нет образца — привязанной плашке нечем мерить ширину`,
        });
      }
    }
    // Предупреждаем только о тексте. Плашка и полоса бегущей строки уходят
    // за край намеренно, и предупреждение на каждую из них — это шум, который
    // приучает не читать список. Режется незаметно именно надпись.
    if (node.kind === "text" && outsideTitleSafe(node, format)) {
      issues.push({
        severity: "warning",
        nodeId: node.id,
        message: `«${node.name}» выходит за зону надписей — приёмник зрителя может обрезать`,
      });
    }
  }
  if (!template.targets.includes(format.layout)) {
    issues.push({
      severity: "warning",
      message: `Раскладка ${format.layout} не заявлена в шаблоне — правки в ней в эфир не пойдут`,
    });
  }
  return issues;
}

function outsideTitleSafe(node: SceneNode, format: SceneFormat): boolean {
  const o = node.overrides[format.layout];
  const x = o?.x ?? node.transform.x.value;
  const y = o?.y ?? node.transform.y.value;
  const w = o?.width ?? node.transform.width.value;
  const h = o?.height ?? node.transform.height.value;
  return x < titleSafeInset - 1e-6 || y < titleSafeInset - 1e-6 ||
    x + w > 1 - titleSafeInset + 1e-6 || y + h > 1 - titleSafeInset + 1e-6;
}
