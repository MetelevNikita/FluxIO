import {
  resolveNodeBox,
  sceneTiming,
  type SceneFormat,
  type SceneLayoutTarget,
  type SceneNode,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  drawScene,
  measureSceneText,
  type SceneDrawInput,
  type SceneSurface,
} from "@gruber/scene-renderer";
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  actionSafeInset,
  applyBoxDrag,
  sceneGuides,
  snapCoordinate,
  snapThreshold,
  titleSafeInset,
  type SceneGuide,
} from "../scene-edit";

/* -------------------------------------------------------------------------- *
 * Холст редактора.
 *
 * Картинку рисует `drawScene` — **та же функция, что и эфир**. Своего кода
 * отрисовки у редактора нет и быть не должно: как только он появится,
 * предпросмотр начнёт расходиться с выходом.
 *
 * Поверх холста лежит слой разметки: безопасные зоны, направляющие и ручки
 * выделения. Он в кадр не попадает — это оснастка редактора.
 * ------------------------------------------------------------------------- */

/** За какую часть узла взялись мышью. */
type Grip = "move" | "nw" | "ne" | "sw" | "se";

interface DragState {
  grip: Grip;
  /**
   * Узел, за который взялись.
   *
   * Берётся здесь, а не из выделения: выделение обновляется следующим
   * отрисовыванием, и первые движения мыши применились бы к прежнему узлу.
   */
  nodeId: string;
  pointerId: number;
  /** Доли кадра в момент нажатия. */
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  /**
   * Снимок узла на момент захвата.
   *
   * Всё перетаскивание считается от него: применение к текущему значению
   * складывало сдвиги сами с собой, а пересчёт от прежнего шага терялся, когда
   * React сводил несколько событий мыши в одну отрисовку.
   */
  origin: SceneNode;
  /** Положение указателя в долях кадра. */
  fromX: number;
  fromY: number;
}

export interface SceneCanvasProps {
  template: SceneTemplate;
  format: SceneFormat;
  /** Длительность показа: от неё режиссёр считает удержание. */
  durationSeconds: number;
  timeSeconds: number;
  fields: Readonly<Record<string, string>>;
  selectedId: string | null;
  /** Весь набор выбранного: подсвечивается, но правится активный. */
  selectedIds: readonly string[];
  /** Кадр из плейлиста под сценой; пусто — шахматка. */
  backdropUrl: string | null;
  showSafeAreas: boolean;
  onSelect: (nodeId: string | null, additive?: boolean) => void;
  /** Куда идут правки: `null` — в общую сцену, иначе поправкой раскладки. */
  editTarget: SceneLayoutTarget | null;
  /** Готовый узел: холст считает его от снимка на момент захвата. */
  onTransform: (nodeId: string, node: SceneNode) => void;
  /**
   * Нарисованная коробка выделенного узла в долях кадра.
   *
   * Инспектору она нужна для переноса привязки: у плашки, привязанной к
   * тексту, ширина считается по тексту, и базовое значение тут не годится.
   */
  onSelectedBox: (box: { width: number; height: number } | null) => void;
  /**
   * Правка текста прямо в кадре по двойному щелчку.
   *
   * Экран решает, куда её записать: у статичного узла — в сам текст, у
   * привязанного к полю — в образец поля. Холст этого различия не знает.
   */
  onEditText: (node: SceneNode, value: string) => void;
}

export function SceneCanvas({
  template, format, durationSeconds, timeSeconds, fields,
  selectedId, selectedIds, backdropUrl, showSafeAreas, editTarget, onSelect, onTransform, onSelectedBox,
  onEditText,
}: SceneCanvasProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Крошечное полотно только для промера строк. */
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<SceneGuide[]>([]);
  /** Узел, который правят прямо в кадре, и черновик его строки. */
  const [editing, setEditing] = useState<{ nodeId: string; value: string } | null>(null);

  // Холст занимает всю доступную ширину и держит соотношение сторон кадра.
  // Соотношение берём из формата, а не из окна: у SD пиксель не квадратный,
  // и без поправки 4:3 выглядел бы растянутым.
  const displayAspect = (format.width * format.pixelAspect) / format.height;

  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => {
      const available = element.clientWidth;
      const byHeight = element.clientHeight * displayAspect;
      const width = Math.max(160, Math.min(available, byHeight));
      setSize({ width: Math.round(width), height: Math.round(width / displayAspect) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayAspect]);

  const timing = sceneTiming(template.director, durationSeconds);

  /** Формат в пикселях предпросмотра: доли сцены дают ту же картинку меньше. */
  const previewFormat = useMemo(
    () => ({ ...format, width: size.width, height: size.height }),
    [format, size],
  );

  const drawInput = useMemo<SceneDrawInput>(() => ({
    frameWidth: size.width,
    frameHeight: size.height,
    originX: 0,
    originY: 0,
    timeSeconds,
    fields,
    images: {},
    airEpochSeconds: 0,
    clipRemainingSeconds: durationSeconds - timeSeconds,
  }), [size, timeSeconds, fields, durationSeconds]);

  /**
   * Ширины строк — **один** промер на отрисовку.
   *
   * Он нужен не только рисунку: привязанная плашка тянется по тексту, и без
   * промера зона захвата мышью считается по базовой ширине. Снаружи это
   * выглядит как «элемент не там, где нарисован»: берёшь за плашку, а
   * хватается пустое место рядом.
   */
  const widths = useMemo(() => {
    if (size.width === 0) return {};
    rulerRef.current ??= document.createElement("canvas");
    const context = rulerRef.current.getContext("2d");
    if (!context) return {};
    return measureSceneText(
      context as unknown as SceneSurface, template, previewFormat, drawInput,
    );
  }, [template, previewFormat, drawInput, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    // Кадр для отрисовки — это сам предпросмотр. Все координаты сцены заданы
    // долями, поэтому уменьшённый кадр даёт ту же картинку без единой поправки.
    drawScene(
      context as unknown as SceneSurface,
      template, previewFormat, timing, drawInput, widths,
    );
  }, [template, previewFormat, timing, drawInput, widths, size]);

  const selected = template.nodes.find((node) => node.id === selectedId) ?? null;

  function pointToFraction(event: ReactPointerEvent): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  /**
   * Коробка узла в долях кадра — ровно та, что нарисована.
   *
   * Считается тем же промером, что и рисунок: иначе привязанная плашка
   * захватывается мышью не там, где её видно.
   */
  function boxOf(node: SceneNode) {
    const box = resolveNodeBox(node, template, previewFormat, timing, timeSeconds, widths);
    return {
      ...box,
      x: size.width ? box.x / size.width : 0,
      y: size.height ? box.y / size.height : 0,
      width: size.width ? box.width / size.width : 0,
      height: size.height ? box.height / size.height : 0,
    };
  }

  function handlePointerDown(event: ReactPointerEvent, grip: Grip, node: SceneNode) {
    event.stopPropagation();
    const point = pointToFraction(event);
    const box = boxOf(node);
    // Выделение идёт первым: захват указателя может не состояться — например,
    // у события без живого указателя, — и выделение не должно от этого зависеть.
    onSelect(node.id, event.ctrlKey || event.metaKey);
    dragRef.current = {
      grip,
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: box.x, startY: box.y, startW: box.width, startH: box.height,
      origin: node,
      fromX: point.x, fromY: point.y,
    };
    try { (event.target as Element).setPointerCapture(event.pointerId); } catch { /* захвата не будет */ }
  }

  /**
   * Отдаёт готовый узел, посчитанный от снимка на момент захвата.
   *
   * Это единственное место, где перетаскивание уходит наружу. Разницу от
   * прежнего шага отдавать нельзя: сдвиги либо складываются сами с собой,
   * либо теряются, когда React сводит несколько событий мыши в одну отрисовку.
   */
  function emit(box: { x: number; y: number; width: number; height: number }) {
    const drag = dragRef.current;
    if (!drag) return;
    onTransform(drag.nodeId, applyBoxDrag(
      drag.origin,
      editTarget,
      {
        dx: box.x - drag.startX,
        dy: box.y - drag.startY,
        dw: box.width - drag.startW,
        dh: box.height - drag.startH,
      },
      { x: drag.startX, y: drag.startY, width: drag.startW, height: drag.startH },
    ));
  }

  function handlePointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointToFraction(event);
    const dx = point.x - drag.fromX;
    const dy = point.y - drag.fromY;
    // Порог прилипания задан в пикселях экрана: на мелком предпросмотре доля
    // кадра меньше пикселя, и прилипание перестало бы срабатывать.
    const thresholdX = snapThreshold(7, size.width);
    const thresholdY = snapThreshold(7, size.height);
    const all = sceneGuides(template, drag.nodeId);
    const hit: SceneGuide[] = [];

    if (drag.grip === "move") {
      const rawX = drag.startX + dx;
      const rawY = drag.startY + dy;
      const sx = snapCoordinate(rawX, [rawX, rawX + drag.startW, rawX + drag.startW / 2], all, "x", thresholdX);
      const sy = snapCoordinate(rawY, [rawY, rawY + drag.startH, rawY + drag.startH / 2], all, "y", thresholdY);
      if (sx.guide) hit.push(sx.guide);
      if (sy.guide) hit.push(sy.guide);
      emit({ x: sx.value, y: sy.value, width: drag.startW, height: drag.startH });
    } else {
      // Тянем за угол: противоположный угол стоит на месте, поэтому левые и
      // верхние ручки двигают и начало, и размер сразу.
      const west = drag.grip === "nw" || drag.grip === "sw";
      const north = drag.grip === "nw" || drag.grip === "ne";
      const minimum = 0.01;
      let x = drag.startX;
      let y = drag.startY;
      let width = drag.startW;
      let height = drag.startH;

      if (event.shiftKey) {
        // Пропорция считается от **большего** смещения: иначе при движении
        // строго по одной оси вторая сторона не меняется вовсе, и Shift
        // выглядит сломанным.
        const ratio = drag.startH / Math.max(1e-6, drag.startW);
        const byX = Math.abs(dx) >= Math.abs(dy) * (size.height / Math.max(1, size.width));
        const deltaW = byX ? dx * (west ? -1 : 1) : (dy * (north ? -1 : 1)) / ratio;
        width = Math.max(minimum, drag.startW + deltaW);
        height = Math.max(minimum, width * ratio);
        if (west) x = drag.startX + drag.startW - width;
        if (north) y = drag.startY + drag.startH - height;
        emit({ x, y, width, height });
        setGuides([]);
        return;
      }

      if (west) {
        const edge = snapCoordinate(drag.startX + dx, [drag.startX + dx], all, "x", thresholdX);
        if (edge.guide) hit.push(edge.guide);
        width = Math.max(minimum, drag.startX + drag.startW - edge.value);
        x = drag.startX + drag.startW - width;
      } else {
        const edge = snapCoordinate(drag.startX + drag.startW + dx, [drag.startX + drag.startW + dx], all, "x", thresholdX);
        if (edge.guide) hit.push(edge.guide);
        width = Math.max(minimum, edge.value - drag.startX);
      }
      if (north) {
        const edge = snapCoordinate(drag.startY + dy, [drag.startY + dy], all, "y", thresholdY);
        if (edge.guide) hit.push(edge.guide);
        height = Math.max(minimum, drag.startY + drag.startH - edge.value);
        y = drag.startY + drag.startH - height;
      } else {
        const edge = snapCoordinate(drag.startY + drag.startH + dy, [drag.startY + drag.startH + dy], all, "y", thresholdY);
        if (edge.guide) hit.push(edge.guide);
        height = Math.max(minimum, edge.value - drag.startY);
      }
      emit({ x, y, width, height });
    }
    setGuides(hit);
  }

  function endDrag(event: ReactPointerEvent) {
    if (!dragRef.current) return;
    try { (event.target as Element).releasePointerCapture(dragRef.current.pointerId); } catch { /* уже отпущен */ }
    dragRef.current = null;
    setGuides([]);
  }

  const editingNode = editing
    ? template.nodes.find((node) => node.id === editing.nodeId) ?? null
    : null;
  const editingBox = editingNode ? boxOf(editingNode) : null;

  const selectedBox = selected ? boxOf(selected) : null;
  const reportedBox = selectedBox ? { width: selectedBox.width, height: selectedBox.height } : null;
  useEffect(() => {
    onSelectedBox(reportedBox);
    // Ширина и высота — единственное, что нужно инспектору: следить за всей
    // коробкой значило бы дёргать его на каждый кадр проигрывания.
  }, [reportedBox?.width, reportedBox?.height, onSelectedBox]);
  const pct = (value: number) => `${value * 100}%`;

  return (
    <div className="scene-canvas-box" ref={boxRef}>
      <div
        className="scene-canvas-stage"
        style={{ width: size.width, height: size.height }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {backdropUrl
          ? <img alt="" className="scene-canvas-backdrop" src={backdropUrl} />
          : <div className="scene-canvas-backdrop scene-canvas-checker" />}
        <canvas className="scene-canvas-paint" ref={canvasRef} />

        <div className="scene-canvas-overlay">
          {showSafeAreas ? (
            <>
              <div
                className="scene-safe scene-safe-action"
                style={{ inset: `${actionSafeInset * 100}%` }}
                data-label="action safe"
              />
              <div
                className="scene-safe scene-safe-title"
                style={{ inset: `${titleSafeInset * 100}%` }}
                data-label="title safe"
              />
            </>
          ) : null}

          {/* Узлы: прозрачные прямоугольники, которые ловят мышь. Порядок тот
              же, что и в отрисовке, поэтому верхний узел перехватывает клик. */}
          {template.nodes.map((node) => {
            if (node.kind === "group") return null;
            const box = boxOf(node);
            if (box.hidden) return null;
            return (
              <div
                key={node.id}
                className={`scene-hit ${node.id === selectedId ? "selected" : ""} ${
                  selectedIds.includes(node.id) && node.id !== selectedId ? "co-selected" : ""
                }`}
                style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}
                onPointerDown={(event) => handlePointerDown(event, "move", node)}
                onDoubleClick={() => {
                  const current = editableText(node, fields);
                  if (current === null) return;
                  setEditing({ nodeId: node.id, value: current });
                }}
                title={node.name}
              />
            );
          })}

          {/* Правка текста в кадре: дизайнер видит строку там же, где она выйдет
              в эфир, и не ищет её в списке полей. Промер идёт тем же полотном,
              что и рисунок, поэтому поле встаёт ровно на место надписи. */}
          {editingNode && editingBox && !editingBox.hidden ? (
            <textarea
              autoFocus
              className="scene-text-edit"
              onBlur={() => {
                onEditText(editingNode, editing!.value);
                setEditing(null);
              }}
              onChange={(event) => setEditing({ nodeId: editingNode.id, value: event.target.value })}
              onKeyDown={(event) => {
                // Enter завершает, Shift+Enter переносит строку: у титра строк
                // обычно две, и обе набирают здесь же.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                left: pct(editingBox.x),
                top: pct(editingBox.y),
                width: pct(editingBox.width),
                minHeight: pct(editingBox.height),
                fontSize: Math.max(9, editingNode.textStyle.size * size.height),
                lineHeight: editingNode.textStyle.lineHeight,
                textAlign: editingNode.textStyle.align === "center" ? "center"
                  : editingNode.textStyle.align === "right" ? "right" : "left",
              }}
              value={editing!.value}
            />
          ) : null}

          {guides.map((guide, index) => (
            <div
              key={`${guide.axis}-${guide.at}-${index}`}
              className={`scene-guide scene-guide-${guide.kind} ${guide.axis}`}
              style={guide.axis === "x" ? { left: pct(guide.at) } : { top: pct(guide.at) }}
            />
          ))}

          {selected && selectedBox && !selectedBox.hidden ? (
            <div
              className="scene-frame"
              style={{
                left: pct(selectedBox.x), top: pct(selectedBox.y),
                width: pct(selectedBox.width), height: pct(selectedBox.height),
              }}
            >
              {/* Точка привязки: от неё считаются поворот и масштаб. Без неё
                  непонятно, вокруг чего узел повернётся. */}
              <i
                className="scene-anchor"
                style={{
                  left: `${selected.transform.anchorX * 100}%`,
                  top: `${selected.transform.anchorY * 100}%`,
                }}
                title={`Точка привязки: ${(selected.transform.anchorX * 100).toFixed(0)}% · ${(selected.transform.anchorY * 100).toFixed(0)}%`}
              />
              {(["nw", "ne", "sw", "se"] as const).map((grip) => (
                <i
                  key={grip}
                  className={`scene-grip scene-grip-${grip}`}
                  onPointerDown={(event) => handlePointerDown(event, grip, selected)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Строка узла, если её вообще имеет смысл править в кадре.
 *
 * Часы, отсчёт и бегущую строку набирает не человек: у них своё содержимое, и
 * поле ввода поверх них обещало бы правку, которой не будет. `null` — такой
 * узел не правится.
 */
function editableText(
  node: SceneNode,
  fields: Readonly<Record<string, string>>,
): string | null {
  if (node.kind !== "text" || !node.text) return null;
  if (node.text.kind === "static") return node.text.text;
  if (node.text.kind === "field") return fields[node.text.fieldKey] ?? "";
  return null;
}
