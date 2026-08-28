import {
  sceneFormatSchema, sceneTiming,
  type SceneLayoutTarget, type SceneTemplate,
} from "@gruber/contracts";
import {
  drawScene, measureSceneText, type SceneDrawInput, type SceneSurface,
} from "@gruber/scene-renderer";
import { Pause, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { layoutFormats } from "../scene-layouts";

/* -------------------------------------------------------------------------- *
 * Предпросмотр собранного титра.
 *
 * Рисует **та же** `drawScene`, что и эфир: второй реализации отрисовки быть не
 * должно, иначе предпросмотр разойдётся с выходом ровно там, где это дороже
 * всего заметить. Отсюда и проигрывание по номеру кадра, а не по часам.
 * ------------------------------------------------------------------------- */

interface ScenePreviewProps {
  template: SceneTemplate;
  /** Длительность показа: от неё режиссёр считает удержание. */
  durationSeconds: number;
  /** В какой раскладке смотрим; по умолчанию — первая заявленная шаблоном. */
  layout?: SceneLayoutTarget;
}

export function ScenePreview({ template, durationSeconds, layout }: ScenePreviewProps) {
  const { tr } = useI18n();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Крошечное полотно только для промера строк. */
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);

  const target = layout ?? template.targets[0] ?? "hd";
  const format = useMemo(
    () => sceneFormatSchema.parse({ layout: target, ...layoutFormats[target] }),
    [target],
  );
  const displayAspect = (format.width * format.pixelAspect) / format.height;

  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => {
      const byWidth = element.clientWidth;
      const byHeight = element.clientHeight * displayAspect;
      const width = Math.max(120, Math.min(byWidth, byHeight));
      setSize({ width: Math.round(width), height: Math.round(width / displayAspect) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayAspect]);

  // Проигрывание идёт по кадровой сетке, как в эфире: доля секунды между
  // кадрами показывает промежуточное состояние, которого в выходе не будет.
  useEffect(() => {
    if (!playing || durationSeconds <= 0) return;
    let frame = 0;
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now;
      const elapsed = (now - start) / 1_000;
      const frameNumber = Math.floor(elapsed * format.drawRate);
      setTimeSeconds((frameNumber / format.drawRate) % durationSeconds);
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, durationSeconds, format.drawRate]);

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
    fields: Object.fromEntries(template.fields.map((field) => [field.key, field.sample])),
    images: {},
    airEpochSeconds: 0,
    clipRemainingSeconds: Math.max(0, durationSeconds - timeSeconds),
  }), [size, timeSeconds, template.fields, durationSeconds]);

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
    drawScene(
      context as unknown as SceneSurface,
      template, previewFormat, timing, drawInput, widths,
    );
  }, [template, previewFormat, timing, drawInput, widths, size]);

  const segment = timeSeconds < timing.inSeconds
    ? tr("вход", "in")
    : timeSeconds < timing.inSeconds + timing.holdSeconds
      ? tr("удержание", "hold")
      : tr("выход", "out");

  return (
    <div className="scene-preview">
      <div className="scene-preview-stage" ref={boxRef}>
        <div className="scene-preview-checker" style={{ width: size.width, height: size.height }}>
          <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
        </div>
      </div>
      <div className="scene-preview-transport">
        <button
          onClick={() => setPlaying((value) => !value)}
          title={playing ? tr("Пауза", "Pause") : tr("Проиграть", "Play")}
          type="button"
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <input
          max={Math.max(0.1, durationSeconds)}
          min={0}
          onChange={(event) => {
            setPlaying(false);
            setTimeSeconds(Number(event.target.value));
          }}
          step={1 / format.drawRate}
          type="range"
          value={timeSeconds}
        />
        <span>{timeSeconds.toFixed(2)} / {durationSeconds.toFixed(2)} с · {segment}</span>
      </div>
    </div>
  );
}
