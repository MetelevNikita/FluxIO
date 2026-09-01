import {
  sceneSegmentAt, sceneTiming,
  type SceneBezier, type SceneKeyframe, type SceneNode,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  ChevronDown, ChevronRight, Circle, Diamond, Minus, Pause, Play, Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  absoluteKeyframeTime, snapKeyframeTime, trackIsAnimated, type SceneSegmentSide,
} from "../scene-edit";
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
type SelectedKey = {
  nodeId: string; key: TrackKey; side: SceneSegmentSide; atSeconds: number;
};

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
  frameRate: number;
  timeSeconds: number;
  playing: boolean;
  onTime: (seconds: number) => void;
  onTogglePlay: () => void;
  onDirector: (patch: { inSeconds?: number; outSeconds?: number }) => void;
  onDuration: (seconds: number) => void;
  onMoveKeyframes: (moves: readonly (Omit<SelectedKey, "atSeconds"> & {
    fromSeconds: number; toSeconds: number;
  })[]) => void;
  onRemoveKeyframe: (nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number) => void;
  /** Выбор слоя прямо с дорожки: список слоёв и время — одно и то же дерево. */
  onSelectNode: (nodeId: string) => void;
  onKeyframeEasing: (
    nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number,
    easing: SceneKeyframe["easing"], bezier?: SceneBezier,
  ) => void;
}

export function SceneTimeline({
  template, node, durationSeconds, frameRate, timeSeconds, playing,
  onTime, onTogglePlay, onDirector, onDuration, onMoveKeyframes, onRemoveKeyframe, onKeyframeEasing,
  onSelectNode,
}: SceneTimelineProps) {
  const { tr } = useI18n();
  /** Ключ, у которого открыт выбор кривой. */
  const [editing, setEditing] = useState<
    SelectedKey | null
  >(null);
  const [selectedKeys, setSelectedKeys] = useState<SelectedKey[]>([]);
  const [snapGuide, setSnapGuide] = useState<{
    nodeId: string; key: TrackKey; atRail: number;
  } | null>(null);
  /** Слои, у которых раскрыты свойства. Выбранный раскрыт всегда. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** Ключ, который тащат мышью по дорожке. */
  const dragging = useRef<
    {
      primary: SelectedKey; keys: SelectedKey[];
      laneWidth: number; laneLeft: number; pointerId: number;
    } | null
  >(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLDivElement | null>(null);
  const marqueeBase = useRef<SelectedKey[]>([]);
  const [marquee, setMarquee] = useState<{
    pointerId: number; startX: number; startY: number; endX: number; endY: number;
  } | null>(null);
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
    if (!drag || event.pointerId !== drag.pointerId) return;
    const raw = keyframeTimeAt(event.clientX, drag, drag.primary.side);
    const candidates: number[] = [];
    for (const entry of template.nodes) {
      for (const trackKey of trackKeys) {
        if (entry.id === drag.primary.nodeId && trackKey === drag.primary.key) continue;
        const frames = drag.primary.side === "in"
          ? entry.transform[trackKey].inKeyframes
          : entry.transform[trackKey].outKeyframes;
        for (const frame of frames) {
          if (!drag.keys.some((selected) => selected.nodeId === entry.id && selected.key === trackKey &&
            selected.side === drag.primary.side && selected.atSeconds === frame.atSeconds)) {
            candidates.push(frame.atSeconds);
          }
        }
      }
    }
    const snapped = snapKeyframeTime(raw, candidates, (8 / Math.max(1, drag.laneWidth)) * total);
    const minimumDelta = Math.max(...drag.keys.map((key) => -key.atSeconds));
    const maximumDelta = Math.min(...drag.keys.map((key) =>
      (key.side === "in" ? timing.inSeconds : timing.outSeconds) - key.atSeconds));
    const delta = Math.round(Math.min(maximumDelta, Math.max(
      minimumDelta, snapped.value - drag.primary.atSeconds,
    )) * 1_000) / 1_000;
    const next = Math.round((drag.primary.atSeconds + delta) * 1_000) / 1_000;
    setSnapGuide(snapped.snapped ? {
      nodeId: drag.primary.nodeId,
      key: drag.primary.key,
      atRail: drag.primary.side === "in" ? next : timing.inSeconds + timing.holdSeconds + next,
    } : null);
    if (Math.abs(delta) < 0.001) return;
    const moved = drag.keys.map((key) => ({
      ...key, atSeconds: Math.round((key.atSeconds + delta) * 1_000) / 1_000,
    }));
    onMoveKeyframes(moved.map((key, index) => ({
      nodeId: key.nodeId, key: key.key, side: key.side,
      fromSeconds: drag.keys[index]!.atSeconds, toSeconds: key.atSeconds,
    })));
    const primaryIndex = drag.keys.findIndex((key) => sameKey(key, drag.primary));
    dragging.current = {
      ...drag,
      primary: moved[primaryIndex] ?? { ...drag.primary, atSeconds: next },
      keys: moved,
    };
    setSelectedKeys(moved);
    setEditing((current) => {
      const index = current ? drag.keys.findIndex((key) => sameKey(key, current)) : -1;
      return index >= 0 ? moved[index]! : current;
    });
  }

  function updateMarquee(event: ReactPointerEvent) {
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    const next = { ...marquee, endX: event.clientX, endY: event.clientY };
    setMarquee(next);
    const left = Math.min(next.startX, next.endX);
    const right = Math.max(next.startX, next.endX);
    const top = Math.min(next.startY, next.endY);
    const bottom = Math.max(next.startY, next.endY);
    const hit = [...(layersRef.current?.querySelectorAll<HTMLButtonElement>(".scene-key") ?? [])]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom;
      })
      .flatMap((button): SelectedKey[] => {
        const key = button.dataset.track as TrackKey;
        const side = button.dataset.side as SceneSegmentSide;
        const atSeconds = Number(button.dataset.atSeconds);
        return button.dataset.nodeId && trackKeys.includes(key) && (side === "in" || side === "out") &&
          Number.isFinite(atSeconds)
          ? [{ nodeId: button.dataset.nodeId, key, side, atSeconds }]
          : [];
      });
    setSelectedKeys([...marqueeBase.current, ...hit.filter((key) =>
      !marqueeBase.current.some((base) => sameKey(base, key)))]);
  }

  function endTimelinePointer(event: ReactPointerEvent) {
    if (dragging.current?.pointerId !== event.pointerId && marquee?.pointerId !== event.pointerId) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* уже отпущен */ }
    dragging.current = null;
    setMarquee(null);
    setSnapGuide(null);
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
    const currentKey = { nodeId, key, side, atSeconds: frame.atSeconds };
    const selected = selectedKeys.some((entry) => sameKey(entry, currentKey));
    const absoluteSeconds = absoluteKeyframeTime(side, frame.atSeconds, timing);
    const position = `${absoluteSeconds.toFixed(2)}s · F${Math.round(absoluteSeconds * frameRate)}`;
    const positionEdge = atRail / total < 0.08 ? "start" : atRail / total > 0.92 ? "end" : "";
    return (
      <button
        aria-pressed={selected}
        className={`scene-key seg-${side} ${selected ? "selected" : ""} ${frame.easing === "bezier" ? "curved" : ""}`}
        data-at-seconds={frame.atSeconds}
        data-node-id={nodeId}
        data-side={side}
        data-track={key}
        key={`${side}-${frame.atSeconds}`}
        onContextMenu={(event) => {
          event.preventDefault();
          onKeyframeEasing(
            nodeId, key, side, frame.atSeconds,
            frame.easing === "bezier" ? "in-out" : "bezier",
          );
        }}
        onDoubleClick={() => onRemoveKeyframe(nodeId, key, side, frame.atSeconds)}
        onKeyDown={(event) => {
          if (event.key !== "Delete" && event.key !== "Backspace") return;
          event.preventDefault();
          event.stopPropagation();
          onRemoveKeyframe(nodeId, key, side, frame.atSeconds);
          setEditing(null);
          setSelectedKeys((current) => current.filter((entry) => !sameKey(entry, currentKey)));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const lane = event.currentTarget.parentElement?.getBoundingClientRect();
          if (lane) {
            const additive = event.ctrlKey || event.metaKey || event.shiftKey;
            const alreadySelected = selectedKeys.some((entry) => sameKey(entry, currentKey));
            const nextSelection = additive
              ? alreadySelected
                ? selectedKeys.filter((entry) => !sameKey(entry, currentKey))
                : [...selectedKeys, currentKey]
              : alreadySelected ? selectedKeys : [currentKey];
            setSelectedKeys(nextSelection);
            if (additive && alreadySelected) return;
            dragging.current = {
              primary: currentKey, keys: nextSelection,
              laneLeft: lane.left, laneWidth: lane.width, pointerId: event.pointerId,
            };
          }
          setEditing(currentKey);
          try { layersRef.current?.setPointerCapture(event.pointerId); } catch { /* capture unavailable */ }
        }}
        style={{ left: pct(atRail) }}
        title={tr(
          `${position} общей шкалы · ${side === "in" ? "вход" : "выход"} ${frame.atSeconds} с · ${frame.easing}\nТащите — сдвинуть, правая кнопка — кривая, двойной щелчок — убрать`,
          `${position} on the main timeline · ${side} ${frame.atSeconds}s · ${frame.easing}\nDrag to move, right-click for a curve, double-click to remove`,
        )}
        type="button"
      >
        {frame.easing === "bezier" ? <Circle fill="currentColor" size={9} /> : <Diamond size={9} />}
        {selected ? <span className={`scene-key-position ${positionEdge}`}>{position}</span> : null}
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
        <span className="scene-clock">
          {timeSeconds.toFixed(2)} / {total.toFixed(2)} {tr("с", "s")} · F{Math.round(timeSeconds * frameRate)}
        </span>
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
      <div
        className="scene-layers"
        onLostPointerCapture={() => { dragging.current = null; setMarquee(null); setSnapGuide(null); }}
        onPointerCancel={endTimelinePointer}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
          marqueeBase.current = event.ctrlKey || event.metaKey || event.shiftKey ? selectedKeys : [];
          if (marqueeBase.current.length === 0) setSelectedKeys([]);
          setMarquee({
            pointerId: event.pointerId,
            startX: event.clientX, startY: event.clientY,
            endX: event.clientX, endY: event.clientY,
          });
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture unavailable */ }
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveDraggedKey(event);
          else updateMarquee(event);
        }}
        onPointerUp={endTimelinePointer}
        ref={layersRef}
      >
        {marquee ? (() => {
          const box = layersRef.current?.getBoundingClientRect();
          if (!box) return null;
          return <i className="scene-key-marquee" style={{
            left: Math.min(marquee.startX, marquee.endX) - box.left + (layersRef.current?.scrollLeft ?? 0),
            top: Math.min(marquee.startY, marquee.endY) - box.top + (layersRef.current?.scrollTop ?? 0),
            width: Math.abs(marquee.endX - marquee.startX),
            height: Math.abs(marquee.endY - marquee.startY),
          }} />;
        })() : null}
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
                  <div className={`scene-track animated ${selectedKeys.some((selected) =>
                    selected.nodeId === entry.id && selected.key === key) ? "has-selected-key" : ""}`} key={key}>
                    <span className="scene-track-name">{tr(...trackTitles[key])}</span>
                    <div
                      className="scene-track-rail"
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

function sameKey(left: SelectedKey, right: SelectedKey): boolean {
  return left.nodeId === right.nodeId && left.key === right.key && left.side === right.side &&
    left.atSeconds === right.atSeconds;
}

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
