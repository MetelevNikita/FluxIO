import {
  sceneSegmentAt, sceneTiming,
  type SceneBezier, type SceneKeyframe, type SceneNode,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  ChevronDown, ChevronRight, Circle, Diamond, Minus, Pause, Play, Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { snapKeyframeTime, trackIsAnimated, type SceneSegmentSide } from "../scene-edit";
import { EasingPicker } from "./EasingPicker";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Дорожка времени.
 *
 * Показ состоит из трёх отрезков: вход, удержание, выход. Оператор задаёт
 * только момент и длительность — растягивается **удержание**, а вход и выход
 * сохраняют свою длину. Поэтому и ключи ставятся внутри своего отрезка: их
 * время отсчитывается от его начала, а не от начала показа.
 * ------------------------------------------------------------------------- */

/** Дорожки узла, которые имеет смысл показывать. */
const trackKeys = [
  "x", "y", "width", "height",
  "scale", "scaleY", "rotationDegrees", "skewDegrees",
  "opacity", "blur", "reveal",
] as const;
type TrackKey = (typeof trackKeys)[number];

const trackTitles: Record<TrackKey, [string, string]> = {
  x: ["Положение X", "Position X"],
  y: ["Положение Y", "Position Y"],
  width: ["Ширина", "Width"],
  height: ["Высота", "Height"],
  scale: ["Масштаб X", "Scale X"],
  scaleY: ["Масштаб Y", "Scale Y"],
  rotationDegrees: ["Поворот", "Rotation"],
  skewDegrees: ["Наклон", "Skew"],
  opacity: ["Прозрачность", "Opacity"],
  blur: ["Размытие", "Blur"],
  reveal: ["Раскрытие", "Reveal"],
};

interface SceneTimelineProps {
  template: SceneTemplate;
  node: SceneNode | null;
  durationSeconds: number;
  timeSeconds: number;
  playing: boolean;
  onTime: (seconds: number) => void;
  onTogglePlay: () => void;
  onDirector: (patch: { inSeconds?: number; outSeconds?: number }) => void;
  onDuration: (seconds: number) => void;
  onMoveKeyframe: (
    nodeId: string, key: TrackKey, side: SceneSegmentSide, fromSeconds: number, toSeconds: number,
  ) => void;
  onRemoveKeyframe: (nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number) => void;
  /** Выбор слоя прямо с дорожки: список слоёв и время — одно и то же дерево. */
  onSelectNode: (nodeId: string) => void;
  onKeyframeEasing: (
    nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number,
    easing: SceneKeyframe["easing"], bezier?: SceneBezier,
  ) => void;
}

export function SceneTimeline({
  template, node, durationSeconds, timeSeconds, playing,
  onTime, onTogglePlay, onDirector, onDuration, onMoveKeyframe, onRemoveKeyframe, onKeyframeEasing,
  onSelectNode,
}: SceneTimelineProps) {
  const { tr } = useI18n();
  /** Ключ, у которого открыт выбор кривой. */
  const [editing, setEditing] = useState<
    { nodeId: string; key: TrackKey; side: SceneSegmentSide; atSeconds: number } | null
  >(null);
  const [snapGuide, setSnapGuide] = useState<{
    nodeId: string; key: TrackKey; atRail: number;
  } | null>(null);
  /** Слои, у которых раскрыты свойства. Выбранный раскрыт всегда. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** Ключ, который тащат мышью по дорожке. */
  const dragging = useRef<
    {
      nodeId: string; key: TrackKey; side: SceneSegmentSide; atSeconds: number;
      laneWidth: number; laneLeft: number;
    } | null
  >(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  /** Идентификатор указателя, которым перематывают; `null` — не перематывают. */
  const scrubbing = useRef<number | null>(null);

  const timing = sceneTiming(template.director, durationSeconds);
  const total = Math.max(0.04, durationSeconds);
  const pct = (seconds: number) => `${(seconds / total) * 100}%`;

  // Проигрывание идёт по часам браузера, но это **предпросмотр**, а не эфир:
  // в эфире время кадра считается из его номера, потому что рендерер
  // следующего ролика запускается заранее.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = timeSeconds + (now - last) / 1_000;
      last = now;
      onTime(next > total ? 0 : next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeSeconds, total, onTime]);

  /**
   * Время ключа из положения мыши на дорожке.
   *
   * Ключ живёт внутри своего отрезка, а полоса показывает весь показ: время
   * пересчитывается в местное, иначе ключ входа уехал бы в удержание.
   */
  function keyframeTimeAt(clientX: number, lane: { laneLeft: number; laneWidth: number }, side: SceneSegmentSide) {
    const ratio = Math.min(1, Math.max(0, (clientX - lane.laneLeft) / lane.laneWidth));
    const absolute = ratio * total;
    if (side === "in") return Math.min(timing.inSeconds, Math.max(0, absolute));
    const exitStart = timing.inSeconds + timing.holdSeconds;
    return Math.min(timing.outSeconds, Math.max(0, absolute - exitStart));
  }

  function moveDraggedKey(event: ReactPointerEvent) {
    const drag = dragging.current;
    if (!drag) return;
    const raw = keyframeTimeAt(event.clientX, drag, drag.side);
    const candidates: number[] = [];
    for (const entry of template.nodes) {
      for (const trackKey of trackKeys) {
        if (entry.id === drag.nodeId && trackKey === drag.key) continue;
        const frames = drag.side === "in"
          ? entry.transform[trackKey].inKeyframes
          : entry.transform[trackKey].outKeyframes;
        for (const frame of frames) candidates.push(frame.atSeconds);
      }
    }
    const snapped = snapKeyframeTime(raw, candidates, (8 / Math.max(1, drag.laneWidth)) * total);
    const next = Math.round(snapped.value * 1_000) / 1_000;
    setSnapGuide(snapped.snapped ? {
      nodeId: drag.nodeId,
      key: drag.key,
      atRail: drag.side === "in" ? next : timing.inSeconds + timing.holdSeconds + next,
    } : null);
    if (Math.abs(next - drag.atSeconds) < 0.001) return;
    onMoveKeyframe(drag.nodeId, drag.key, drag.side, drag.atSeconds, next);
    dragging.current = { ...drag, atSeconds: next };
    setEditing((current) => current && current.nodeId === drag.nodeId && current.key === drag.key &&
      current.side === drag.side && current.atSeconds === drag.atSeconds
      ? { ...current, atSeconds: next }
      : current);
  }

  function endScrub(event: ReactPointerEvent) {
    if (scrubbing.current !== null) {
      try { event.currentTarget.releasePointerCapture(scrubbing.current); } catch { /* уже отпущен */ }
    }
    scrubbing.current = null;
  }

  /**
   * Ключ на дорожке. Один вид на все свойства: тащится мышью, правой кнопкой
   * переводится в кривую, двойным щелчком убирается.
   */
  function keyButton(
    nodeId: string,
    key: TrackKey,
    side: SceneSegmentSide,
    frame: SceneKeyframe,
    atRail: number,
  ) {
    const selected = editing?.nodeId === nodeId && editing.key === key &&
      editing.side === side && editing.atSeconds === frame.atSeconds;
    return (
      <button
        aria-pressed={selected}
        className={`scene-key seg-${side} ${selected ? "selected" : ""} ${frame.easing === "bezier" ? "curved" : ""}`}
        key={`${side}-${frame.atSeconds}`}
        onContextMenu={(event) => {
          event.preventDefault();
          onKeyframeEasing(
            nodeId, key, side, frame.atSeconds,
            frame.easing === "bezier" ? "in-out" : "bezier",
          );
        }}
        onDoubleClick={() => onRemoveKeyframe(nodeId, key, side, frame.atSeconds)}
        onLostPointerCapture={() => { dragging.current = null; setSnapGuide(null); }}
        onKeyDown={(event) => {
          if (event.key !== "Delete" && event.key !== "Backspace") return;
          event.preventDefault();
          event.stopPropagation();
          onRemoveKeyframe(nodeId, key, side, frame.atSeconds);
          setEditing(null);
        }}
        onPointerDown={(event) => {
          const lane = event.currentTarget.parentElement?.getBoundingClientRect();
          if (lane) {
            dragging.current = {
              nodeId, key, side, atSeconds: frame.atSeconds,
              laneLeft: lane.left, laneWidth: lane.width,
            };
          }
          setEditing({ nodeId, key, side, atSeconds: frame.atSeconds });
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture unavailable */ }
        }}
        style={{ left: pct(atRail) }}
        title={tr(
          `${side === "in" ? "Вход" : "Выход"}, ${frame.atSeconds} с · ${frame.easing}\nТащите — сдвинуть, правая кнопка — кривая, двойной щелчок — убрать`,
          `${side === "in" ? "In" : "Out"}, ${frame.atSeconds}s · ${frame.easing}\nDrag to move, right-click for a curve, double-click to remove`,
        )}
        type="button"
      >
        {frame.easing === "bezier" ? <Circle fill="currentColor" size={9} /> : <Diamond size={9} />}
      </button>
    );
  }

  function seek(event: ReactPointerEvent) {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onTime(ratio * total);
  }

  const segment = sceneSegmentAt(timing, timeSeconds);

  return (
    <section className="scene-timeline">
      <header>
        <button className="scene-play" onClick={onTogglePlay} type="button">
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="scene-clock">{timeSeconds.toFixed(2)} / {total.toFixed(2)} {tr("с", "s")}</span>
        <span className={`scene-segment-badge seg-${segment.segment}`}>
          {segment.segment === "in" ? tr("вход", "in")
            : segment.segment === "hold" ? tr("удержание", "hold") : tr("выход", "out")}
        </span>
        {timing.compressed ? (
          <span className="scene-compressed" title={tr(
            "Длительности не хватает на вход и выход — обе половины проигрываются быстрее. Оборвать выход на середине хуже: титр, застывший на экране и пропавший скачком, виден зрителю.",
            "The duration cannot fit both halves — each plays faster.",
          )}>
            {tr("сжато", "compressed")}
          </span>
        ) : null}

        <div className="scene-director-fields">
          <label>
            <span>{tr("Вход", "In")}</span>
            <input
              min={0} step={0.1} type="number"
              onChange={(event) => onDirector({ inSeconds: Math.max(0, Number(event.target.value) || 0) })}
              value={template.director.inSeconds}
            />
          </label>
          <label>
            <span>{tr("Показ", "Show")}</span>
            <input
              min={0.1} step={0.1} type="number"
              onChange={(event) => onDuration(Math.max(0.1, Number(event.target.value) || 0.1))}
              value={durationSeconds}
            />
          </label>
          <label>
            <span>{tr("Выход", "Out")}</span>
            <input
              min={0} step={0.1} type="number"
              onChange={(event) => onDirector({ outSeconds: Math.max(0, Number(event.target.value) || 0) })}
              value={template.director.outSeconds}
            />
          </label>
        </div>
      </header>

      {/* Шкала времени: без неё ключ ставится «на глаз», и повторить тот же
          момент на другом слое нечем. Шаг подбирается под длину показа —
          деления через каждые 0,1 с на минутной строке нечитаемы. */}
      <div className="scene-ruler">
        {rulerTicks(total).map((tick) => (
          <i
            className={tick.major ? "major" : ""}
            key={tick.atSeconds}
            style={{ left: pct(tick.atSeconds) }}
          >
            {tick.major ? <b>{formatTick(tick.atSeconds, tr("с", "s"))}</b> : null}
          </i>
        ))}
      </div>

      {/* Перемотка. Захват берётся на самой полосе и обязательно отпускается:
          иначе указатель остаётся захваченным, и головка продолжает ходить
          за мышью после того, как кнопку отпустили. */}
      <div
        className="scene-rail"
        onLostPointerCapture={() => { scrubbing.current = null; }}
        onPointerCancel={endScrub}
        onPointerDown={(event) => {
          scrubbing.current = event.pointerId;
          seek(event);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* захвата не будет */ }
        }}
        onPointerMove={(event) => { if (scrubbing.current === event.pointerId) seek(event); }}
        onPointerUp={endScrub}
        ref={railRef}
      >
        <div className="scene-seg seg-in" style={{ width: pct(timing.inSeconds) }}>
          <span>{tr("вход", "in")}</span>
        </div>
        <div className="scene-seg seg-hold" style={{ width: pct(timing.holdSeconds) }}>
          <span>{tr("удержание", "hold")}</span>
        </div>
        <div className="scene-seg seg-out" style={{ width: pct(timing.outSeconds) }}>
          <span>{tr("выход", "out")}</span>
        </div>
        <i className="scene-playhead" style={{ left: pct(Math.min(timeSeconds, total)) }} />
      </div>

      {/* Все слои сразу, а не только выбранный: анимация живёт на каждом, и
          понять «где вообще что-то происходит» иначе нечем. Свойства слоя
          раскрываются — при большом числе ключей слой можно свернуть. */}
      <div className="scene-layers">
        {[...template.nodes].reverse().map((entry) => {
          const animated = trackKeys.filter((key) => trackIsAnimated(entry.transform[key]));
          const open = expanded.has(entry.id) || entry.id === node?.id;
          // Тот же сдвиг, что и в списке слоёв: две колонки об одном и том же
          // читаются как одна только пока вложенность в них выглядит одинаково.
          const depth = layerDepth(entry, template);
          return (
            <div className={`scene-layer ${entry.id === node?.id ? "current" : ""}`} key={entry.id}>
              <div className="scene-layer-head" style={{ paddingLeft: depth * 14 }}>
                <button
                  className="scene-layer-toggle"
                  disabled={animated.length === 0}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                    return next;
                  })}
                  title={animated.length === 0
                    ? tr("У слоя нет анимации: поставьте ключ в свойствах справа", "No animation yet: add a keyframe in the properties")
                    : open ? tr("Свернуть свойства", "Collapse") : tr("Раскрыть свойства", "Expand")}
                  type="button"
                >
                  {animated.length > 0 ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <Minus size={11} />}
                </button>
                <button className="scene-layer-name" onClick={() => onSelectNode(entry.id)} type="button">
                  {entry.name}
                </button>
                {animated.length > 0 ? <em>{animated.length}</em> : null}
                {/* Сводная полоса: у свёрнутого слоя по ней видно, где ключи. */}
                <div className="scene-layer-strip">
                  {!open ? animated.flatMap((key) => [
                    ...entry.transform[key].inKeyframes.map((frame) => (
                      <i className="seg-in" key={`${key}-i-${frame.atSeconds}`} style={{ left: pct(frame.atSeconds) }} />
                    )),
                    ...entry.transform[key].outKeyframes.map((frame) => (
                      <i className="seg-out" key={`${key}-o-${frame.atSeconds}`}
                        style={{ left: pct(timing.inSeconds + timing.holdSeconds + frame.atSeconds) }} />
                    )),
                  ]) : null}
                </div>
              </div>

              {open ? animated.map((key) => {
                const track = entry.transform[key];
                return (
                  <div className="scene-track animated" key={key}>
                    <span className="scene-track-name">{tr(...trackTitles[key])}</span>
                    <div
                      className="scene-track-rail"
                      onPointerMove={moveDraggedKey}
                      onPointerCancel={() => { dragging.current = null; setSnapGuide(null); }}
                      onPointerUp={() => { dragging.current = null; setSnapGuide(null); }}
                    >
                      {snapGuide?.nodeId === entry.id && snapGuide.key === key ? (
                        <i className="scene-key-snap-guide" style={{ left: pct(snapGuide.atRail) }} />
                      ) : null}
                      {track.inKeyframes.map((frame) => keyButton(entry.id, key, "in", frame, frame.atSeconds))}
                      {track.outKeyframes.map((frame) => keyButton(
                        entry.id, key, "out", frame,
                        timing.inSeconds + timing.holdSeconds + frame.atSeconds,
                      ))}
                    </div>
                    <button
                      className="scene-track-clear"
                      onClick={() => {
                        for (const frame of track.inKeyframes) onRemoveKeyframe(entry.id, key, "in", frame.atSeconds);
                        for (const frame of track.outKeyframes) onRemoveKeyframe(entry.id, key, "out", frame.atSeconds);
                      }}
                      title={tr("Снять всю анимацию дорожки", "Clear the track")}
                      type="button"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              }) : null}
            </div>
          );
        })}
        {template.nodes.length === 0 ? (
          <p className="scene-tracks-empty">
            {tr("В сцене пока нет слоёв.", "The scene has no layers yet.")}
          </p>
        ) : null}
      </div>

      {editing ? (() => {
        const owner = template.nodes.find((entry) => entry.id === editing.nodeId);
        if (!owner) return null;
        const track = owner.transform[editing.key];
        const list = editing.side === "in" ? track.inKeyframes : track.outKeyframes;
        const frame = list.find((entry) => entry.atSeconds === editing.atSeconds);
        if (!frame) return null;
        return (
          <EasingPicker
            keyframe={frame}
            onChange={(easing, bezier) =>
              onKeyframeEasing(owner.id, editing.key, editing.side, editing.atSeconds, easing, bezier)}
            onClose={() => setEditing(null)}
          />
        );
      })() : null}
    </section>
  );
}

export type { TrackKey };

/**
 * Деления шкалы под длину показа.
 *
 * Шаг подбирается так, чтобы делений было около десятка: через каждые 0,1 с на
 * минутной бегущей строке шкала превращается в сплошную заливку, а через
 * каждые 10 с на трёхсекундной плашке делений нет вовсе.
 */
function rulerTicks(totalSeconds: number): { atSeconds: number; major: boolean }[] {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = steps.find((candidate) => totalSeconds / candidate <= 12) ?? 60;
  const ticks: { atSeconds: number; major: boolean }[] = [];
  for (let at = 0; at <= totalSeconds + 1e-6; at += step) {
    const rounded = Math.round(at * 1_000) / 1_000;
    // Крупное деление каждое пятое: подписывать каждое — частокол цифр.
    ticks.push({ atSeconds: rounded, major: Math.round(at / step) % 5 === 0 });
  }
  return ticks;
}

/** Подпись деления: секунды без хвоста нулей. */
function formatTick(seconds: number, unit = "с"): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds - minutes * 60);
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }
  return Number.isInteger(seconds) ? `${seconds}${unit}` : `${seconds.toFixed(1)}${unit}`;
}

/** Глубина вложенности узла — она же величина сдвига строки вправо. */
function layerDepth(node: SceneNode, template: SceneTemplate): number {
  let depth = 0;
  let parentId = node.parentId;
  for (let step = 0; parentId && step < 8; step += 1) {
    depth += 1;
    parentId = template.nodes.find((entry) => entry.id === parentId)?.parentId ?? null;
  }
  return depth;
}
