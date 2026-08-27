import type { SceneBezier, SceneKeyframe } from "@gruber/contracts";
import { bezierEasing } from "@gruber/contracts";
import { useMemo } from "react";
import { bezierPresets } from "../scene-edit";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Выбор кривой ускорения для ключа.
 *
 * Кривая описывает путь **к** этому ключу, а не от него — так же устроен
 * график скорости в After Effects, и дизайнер ждёт именно этого.
 *
 * График рисуется по той же функции, которой считает эфир: разойтись
 * предпросмотру кривой с её действием негде.
 * ------------------------------------------------------------------------- */

const named: { value: SceneKeyframe["easing"]; ru: string; en: string }[] = [
  { value: "linear", ru: "Прямая", en: "Linear" },
  { value: "in", ru: "Разгон", en: "Ease in" },
  { value: "out", ru: "Торможение", en: "Ease out" },
  { value: "in-out", ru: "Плавно", en: "Ease in-out" },
  { value: "bezier", ru: "Своя кривая", en: "Custom curve" },
];

export function EasingPicker({
  keyframe, onChange, onClose,
}: {
  keyframe: SceneKeyframe;
  onChange: (easing: SceneKeyframe["easing"], bezier?: SceneBezier) => void;
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const curve = keyframe.bezier ?? { x1: 0.4, y1: 0, x2: 0.2, y2: 1 };

  // Точки графика считаются той же функцией, что применяет эфир.
  const path = useMemo(() => {
    const points: string[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const x = i / 40;
      const y = keyframe.easing === "bezier"
        ? bezierEasing(curve, x)
        : namedValue(keyframe.easing, x);
      points.push(`${(x * 100).toFixed(1)},${(100 - y * 100).toFixed(1)}`);
    }
    return points.join(" ");
  }, [keyframe.easing, curve]);

  const setHandle = (key: keyof SceneBezier, value: number) => {
    onChange("bezier", { ...curve, [key]: value });
  };

  return (
    <div className="easing-picker">
      <header>
        <span>{tr("Кривая к ключу", "Curve into the key")}</span>
        <button onClick={onClose} type="button">✕</button>
      </header>

      <div className="easing-body">
        <svg viewBox="-6 -22 112 144" className="easing-graph">
          <rect x="0" y="0" width="100" height="100" className="easing-field" />
          <line x1="0" y1="100" x2="100" y2="0" className="easing-diagonal" />
          <polyline points={path} className="easing-curve" />
          {keyframe.easing === "bezier" ? (
            <>
              <line x1="0" y1="100" x2={curve.x1 * 100} y2={100 - curve.y1 * 100} className="easing-handle-line" />
              <line x1="100" y1="0" x2={curve.x2 * 100} y2={100 - curve.y2 * 100} className="easing-handle-line" />
              <circle cx={curve.x1 * 100} cy={100 - curve.y1 * 100} r="4" className="easing-handle" />
              <circle cx={curve.x2 * 100} cy={100 - curve.y2 * 100} r="4" className="easing-handle" />
            </>
          ) : null}
        </svg>

        <div className="easing-controls">
          <select
            onChange={(event) => onChange(event.target.value as SceneKeyframe["easing"], curve)}
            value={keyframe.easing}
          >
            {named.map((entry) => (
              <option key={entry.value} value={entry.value}>{tr(entry.ru, entry.en)}</option>
            ))}
          </select>

          {keyframe.easing === "bezier" ? (
            <>
              <div className="easing-presets">
                {bezierPresets.map((preset) => (
                  <button key={preset.name} onClick={() => onChange("bezier", preset.curve)} type="button">
                    {preset.name}
                  </button>
                ))}
              </div>
              {/* По X ручки зажаты в 0..1: кривая, у которой время идёт назад,
                  даёт у одного момента два значения. По Y предел шире —
                  отскок за диапазон это законный приём. */}
              {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                <label className="easing-slider" key={key}>
                  <span>{key}</span>
                  <input
                    max={key.startsWith("x") ? 1 : 2}
                    min={key.startsWith("x") ? 0 : -1}
                    onChange={(event) => setHandle(key, Number(event.target.value))}
                    step={0.01}
                    type="range"
                    value={curve[key]}
                  />
                  <i>{curve[key].toFixed(2)}</i>
                </label>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Именованные режимы для графика: та же математика, что в `applyEasing`. */
function namedValue(easing: SceneKeyframe["easing"], p: number): number {
  if (easing === "linear") return p;
  if (easing === "in") return p * p * p;
  if (easing === "out") return 1 - Math.pow(1 - p, 3);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
