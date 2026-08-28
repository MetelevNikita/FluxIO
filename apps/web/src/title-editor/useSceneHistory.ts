import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneTemplate } from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * История правок сцены.
 *
 * Шаг истории — не каждое движение мыши. Перетаскивание узла даёт десятки
 * правок в секунду, и отмена по каждой означала бы полсотни нажатий, чтобы
 * вернуться на один осмысленный шаг назад. Поэтому подряд идущие правки
 * сливаются в один шаг, пока между ними меньше паузы слияния.
 * ------------------------------------------------------------------------- */

/** Пауза, после которой правка считается новым шагом. */
const mergeWindowMs = 400;
/** Глубина истории: дальше держать незачем, а память не бесконечная. */
const depth = 100;

export interface SceneHistory {
  /** Записать правку. `commit` — закрыть шаг сразу, не дожидаясь паузы. */
  push: (template: SceneTemplate, commit?: boolean) => void;
  undo: () => SceneTemplate | null;
  redo: () => SceneTemplate | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useSceneHistory(
  initial: SceneTemplate,
  onRestore: (template: SceneTemplate) => void,
): SceneHistory {
  const past = useRef<SceneTemplate[]>([]);
  const future = useRef<SceneTemplate[]>([]);
  const current = useRef<SceneTemplate>(initial);
  const lastPushAt = useRef(0);
  const [, force] = useState(0);

  const push = useCallback((template: SceneTemplate, commit = false) => {
    const now = Date.now();
    const merge = !commit && now - lastPushAt.current < mergeWindowMs && past.current.length > 0;
    if (!merge) {
      past.current = [...past.current, current.current].slice(-depth);
      // Новая ветка правок обрывает то, что было отменено: держать её дальше
      // значит обещать возврат, которого уже не будет.
      future.current = [];
    }
    lastPushAt.current = commit ? 0 : now;
    current.current = template;
    force((value) => value + 1);
  }, []);

  const undo = useCallback((): SceneTemplate | null => {
    const previous = past.current.at(-1);
    if (!previous) return null;
    past.current = past.current.slice(0, -1);
    future.current = [current.current, ...future.current].slice(0, depth);
    current.current = previous;
    lastPushAt.current = 0;
    force((value) => value + 1);
    onRestore(previous);
    return previous;
  }, [onRestore]);

  const redo = useCallback((): SceneTemplate | null => {
    const next = future.current[0];
    if (!next) return null;
    future.current = future.current.slice(1);
    past.current = [...past.current, current.current].slice(-depth);
    current.current = next;
    lastPushAt.current = 0;
    force((value) => value + 1);
    onRestore(next);
    return next;
  }, [onRestore]);

  // Ctrl+Z / Cmd+Z и Ctrl+Shift+Z. Слушаем на окне: фокус может быть в любом
  // поле инспектора, а отмена нужна отовсюду.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      // В поле ввода отмена принадлежит самому полю: перехватить её значит
      // отменить чужую правку вместо своей буквы.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    push,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
