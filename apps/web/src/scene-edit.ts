import {
  sceneNodeSchema,
  sceneTrack,
  type SceneFormat,
  type SceneKeyframe,
  type SceneLayoutTarget,
  type SceneNode,
  type SceneNodeKind,
  type SceneTemplate,
  type SceneTiming,
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
function nextNodeId(template: SceneTemplate, kind: SceneNodeKind): SceneNodeId {
  const taken = new Set(template.nodes.map((node) => node.id));
  let id = `${kind}-${++counter}`;
  while (taken.has(id)) id = `${kind}-${++counter}`;
  return id;
}

/** Имя нового узла: «Прямоугольник 2», а не «rect-7». */
type Translate = (russian: string, english: string) => string;
const russian: Translate = (value) => value;

function nextNodeName(template: SceneTemplate, kind: SceneNodeKind, tr: Translate = russian): string {
  const base = nodeKindTitle(kind, tr);
  const used = template.nodes.filter((node) => node.name.startsWith(base)).length;
  return used === 0 ? base : `${base} ${used + 1}`;
}

const nodeKindTitles: Record<SceneNodeKind, [string, string]> = {
  group: ["Группа", "Group"],
  rect: ["Прямоугольник", "Rectangle"],
  ellipse: ["Эллипс", "Ellipse"],
  text: ["Текст", "Text"],
  image: ["Картинка", "Image"],
  video: ["Видео", "Video"],
};

export function nodeKindTitle(kind: SceneNodeKind, tr: Translate = russian): string {
  return tr(...nodeKindTitles[kind]);
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
  tr: Translate = russian,
): SceneNode {
  const width = kind === "text" ? 0.36 : 0.3;
  const height = kind === "text" ? 0.08 : 0.14;
  return sceneNodeSchema.parse({
    id: nextNodeId(template, kind),
    name: nextNodeName(template, kind, tr),
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
    text: kind === "text" ? { kind: "static", text: tr("Текст", "Text") } : null,
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

/**
 * Опознаватели узла и всех его потомков.
 *
 * Всё, что делается со слоем, обязано делаться и с группой: она такой же
 * элемент списка, и «скрыть» или «дублировать» на ней, тронувшие один пустой
 * узел-родитель, снаружи выглядят как сломанные кнопки.
 */
export function descendantIds(
  template: SceneTemplate,
  nodeId: SceneNodeId,
): Set<SceneNodeId> {
  const family = new Set<SceneNodeId>([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of template.nodes) {
      if (node.parentId && family.has(node.parentId) && !family.has(node.id)) {
        family.add(node.id);
        grew = true;
      }
    }
  }
  return family;
}

/**
 * Копия узла со сдвигом, чтобы её было видно из-под оригинала.
 *
 * Группа копируется целиком, вместе с содержимым: копия пустой группы —
 * не то, что имел в виду дизайнер, нажавший «дублировать» на собранной
 * плашке. Внутренние привязки переносятся на копии, внешние снимаются.
 */
export interface SceneNodeClipboard {
  rootId: SceneNodeId;
  nodes: SceneNode[];
}

export function copyNode(template: SceneTemplate, nodeId: SceneNodeId): SceneNodeClipboard | null {
  if (!template.nodes.some((node) => node.id === nodeId)) return null;
  const family = descendantIds(template, nodeId);
  return {
    rootId: nodeId,
    nodes: structuredClone(template.nodes.filter((node) => family.has(node.id))),
  };
}

export function pasteNode(
  template: SceneTemplate,
  clipboard: SceneNodeClipboard,
  copyLabel = "копия",
): { template: SceneTemplate; nodeId: SceneNodeId | null } {
  const members = clipboard.nodes;
  if (!members.some((node) => node.id === clipboard.rootId)) {
    return { template, nodeId: null };
  }

  // Новые опознаватели раздаются заранее и все сразу: привязка внутри группы
  // обязана вести на копию, а не на исходный узел, иначе плашка копии тянется
  // по чужому тексту.
  let grown = template;
  const renamed = new Map<SceneNodeId, SceneNodeId>();
  for (const node of members) {
    const id = nextNodeId(grown, node.kind);
    renamed.set(node.id, id);
    grown = { ...grown, nodes: [...grown.nodes, { ...node, id }] };
  }

  const copies = members.map((node) => ({
    ...node,
    id: renamed.get(node.id)!,
    name: node.id === clipboard.rootId ? `${node.name} — ${copyLabel}` : node.name,
    parentId: node.parentId && renamed.has(node.parentId)
      ? renamed.get(node.parentId)!
      : node.id === clipboard.rootId && node.parentId && template.nodes.some((entry) => entry.id === node.parentId)
        ? node.parentId
        : null,
    transform: node.id === clipboard.rootId
      ? {
          ...node.transform,
          x: shiftTrack(node.transform.x, 0.02),
          y: shiftTrack(node.transform.y, 0.02),
        }
      : node.transform,
    // Привязка наружу ведёт на исходный узел: копировать её вслепую значит
    // завести две плашки на одном тексте, и вторая молча накроет первую.
    fitToText: node.fitToText && renamed.has(node.fitToText.nodeId)
      ? { ...node.fitToText, nodeId: renamed.get(node.fitToText.nodeId)! }
      : null,
    fitToNodeId: node.fitToNodeId && renamed.has(node.fitToNodeId)
      ? renamed.get(node.fitToNodeId)!
      : null,
  }));

  const nodeId = renamed.get(clipboard.rootId) ?? null;
  return { template: { ...template, nodes: [...template.nodes, ...copies] }, nodeId };
}

export function duplicateNode(
  template: SceneTemplate,
  nodeId: SceneNodeId,
  copyLabel = "копия",
): SceneTemplate {
  const clipboard = copyNode(template, nodeId);
  return clipboard ? pasteNode(template, clipboard, copyLabel).template : template;
}

/**
 * Сдвигает дорожку целиком — базовое значение и все ключи.
 *
 * Именно так обязано работать перетаскивание анимированного узла: холст рисует
 * значение **с ключей**, а не базовое, поэтому запись дельты в одно только
 * базовое значение увела бы узел куда угодно, кроме места, куда его положили.
 */
function shiftTrack(track: SceneTrack, delta: number): SceneTrack {
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

/**
 * Переносит слой или всю группу в одну точку дерева.
 *
 * `beforeSiblingId` задан в видимом порядке сверху вниз; `null` означает
 * конец списка детей. Родитель и позиция меняются одним снимком, иначе одна
 * из двух правок затирает другую.
 */
export function moveNode(
  template: SceneTemplate,
  movedId: SceneNodeId,
  parentId: SceneNodeId | null,
  beforeSiblingId: SceneNodeId | null,
): SceneTemplate {
  if (movedId === beforeSiblingId) return template;
  const moved = template.nodes.find((node) => node.id === movedId);
  if (!moved) return template;
  if (parentId && descendantIds(template, movedId).has(parentId)) return template;

  const reparented = reparentNode(template, movedId, parentId);
  const family = descendantIds(reparented, movedId);
  const block = reparented.nodes.filter((node) => family.has(node.id));
  const rest = reparented.nodes.filter((node) => !family.has(node.id));
  const siblings = rest.filter((node) => (node.parentId ?? null) === parentId);

  let insertAt = 0;
  if (beforeSiblingId) {
    const targetFamily = descendantIds(reparented, beforeSiblingId);
    const lastTarget = rest.reduce(
      (last, node, index) => targetFamily.has(node.id) ? index : last,
      -1,
    );
    insertAt = lastTarget < 0 ? rest.length : lastTarget + 1;
  } else if (siblings.length > 0) {
    const bottom = siblings.reduce((candidate, node) => {
      const candidateIndex = rest.findIndex((entry) => entry.id === candidate.id);
      const nodeIndex = rest.findIndex((entry) => entry.id === node.id);
      return nodeIndex < candidateIndex ? node : candidate;
    });
    const bottomFamily = descendantIds(reparented, bottom.id);
    const firstBottom = rest.findIndex((node) => bottomFamily.has(node.id));
    insertAt = Math.max(0, firstBottom);
  } else if (parentId) {
    const parentIndex = rest.findIndex((node) => node.id === parentId);
    insertAt = parentIndex < 0 ? rest.length : parentIndex;
  }

  return {
    ...reparented,
    nodes: [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)],
  };
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

  // Собственных границ у группы нет: её коробка — габариты содержимого, и
  // считает их раскладка. Поэтому сборка не трогает детей вовсе, а `x` и `y`
  // группы остаются нулями до первого перетаскивания.
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

/**
 * Переносит узел в группу — или наружу, если `parentId` пуст.
 *
 * Сдвиг группы складывается с ребёнком, поэтому положение узла правится ровно
 * на разницу сдвигов прежнего и нового родителя: перетаскивание в списке слоёв
 * меняет вложенность, а не место в кадре. Переезд в собственного потомка
 * отклоняется — цепочка родителей замкнулась бы в кольцо.
 */
export function reparentNode(
  template: SceneTemplate,
  nodeId: SceneNodeId,
  parentId: SceneNodeId | null,
): SceneTemplate {
  const moved = template.nodes.find((node) => node.id === nodeId);
  if (!moved || nodeId === parentId) return template;
  if ((moved.parentId ?? null) === (parentId ?? null)) return template;
  if (parentId) {
    const parent = template.nodes.find((node) => node.id === parentId);
    if (!parent || parent.kind !== "group") return template;
    if (descendantIds(template, nodeId).has(parentId)) return template;
  }

  const offsetOf = (id: SceneNodeId | null): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    let current = id;
    for (let step = 0; current && step < 8; step += 1) {
      const parent: SceneNode | undefined = template.nodes.find((node) => node.id === current);
      if (!parent) break;
      x += parent.transform.x.value;
      y += parent.transform.y.value;
      current = parent.parentId;
    }
    return { x, y };
  };
  const before = offsetOf(moved.parentId);
  const after = offsetOf(parentId);

  // Узел уезжает вместе со своими детьми: их положение задано относительно
  // него самого и трогать его не надо.
  return updateNode(template, nodeId, (node) => ({
    ...node,
    parentId,
    transform: {
      ...node.transform,
      x: shiftTrack(node.transform.x, before.x - after.x),
      y: shiftTrack(node.transform.y, before.y - after.y),
    },
  }));
}

/** Распускает группу: дети остаются на своих местах и в своём порядке. */
export function ungroupNode(
  template: SceneTemplate,
  groupId: SceneNodeId,
): SceneTemplate {
  const group = template.nodes.find((node) => node.id === groupId);
  if (!group || group.kind !== "group") return template;
  // Сдвиг группы возвращается детям: он складывался с их собственным, и без
  // возврата роспуск утащил бы содержимое на величину этого сдвига.
  const dx = group.transform.x.value;
  const dy = group.transform.y.value;
  return {
    ...template,
    nodes: template.nodes
      .filter((node) => node.id !== groupId)
      .map((node) => (node.parentId === groupId
        ? {
            ...node,
            parentId: group.parentId,
            transform: {
              ...node.transform,
              x: shiftTrack(node.transform.x, dx),
              y: shiftTrack(node.transform.y, dy),
            },
          }
        : node)),
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

/** Притягивает время к ближайшему соседнему ключу в пределах порога. */
export function snapKeyframeTime(
  value: number,
  candidates: readonly number[],
  thresholdSeconds: number,
): { value: number; snapped: boolean } {
  let nearest = value;
  let distance = thresholdSeconds + Number.EPSILON;
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - value);
    if (nextDistance <= thresholdSeconds && nextDistance < distance) {
      nearest = candidate;
      distance = nextDistance;
    }
  }
  return { value: nearest, snapped: nearest !== value };
}

/* -------------------------------- ключи ---------------------------------- */

/** Какой половине режиссёра принадлежит ключ. */
export type SceneSegmentSide = "in" | "out";

/** Положение локального ключа на общей шкале показа. */
export function absoluteKeyframeTime(
  side: SceneSegmentSide,
  localSeconds: number,
  timing: SceneTiming,
): number {
  return side === "in" ? localSeconds : timing.inSeconds + timing.holdSeconds + localSeconds;
}

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

/** У анимированной дорожки правка значения становится ключом в текущем времени. */
export function editTrackAt(
  track: SceneTrack,
  side: SceneSegmentSide,
  atSeconds: number,
  value: number,
): SceneTrack {
  return trackIsAnimated(track)
    ? setKeyframe(track, side, atSeconds, value)
    : { ...track, value };
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

/** Двигает несколько ключей одной дорожки атомарно, не затирая соседний выбранный ключ. */
export function moveKeyframes(
  track: SceneTrack,
  side: SceneSegmentSide,
  moves: readonly { fromSeconds: number; toSeconds: number }[],
): SceneTrack {
  const list = side === "in" ? track.inKeyframes : track.outKeyframes;
  const selected = moves.map((move) => ({
    key: list.find((key) => key.atSeconds === round(move.fromSeconds)),
    toSeconds: move.toSeconds,
  }));
  let next = moves.reduce(
    (current, move) => removeKeyframe(current, side, move.fromSeconds),
    track,
  );
  for (const move of selected) {
    if (!move.key) continue;
    next = setKeyframe(
      next, side, move.toSeconds, move.key.value, move.key.easing, move.key.bezier,
    );
  }
  return next;
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
  } else if (preset === "wipe" && node.kind !== "group") {
    // Развёртка по ширине: сам узел растёт от нуля. Годится для плашки, но не
    // для текста — буквы поедут и сожмутся вместе с ним.
    const w = t.width.value;
    t.width = setKeyframe(setKeyframe(clear(t.width), "in", 0, 0), "in", inSeconds, w);
    t.width = setKeyframe(setKeyframe(t.width, "out", 0, w), "out", outSeconds, 0);
  } else if (preset === "wipe") {
    // Развёртка группы — шторка: окно растёт от точки среза, содержимое стоит.
    // Ширина группы не рисуется — это рамка обрезки, — поэтому развёртка у неё
    // выражается маской, а не размером.
    t.revealMode = "wipe";
    t.reveal = setKeyframe(setKeyframe(clear(t.reveal), "in", 0, 0), "in", inSeconds, 1);
    t.reveal = setKeyframe(setKeyframe(t.reveal, "out", 0, 1), "out", outSeconds, 0);
  } else {
    // У группы ширина не рисуется — это рамка обрезки, — поэтому развёртка
    // сводится к раскрытию: иначе кнопка ставила бы ключи, ничего не меняя.
    // Раскрытие группы режет её содержимое, и всей плашке хватает одного
    // набора ключей вместо одинаковых наборов на каждом слое.
    //
    // Раскрытие — выезд из-под маски: рамка узла стоит на месте, а картинка
    // выползает из-за её края — оттуда же, где стоит точка среза. Текст при
    // этом не деформируется: едет уже готовая надпись, а не её ширина.
    // Шторка осталась «Развёрткой»: две разные картинки под одной кнопкой
    // оператор различить не смог бы.
    t.revealMode = "slide";
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
  // У группы своего размера нет — её коробка это габариты содержимого. Тянуть
  // её за ручку значит менять размер содержимого, поэтому правка уходит в
  // масштаб, а не в неиспользуемые дорожки ширины и высоты: иначе рамка
  // растягивалась бы, а картинка стояла на месте.
  if (origin.kind === "group" && (delta.dw !== undefined || delta.dh !== undefined)) {
    return scaleGroupBox(origin, delta, drawn);
  }
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
 * Изменение размера группы: масштаб содержимого вместо своей ширины.
 *
 * Масштаб накладывается вокруг точки привязки, поэтому противоположный край
 * сам собой на месте не останется — его держит поправка сдвига. Считается всё
 * от снимка на момент захвата, как и обычное перетаскивание.
 */
function scaleGroupBox(
  origin: SceneNode,
  delta: { dx?: number; dy?: number; dw?: number; dh?: number },
  drawn: { x: number; y: number; width: number; height: number },
): SceneNode {
  const minimum = 0.05;
  const kx = delta.dw !== undefined && drawn.width > 1e-6
    ? Math.max(minimum, (drawn.width + delta.dw) / drawn.width)
    : 1;
  const ky = delta.dh !== undefined && drawn.height > 1e-6
    ? Math.max(minimum, (drawn.height + delta.dh) / drawn.height)
    : 1;
  const pivotX = drawn.x + drawn.width * origin.transform.anchorX;
  const pivotY = drawn.y + drawn.height * origin.transform.anchorY;
  const transform = { ...origin.transform };
  transform.x = shiftTrack(transform.x, (delta.dx ?? 0) - (drawn.x - pivotX) * (kx - 1));
  transform.y = shiftTrack(transform.y, (delta.dy ?? 0) - (drawn.y - pivotY) * (ky - 1));
  transform.scale = { ...transform.scale, value: transform.scale.value * kx };
  // `scaleY` — множитель поверх общего масштаба, поэтому по вертикали остаётся
  // только разница между осями.
  transform.scaleY = { ...transform.scaleY, value: transform.scaleY.value * (ky / kx) };
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
  // У примыкающего узла положение задаёт правый край источника, а не
  // собственный `x`: поправка в него ничего не выравнивает, зато мусорит в
  // дорожке. Место такого узла держит сама раскладка.
  const compensates = node.kind !== "group" &&
    node.fitToNodeId === null &&
    node.fitToText?.anchor !== "follow";
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
  tr: Translate = russian,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ids = new Set(template.nodes.map((node) => node.id));
  const fieldKeys = new Set(template.fields.map((field) => field.key));

  for (const node of template.nodes) {
    if (node.fitToText && !ids.has(node.fitToText.nodeId)) {
      issues.push({
        severity: "error",
        nodeId: node.id,
        message: tr(
          `«${node.name}»: привязка ведёт на несуществующий узел — плашка не будет тянуться`,
          `“${node.name}”: the binding points to a missing node`,
        ),
      });
    }
    if (node.text?.kind === "field" && !fieldKeys.has(node.text.fieldKey)) {
      issues.push({
        severity: "error",
        nodeId: node.id,
        message: tr(
          `«${node.name}»: поле «${node.text.fieldKey}» не объявлено — в эфир уйдёт пустая строка`,
          `“${node.name}”: field “${node.text.fieldKey}” is not declared`,
        ),
      });
    }
    if (node.kind === "text" && !node.textStyle.fontFilePath) {
      issues.push({
        severity: "warning",
        nodeId: node.id,
        message: tr(
          `«${node.name}»: шрифт не выбран — кириллица может выйти пустыми прямоугольниками`,
          `“${node.name}”: no font file is selected`,
        ),
      });
    }
    if (node.kind === "text" && node.text?.kind === "field") {
      const key = node.text.fieldKey;
      const field = template.fields.find((entry) => entry.key === key);
      if (field && !field.sample) {
        issues.push({
          severity: "warning",
          nodeId: node.id,
          message: tr(
            `«${node.name}»: у поля нет образца — привязанной плашке нечем мерить ширину`,
            `“${node.name}”: the field has no sample for measuring its bound plate`,
          ),
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
        message: tr(
          `«${node.name}» выходит за зону надписей — приёмник зрителя может обрезать`,
          `“${node.name}” is outside title safe and may be cropped`,
        ),
      });
    }
  }
  if (!template.targets.includes(format.layout)) {
    issues.push({
      severity: "warning",
      message: tr(
        `Раскладка ${format.layout} не заявлена в шаблоне — правки в ней в эфир не пойдут`,
        `Layout ${format.layout} is not declared by this template`,
      ),
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
