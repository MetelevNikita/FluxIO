import {
  sceneSegmentAt, sceneTiming,
  type SceneBezier, type SceneKeyframe, type SceneNode,
  type SceneTemplate, type SceneTrack,
} from "@gruber/contracts";
import { Diamond, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { trackIsAnimated, type SceneSegmentSide } from "../scene-edit";
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
const trackKeys = ["x", "y", "width", "height", "opacity", "rotationDegrees", "scale"] as const;
type TrackKey = (typeof trackKeys)[number];

const trackTitles: Record<TrackKey, [string, string]> = {
  x: ["X", "X"],
  y: ["Y", "Y"],
  width: ["Ширина", "Width"],
  height: ["Высота", "Height"],
  opacity: ["Прозрачность", "Opacity"],
  rotationDegrees: ["Поворот", "Rotation"],
  scale: ["Масштаб", "Scale"],
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
  onSetKeyframe: (nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number) => void;
  onRemoveKeyframe: (nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number) => void;
  onKeyframeEasing: (
    nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number,
    easing: SceneKeyframe["easing"], bezier?: SceneBezier,
  ) => void;
}

export function SceneTimeline({
  template, node, durationSeconds, timeSeconds, playing,
  onTime, onTogglePlay, onDirector, onDuration, onSetKeyframe, onRemoveKeyframe, onKeyframeEasing,
}: SceneTimelineProps) {
  const { tr } = useI18n();
  /** Ключ, у которого открыт выбор кривой. */
  const [editing, setEditing] = useState<
    { key: TrackKey; side: SceneSegmentSide; atSeconds: number } | null
  >(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

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
        <span className="scene-clock">{timeSeconds.toFixed(2)} / {total.toFixed(2)} с</span>
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

      <div
        className="scene-rail"
        onPointerDown={(event) => { scrubbing.current = true; seek(event); (event.target as Element).setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (scrubbing.current) seek(event); }}
        onPointerUp={() => { scrubbing.current = false; }}
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

      {node ? (
        <div className="scene-tracks">
          {/* Анимация принадлежит узлу, а не сцене целиком: у каждого слоя
              свои дорожки. Без явной подписи это ищут и не находят. */}
          <p className="scene-tracks-owner">
            {tr(`Дорожки слоя «${node.name}»`, `Tracks of layer “${node.name}”`)}
            <span>{tr(
              "у каждого слоя своя анимация — выберите другой слой, чтобы править его",
              "each layer animates on its own — select another to edit it",
            )}</span>
          </p>
          {trackKeys.map((key) => {
            const track = node.transform[key] as SceneTrack;
            const animated = trackIsAnimated(track);
            const side: SceneSegmentSide = segment.segment === "out" ? "out" : "in";
            const local = segment.segment === "hold" ? timing.inSeconds : segment.localSeconds;
            return (
              <div className={`scene-track ${animated ? "animated" : ""}`} key={key}>
                <span className="scene-track-name">{tr(...trackTitles[key])}</span>
                <div className="scene-track-rail">
                  {track.inKeyframes.map((frame) => (
                    <button
                      className={`scene-key seg-in ${frame.easing === "bezier" ? "curved" : ""}`}
                      key={`in-${frame.atSeconds}`}
                      onClick={(event) => (event.altKey
                        ? onRemoveKeyframe(node.id, key, "in", frame.atSeconds)
                        : setEditing({ key, side: "in", atSeconds: frame.atSeconds }))}
                      style={{ left: pct(frame.atSeconds) }}
                      title={tr(
                        `Вход, ${frame.atSeconds} с · ${frame.easing} — нажмите для кривой, Alt — убрать`,
                        `In, ${frame.atSeconds}s · ${frame.easing} — click for the curve, Alt to remove`,
                      )}
                      type="button"
                    >
                      <Diamond size={9} />
                    </button>
                  ))}
                  {track.outKeyframes.map((frame) => (
                    <button
                      className={`scene-key seg-out ${frame.easing === "bezier" ? "curved" : ""}`}
                      key={`out-${frame.atSeconds}`}
                      onClick={(event) => (event.altKey
                        ? onRemoveKeyframe(node.id, key, "out", frame.atSeconds)
                        : setEditing({ key, side: "out", atSeconds: frame.atSeconds }))}
                      style={{ left: pct(timing.inSeconds + timing.holdSeconds + frame.atSeconds) }}
                      title={tr(
                        `Выход, ${frame.atSeconds} с · ${frame.easing} — нажмите для кривой, Alt — убрать`,
                        `Out, ${frame.atSeconds}s · ${frame.easing} — click for the curve, Alt to remove`,
                      )}
                      type="button"
                    >
                      <Diamond size={9} />
                    </button>
                  ))}
                </div>
                <button
                  className="scene-track-add"
                  disabled={segment.segment === "hold"}
                  onClick={() => onSetKeyframe(node.id, key, side, local)}
                  title={segment.segment === "hold"
                    ? tr(
                      "Удержание нечем заполнять: оно растягивается под длительность, и ключ в нём заставил бы картинку зависеть от неё.",
                      "Hold cannot take keyframes: it stretches with the duration.",
                    )
                    : tr("Поставить ключ в текущей точке", "Add a keyframe here")}
                  type="button"
                >
                  <Plus size={11} />
                </button>
                {animated ? (
                  <button
                    className="scene-track-clear"
                    onClick={() => {
                      for (const frame of track.inKeyframes) onRemoveKeyframe(node.id, key, "in", frame.atSeconds);
                      for (const frame of track.outKeyframes) onRemoveKeyframe(node.id, key, "out", frame.atSeconds);
                    }}
                    title={tr("Снять всю анимацию дорожки", "Clear the track")}
                    type="button"
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="scene-tracks-empty">
          {tr("Выберите узел, чтобы увидеть его дорожки.", "Select a node to see its tracks.")}
        </p>
      )}

      {editing && node ? (() => {
        const track = node.transform[editing.key] as SceneTrack;
        const list = editing.side === "in" ? track.inKeyframes : track.outKeyframes;
        const frame = list.find((entry) => entry.atSeconds === editing.atSeconds);
        if (!frame) return null;
        return (
          <EasingPicker
            keyframe={frame}
            onChange={(easing, bezier) =>
              onKeyframeEasing(node.id, editing.key, editing.side, editing.atSeconds, easing, bezier)}
            onClose={() => setEditing(null)}
          />
        );
      })() : null}
    </section>
  );
}

export type { TrackKey };
