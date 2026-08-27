import {
  resolveNodeBox,
  sceneTiming,
  type SceneFormat,
  type SceneNode,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  drawScene,
  measureSceneText,
  type SceneDrawInput,
  type SceneSurface,
} from "@gruber/scene-renderer";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  actionSafeInset,
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
  pointerId: number;
  /** Доли кадра в момент нажатия. */
  startX: number;
  startY: number;
  startW: number;
  startH: number;
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
  /** Кадр из плейлиста под сценой; пусто — шахматка. */
  backdropUrl: string | null;
  showSafeAreas: boolean;
  onSelect: (nodeId: string | null) => void;
  /**
   * Разница нарисованной коробки, а не готовые координаты: у анимированного
   * узла холст рисует значение с ключей, и абсолютная запись в базовое
   * значение увела бы узел мимо места, куда его положили.
   */
  onTransform: (
    nodeId: string,
    delta: { dx?: number; dy?: number; dw?: number; dh?: number },
    drawn: { x: number; y: number; width: number; height: number },
  ) => void;
}

export function SceneCanvas({
  template, format, durationSeconds, timeSeconds, fields,
  selectedId, backdropUrl, showSafeAreas, onSelect, onTransform,
}: SceneCanvasProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<SceneGuide[]>([]);

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
    const surface = context as unknown as SceneSurface;
    const input: SceneDrawInput = {
      frameWidth: size.width,
      frameHeight: size.height,
      originX: 0,
      originY: 0,
      timeSeconds,
      fields,
      images: {},
      airEpochSeconds: 0,
      clipRemainingSeconds: durationSeconds - timeSeconds,
    };
    const widths = measureSceneText(surface, template, { ...format, width: size.width, height: size.height }, input);
    drawScene(surface, template, { ...format, width: size.width, height: size.height }, timing, input, widths);
  }, [template, format, size, timeSeconds, fields, durationSeconds, timing]);

  const selected = template.nodes.find((node) => node.id === selectedId) ?? null;

  function pointToFraction(event: ReactPointerEvent): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  function boxOf(node: SceneNode) {
    const scaled = { ...format, width: 1, height: 1 };
    return resolveNodeBox(node, template, scaled, timing, timeSeconds, {});
  }

  function handlePointerDown(event: ReactPointerEvent, grip: Grip, node: SceneNode) {
    event.stopPropagation();
    const point = pointToFraction(event);
    const box = boxOf(node);
    // Выделение идёт первым: захват указателя может не состояться — например,
    // у события без живого указателя, — и выделение не должно от этого зависеть.
    onSelect(node.id);
    dragRef.current = {
      grip,
      pointerId: event.pointerId,
      startX: box.x, startY: box.y, startW: box.width, startH: box.height,
      fromX: point.x, fromY: point.y,
    };
    try { (event.target as Element).setPointerCapture(event.pointerId); } catch { /* захвата не будет */ }
  }

  function handlePointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || !selected) return;
    const point = pointToFraction(event);
    const dx = point.x - drag.fromX;
    const dy = point.y - drag.fromY;
    // Порог прилипания задан в пикселях экрана: на мелком предпросмотре доля
    // кадра меньше пикселя, и прилипание перестало бы срабатывать.
    const thresholdX = snapThreshold(7, size.width);
    const thresholdY = snapThreshold(7, size.height);
    const all = sceneGuides(template, selected.id);
    const hit: SceneGuide[] = [];

    if (drag.grip === "move") {
      const rawX = drag.startX + dx;
      const rawY = drag.startY + dy;
      const sx = snapCoordinate(rawX, [rawX, rawX + drag.startW, rawX + drag.startW / 2], all, "x", thresholdX);
      const sy = snapCoordinate(rawY, [rawY, rawY + drag.startH, rawY + drag.startH / 2], all, "y", thresholdY);
      if (sx.guide) hit.push(sx.guide);
      if (sy.guide) hit.push(sy.guide);
      onTransform(
        selected.id,
        { dx: sx.value - drag.startX, dy: sy.value - drag.startY },
        { x: drag.startX, y: drag.startY, width: drag.startW, height: drag.startH },
      );
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
      onTransform(
        selected.id,
        { dx: x - drag.startX, dy: y - drag.startY, dw: width - drag.startW, dh: height - drag.startH },
        { x: drag.startX, y: drag.startY, width: drag.startW, height: drag.startH },
      );
    }
    setGuides(hit);
  }

  function endDrag(event: ReactPointerEvent) {
    if (!dragRef.current) return;
    try { (event.target as Element).releasePointerCapture(dragRef.current.pointerId); } catch { /* уже отпущен */ }
    dragRef.current = null;
    setGuides([]);
  }

  const selectedBox = selected ? boxOf(selected) : null;
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
                className={`scene-hit ${node.id === selectedId ? "selected" : ""}`}
                style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}
                onPointerDown={(event) => handlePointerDown(event, "move", node)}
                title={node.name}
              />
            );
          })}

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
