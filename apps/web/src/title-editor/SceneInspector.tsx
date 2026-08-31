import type {
  SceneField, SceneGradient, SceneLayoutTarget, SceneNode, SceneTemplate, SystemFont,
} from "@gruber/contracts";
import { ChevronRight, Diamond, FolderOpen, KeyRound, Link2, Link2Off, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clearLayoutOverride, groupChildren, nodeKindTitle, setGroupContainer, setNodeAnchor,
  setRevealOrigin, textAnimatorPresets,
} from "../scene-edit";
import { useI18n } from "../i18n";

/** Типографские пункты показываем относительно эталонного кадра 1080p. */
const pointsPerSceneHeight = 1_080 * 72 / 96;

/* -------------------------------------------------------------------------- *
 * Инспектор свойств узла.
 *
 * Числовые поля держат локальный черновик строки: `input[type=number]` отдаёт
 * пустую строку для незавершённого ввода — «1.», «-», «1e», — и прямое
 * приведение к числу возвращало бы поле назад, делая дробный ввод невозможным.
 * ------------------------------------------------------------------------- */

interface SceneInspectorProps {
  template: SceneTemplate;
  node: SceneNode | null;
  /** Выбранная раскладка или `null` — правим общую сцену. */
  target: SceneLayoutTarget | null;
  fonts: SystemFont[];
  onChange: (node: SceneNode) => void;
  /** Правка, затрагивающая весь шаблон: контейнер группы меняет и её детей. */
  onChangeTemplate: (template: SceneTemplate) => void;
  onDeclareField: (nodeId: string, label: string) => void;
  onRemoveField: (key: string) => void;
  onFieldChange: (key: string, patch: Partial<SceneField>) => void;
  onPickMedia: (nodeId: string) => void;
  /** Нарисованная коробка узла в долях кадра — нужна для переноса привязки. */
  drawnBox: { width: number; height: number } | null;
  /**
   * Ключи прямо у свойства.
   *
   * Дорожка внизу показывает уже поставленное, а ставить ключ удобнее там же,
   * где правится значение: иначе приходится держать в голове, какая строка
   * дорожки какому полю соответствует.
   */
  keyframes: {
    /** Есть ли ключ у этой дорожки в текущий момент. */
    at: (track: KeyableTrack) => "here" | "animated" | "none";
    /** Можно ли сейчас ставить ключ: в удержании их не бывает. */
    enabled: boolean;
    /** Значение дорожки под ползунком, а не её невидимая база. */
    value: (track: KeyableTrack) => number;
    /** Анимированная дорожка автоматически пишет ключ под ползунком. */
    commit: (track: KeyableTrack, value: number) => void;
    toggle: (track: KeyableTrack) => void;
  };
}

/** Дорожки, у которых имеет смысл ставить ключи из инспектора. */
export type KeyableTrack =
  | "x" | "y" | "width" | "height"
  | "opacity" | "rotationDegrees" | "scale" | "reveal";

export function SceneInspector({
  template, node, target, fonts, onChange, onChangeTemplate, onDeclareField, onRemoveField, onFieldChange, onPickMedia, drawnBox, keyframes,
}: SceneInspectorProps) {
  const { tr } = useI18n();
  if (!node) {
    return (
      <aside className="scene-inspector">
        <p className="scene-inspector-empty">
          {tr("Выберите узел на холсте или в списке слоёв.", "Select a node on the canvas or in the layer list.")}
        </p>
      </aside>
    );
  }

  const override = target ? node.overrides[target] : undefined;
  const hasOverride = Boolean(override && Object.values(override).some((value) => value !== null));

  /** Кнопка ключа для дорожки — одна и та же во всех строках свойств. */
  const keyed = (track: KeyableTrack) => (
    <KeyButton
      disabled={!keyframes.enabled}
      onToggle={() => keyframes.toggle(track)}
      state={keyframes.at(track)}
      tr={tr}
    />
  );

  const boundKey = node.text?.kind === "field" ? node.text.fieldKey : null;
  const field = boundKey
    ? template.fields.find((entry) => entry.key === boundKey) ?? null
    : null;

  return (
    <aside className="scene-inspector">
      <header className="scene-inspector-head">
        <strong>{node.name}</strong>
        <span>{nodeKindTitle(node.kind, tr)}</span>
      </header>

      {target ? (
        <div className={`scene-target-note ${hasOverride ? "active" : ""}`}>
          <span>
            {hasOverride
              ? tr(`Правки идут поправкой для ${target}`, `Edits land as a ${target} override`)
              : tr(`Правки лягут поправкой для ${target}`, `Edits will land as a ${target} override`)}
          </span>
          {hasOverride ? (
            <button
              onClick={() => onChange(clearLayoutOverride(node, target))}
              title={tr("Вернуть «как в общей сцене»", "Reset to the shared scene")}
              type="button"
            >
              <RotateCcw size={11} /> {tr("Сбросить", "Reset")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Ключ ставится там же, где правится значение: держать в голове, какая
          строка дорожки какому полю соответствует, — лишняя работа. */}
      <Section title={tr("Положение", "Position")}>
        <Grid>
          <Num keyed={keyed("x")} label="X" value={override?.x ?? keyframes.value("x")} unit="%"
            onCommit={(v) => keyframes.commit("x", v)} />
          <Num keyed={keyed("y")} label="Y" value={override?.y ?? keyframes.value("y")} unit="%"
            onCommit={(v) => keyframes.commit("y", v)} />
          <Num keyed={keyed("width")} label={tr("Ширина", "Width")} value={override?.width ?? keyframes.value("width")} unit="%"
            onCommit={(v) => keyframes.commit("width", v)} />
          <Num keyed={keyed("height")} label={tr("Высота", "Height")} value={override?.height ?? keyframes.value("height")} unit="%"
            onCommit={(v) => keyframes.commit("height", v)} />
        </Grid>
        <p className="scene-hint">
          {tr(
            "Доли кадра. X и ширина считаются от ширины кадра, Y и высота — от высоты: так узел стоит на месте при смене раскладки.",
            "Fractions of the frame. X and width come from the width, Y and height from the height.",
          )}
        </p>
      </Section>

      <Section title={tr("Точка привязки", "Anchor point")}>
        {/* От неё считаются поворот, масштаб и положение. Перенос привязки
            не двигает узел: дизайнер выбирает точку отсчёта, а не элемент. */}
        <div className="anchor-grid">
          {[0, 0.5, 1].map((ay) => [0, 0.5, 1].map((ax) => {
            const active = Math.abs(node.transform.anchorX - ax) < 0.01 &&
              Math.abs(node.transform.anchorY - ay) < 0.01;
            return (
              <button
                className={active ? "active" : ""}
                key={`${ax}-${ay}`}
                onClick={() => onChange(setNodeAnchor(
                  node, ax, ay,
                  drawnBox ?? { width: node.transform.width.value, height: node.transform.height.value },
                ))}
                title={anchorTitle(ax, ay, tr)}
                type="button"
              >
                <i />
              </button>
            );
          }))}
        </div>
        <Grid>
          <Num label="X" value={node.transform.anchorX} unit="%"
            onCommit={(v) => onChange(setNodeAnchor(
              node, clamp(v, 0, 1), node.transform.anchorY,
              drawnBox ?? { width: node.transform.width.value, height: node.transform.height.value },
            ))} />
          <Num label="Y" value={node.transform.anchorY} unit="%"
            onCommit={(v) => onChange(setNodeAnchor(
              node, node.transform.anchorX, clamp(v, 0, 1),
              drawnBox ?? { width: node.transform.width.value, height: node.transform.height.value },
            ))} />
        </Grid>
        <p className="scene-hint">
          {tr(
            "От неё считаются поворот и масштаб. Перенос привязки не двигает узел: положение правится ровно настолько, чтобы картинка не изменилась.",
            "Rotation and scale are measured from it. Moving the anchor does not move the node.",
          )}
        </p>
      </Section>

      <Section title={tr("Вид", "Appearance")}>
        <Grid>
          <Num keyed={keyed("opacity")} label={tr("Прозрачность", "Opacity")} value={keyframes.value("opacity")} unit="%"
            onCommit={(v) => keyframes.commit("opacity", clamp(v, 0, 1))} />
          <Num keyed={keyed("rotationDegrees")} label={tr("Поворот", "Rotation")} value={keyframes.value("rotationDegrees")} unit="°" raw
            onCommit={(v) => keyframes.commit("rotationDegrees", v)} />
          <Num keyed={keyed("scale")} label={tr("Масштаб", "Scale")} value={keyframes.value("scale")} unit="%"
            onCommit={(v) => keyframes.commit("scale", Math.max(0, v))} />
        </Grid>
      </Section>

      {node.kind === "rect" || node.kind === "ellipse" ? (
        <Section title={tr("Заливка", "Fill")}>
          <Grid>
            <Color label={tr("Цвет", "Colour")} value={node.rectStyle.fill}
              onChange={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, fill: v } })} />
            <Num label={tr("Непрозрачность", "Opacity")} value={node.rectStyle.fillOpacity} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, fillOpacity: clamp(v, 0, 1) } })} />
            <Num label={tr("Скругление", "Radius")} value={node.rectStyle.cornerRadius} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, cornerRadius: clamp(v, 0, 0.5) } })} />
            <Num label={tr("Обводка", "Stroke")} value={node.rectStyle.strokeWidth} unit="%"
              onCommit={(v) => onChange({ ...node, rectStyle: { ...node.rectStyle, strokeWidth: clamp(v, 0, 0.05) } })} />
          </Grid>

          {/* Вид заливки. Точки градиента заданы долями коробки узла, а не
              кадра: градиент принадлежит узлу и обязан ехать вместе с ним при
              смене раскладки. */}
          <label className="scene-row">
            <span>{tr("Чем залито", "Fill type")}</span>
            <select
              onChange={(event) => onChange({
                ...node,
                rectStyle: {
                  ...node.rectStyle,
                  fillKind: event.target.value as "solid" | "linear" | "radial",
                },
              })}
              value={node.rectStyle.fillKind}
            >
              <option value="solid">{tr("Цветом", "Solid")}</option>
              <option value="linear">{tr("Линейный градиент", "Linear gradient")}</option>
              <option value="radial">{tr("Радиальный градиент", "Radial gradient")}</option>
            </select>
          </label>

          {node.rectStyle.fillKind !== "solid" ? (
            <GradientEditor
              kind={node.rectStyle.fillKind}
              onChange={(gradient) => onChange({
                ...node,
                rectStyle: { ...node.rectStyle, gradient },
              })}
              tr={tr}
              value={node.rectStyle.gradient}
            />
          ) : null}
        </Section>
      ) : null}

      {node.kind === "text" ? (
        <TextSection
          field={field} fonts={fonts} node={node} tr={tr}
          onChange={onChange} onDeclareField={onDeclareField} onRemoveField={onRemoveField}
          onFieldChange={onFieldChange}
        />
      ) : null}

      {node.kind === "video" || node.kind === "image" ? (
        <Section title={tr("Подложка", "Media")}>
          <button className="scene-declare" onClick={() => onPickMedia(node.id)} type="button">
            <FolderOpen size={12} />
            {node.media.filePath
              ? tr("Заменить файл", "Replace file")
              : tr("Выбрать видео или .png", "Choose a video or .png")}
          </button>
          {node.media.filePath ? (
            <>
              <p className="scene-hint">{shortPath(node.media.filePath)}</p>
              <Grid>
                <label className="scene-row">
                  <span>{tr("Длина", "Length")}</span>
                  <input readOnly value={`${node.media.durationSeconds.toFixed(2)} с`} />
                </label>
                <label className="scene-row">
                  <span>{tr("Вписать", "Fit")}</span>
                  <select
                    onChange={(event) => onChange({
                      ...node,
                      media: { ...node.media, fit: event.target.value as "contain" | "cover" | "stretch" },
                    })}
                    value={node.media.fit}
                  >
                    <option value="contain">{tr("целиком", "contain")}</option>
                    <option value="cover">{tr("с обрезкой", "cover")}</option>
                    <option value="stretch">{tr("растянуть", "stretch")}</option>
                  </select>
                </label>
              </Grid>
              {!node.media.hasAlpha ? (
                <p className="scene-hint scene-hint-warn">
                  {tr(
                    "У файла нет альфа-канала — подложка закроет собой всё, что под ней, включая картинку ролика.",
                    "The file has no alpha channel — this will cover everything beneath it.",
                  )}
                </p>
              ) : null}
              <p className="scene-hint">
                {tr(
                  "Подложку кладёт FFmpeg отдельным слоем под сценой: декодировать видео в том же процессе, что считает титр, значит не успеть к кадру.",
                  "Media goes through FFmpeg as its own layer beneath the scene.",
                )}
              </p>
            </>
          ) : null}
        </Section>
      ) : null}

      {node.kind === "text" ? (
        <Section title={tr("Появление текста", "Text animate in")}>
          {/* Готовые наборы, как в After Effects: собирать «печатную машинку»
              по одному ключу дизайнер не станет, а без неё титр умеет только
              проявиться целиком. */}
          <div className="animator-presets">
            {textAnimatorPresets.map((preset) => {
              const current = node.textAnimator;
              const active = current.enabled &&
                current.unit === preset.animator.unit &&
                current.effect === preset.animator.effect &&
                current.direction === preset.animator.direction;
              return (
                <button
                  className={active ? "active" : ""}
                  key={preset.nameEn}
                  onClick={() => onChange({ ...node, textAnimator: preset.animator })}
                  type="button"
                >
                  {tr(preset.name, preset.nameEn)}
                </button>
              );
            })}
          </div>
          <label className="scene-row scene-row-check">
            <input
              checked={node.textAnimator.enabled}
              onChange={(event) => onChange({
                ...node,
                textAnimator: { ...node.textAnimator, enabled: event.target.checked },
              })}
              type="checkbox"
            />
            <span>{tr("Разбирать текст на части", "Animate text by parts")}</span>
          </label>
          {node.textAnimator.enabled ? (
            <>
              <Grid>
                <label className="scene-row">
                  <span>{tr("По чему", "Split by")}</span>
                  <select
                    onChange={(event) => onChange({
                      ...node,
                      textAnimator: {
                        ...node.textAnimator,
                        unit: event.target.value as "character" | "word" | "line",
                      },
                    })}
                    value={node.textAnimator.unit}
                  >
                    <option value="character">{tr("Буквы", "Characters")}</option>
                    <option value="word">{tr("Слова", "Words")}</option>
                    <option value="line">{tr("Строки", "Lines")}</option>
                  </select>
                </label>
                <label className="scene-row">
                  <span>{tr("Как", "Effect")}</span>
                  <select
                    onChange={(event) => onChange({
                      ...node,
                      textAnimator: {
                        ...node.textAnimator,
                        effect: event.target.value as "fade" | "fade-up" | "slide" | "typewriter" | "scale",
                      },
                    })}
                    value={node.textAnimator.effect}
                  >
                    <option value="fade">{tr("Проявление", "Fade")}</option>
                    <option value="fade-up">{tr("Снизу с проявлением", "Fade up")}</option>
                    <option value="slide">{tr("Выезд сбоку", "Slide in")}</option>
                    <option value="typewriter">{tr("Печатная машинка", "Typewriter")}</option>
                    <option value="scale">{tr("Из точки", "Scale")}</option>
                  </select>
                </label>
                <label className="scene-row">
                  <span>{tr("Откуда", "Direction")}</span>
                  <select
                    onChange={(event) => onChange({
                      ...node,
                      textAnimator: {
                        ...node.textAnimator,
                        direction: event.target.value as "forward" | "backward" | "center",
                      },
                    })}
                    value={node.textAnimator.direction}
                  >
                    <option value="forward">{tr("С начала", "From start")}</option>
                    <option value="backward">{tr("С конца", "From end")}</option>
                    <option value="center">{tr("От середины", "From centre")}</option>
                  </select>
                </label>
                <Num label={tr("Разнос", "Stagger")} value={node.textAnimator.stagger} unit="%"
                  onCommit={(v) => onChange({
                    ...node,
                    textAnimator: { ...node.textAnimator, stagger: clamp(v, 0, 1) },
                  })} />
              </Grid>
              <p className="scene-hint">
                {tr(
                  "Разнос — доля, а не секунды: волна укладывается в длину входа при любой длине текста. 0 % — все части сразу, 100 % — строго по очереди.",
                  "Stagger is a fraction, not seconds: the wave fits the in-segment at any text length.",
                )}
              </p>
            </>
          ) : null}
        </Section>
      ) : null}

      {node.kind === "group" ? (
        <Section title={tr("Контейнер", "Container")}>
          {/* Группа без собственных границ ничего не прячет: раскрытие должно
              резать содержимое по краю плашки, а не по краю кадра. */}
          <label className="scene-row">
            <span>{tr("Размер по узлу", "Size from node")}</span>
            <select
              onChange={(event) => onChangeTemplate(setGroupContainer(
                template, node.id, event.target.value ? event.target.value : null,
              ))}
              value={node.fitToNodeId ?? ""}
            >
              <option value="">{tr("— по содержимому —", "— from contents —")}</option>
              {groupChildren(template, node.id).map((child) => (
                <option key={child.id} value={child.id}>{child.name}</option>
              ))}
            </select>
          </label>
          <label className="scene-row scene-row-check">
            <input
              checked={node.clipsChildren}
              onChange={(event) => onChange({ ...node, clipsChildren: event.target.checked })}
              type="checkbox"
            />
            <span>{tr("Резать содержимое по границам", "Clip contents to bounds")}</span>
          </label>
          <p className="scene-hint">
            {tr(
              "Возьми размер от подложки — и раскрытие группы спрячет за её краем весь текст разом, одним ключом вместо ключа на каждый слой.",
              "Take the size from the plate and one reveal key hides every layer at once.",
            )}
          </p>
        </Section>
      ) : null}

      <Section title={tr("Раскрытие маской", "Reveal mask")}>
        {/* Обрезка, а не изменение размера: анимировать ширину у текста нельзя,
            буквы поедут и сожмутся. Маска открывает уже готовую картинку. */}
        <Grid>
          <Num keyed={keyed("reveal")} label={tr("Раскрыто", "Revealed")}
            value={keyframes.value("reveal")} unit="%"
            onCommit={(v) => keyframes.commit("reveal", clamp(v, 0, 1))} />
        </Grid>
        <label className="scene-row">
          <span>{tr("Как открывается", "Reveal style")}</span>
          <select
            onChange={(event) => onChange({
              ...node,
              transform: {
                ...node.transform,
                revealMode: event.target.value as "wipe" | "slide",
              },
            })}
            value={node.transform.revealMode}
          >
            <option value="slide">{tr("Выезд из-под маски", "Slides out of the mask")}</option>
            <option value="wipe">{tr("Шторка на месте", "Wipe in place")}</option>
          </select>
        </label>
        <label className="scene-row">
          <span>{tr("Чем открывается", "Opens by")}</span>
          <select
            onChange={(event) => onChange({
              ...node,
              transform: {
                ...node.transform,
                revealAxis: event.target.value as "x" | "y" | "point",
              },
            })}
            value={node.transform.revealAxis}
          >
            <option value="point">{tr("Из точки", "From the point")}</option>
            <option value="x">{tr("По ширине", "By width")}</option>
            <option value="y">{tr("По высоте", "By height")}</option>
          </select>
        </label>
        <span className="scene-row-label">{tr("Откуда раскрывается", "Reveal origin")}</span>
        <div className="anchor-grid">
          {[0, 0.5, 1].map((oy) => [0, 0.5, 1].map((ox) => {
            const active = Math.abs(node.transform.revealOriginX - ox) < 0.01 &&
              Math.abs(node.transform.revealOriginY - oy) < 0.01;
            return (
              <button
                className={active ? "active" : ""}
                key={`r-${ox}-${oy}`}
                onClick={() => onChange(setRevealOrigin(node, ox, oy))}
                title={anchorTitle(ox, oy, tr)}
                type="button"
              >
                <i />
              </button>
            );
          }))}
        </div>
        <p className="scene-hint">
          {node.transform.revealMode === "slide"
            ? tr(
              "Выезд идёт оттуда, где стоит точка: слева — картинка выползает из-за левого края своей рамки. Из середины выезжать некуда — там останется проявление под маской. Ставится ключами: 0 % в начале входа, 100 % в конце.",
              "The slide comes from wherever the point sits: on the left, the picture crawls out from behind its own left edge. From the centre there is nowhere to slide from.",
            )
            : tr(
              "Шторка открывает неподвижную картинку: окно растёт от точки среза. Точка едет за привязкой — увести её отдельно можно сеткой ниже, уже после переноса привязки. Ставится ключами: 0 % в начале входа, 100 % в конце.",
              "A wipe opens a still picture: the window grows from the cut point, which follows the anchor.",
            )}
        </p>
      </Section>

      <Section title={tr("Ширина по тексту", "Width from text")}>
        {node.kind === "text" ? (
          <p className="scene-hint">
            {tr(
              "Это надпись. Чтобы подложка тянулась за ней, выберите её здесь же — но у самой подложки: привязка живёт на том узле, который меняет размер.",
              "This is the text itself. To make a plate stretch with it, set this binding on the plate — it lives on the node that changes size.",
            )}
          </p>
        ) : null}
        <label className="scene-row">
          <span>{tr("Тянуться по узлу", "Grow with node")}</span>
          <select
            value={node.fitToText?.nodeId ?? ""}
            onChange={(event) => onChange({
              ...node,
              fitToText: event.target.value
                ? {
                    nodeId: event.target.value,
                    padX: node.fitToText?.padX ?? 0.02,
                    padY: node.fitToText?.padY ?? 0.01,
                    axis: node.fitToText?.axis ?? "x",
                    anchor: node.fitToText?.anchor ?? "grow",
                  }
                : null,
            })}
          >
            <option value="">{tr("— не привязан —", "— not bound —")}</option>
            {template.nodes
              .filter((entry) => entry.id !== node.id &&
                (node.fitToText?.anchor === "follow" || entry.kind === "text"))
              .map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {node.fitToText ? (
          <>
            <label className="scene-row">
              <span>{tr("Как ведёт себя", "Behaviour")}</span>
              <select
                onChange={(event) => onChange({
                  ...node,
                  fitToText: { ...node.fitToText!, anchor: event.target.value as "grow" | "follow" },
                })}
                value={node.fitToText.anchor}
              >
                <option value="grow">{tr("тянется по тексту", "grows with the text")}</option>
                <option value="follow">{tr("примыкает справа", "sits at the right edge")}</option>
              </select>
            </label>
            <Grid>
              <Num label={tr("Отступ X", "Pad X")} value={node.fitToText.padX} unit="%"
                onCommit={(v) => onChange({ ...node, fitToText: { ...node.fitToText!, padX: clamp(v, 0, 0.5) } })} />
              <Num label={tr("Отступ Y", "Pad Y")} value={node.fitToText.padY} unit="%"
                onCommit={(v) => onChange({ ...node, fitToText: { ...node.fitToText!, padY: clamp(v, 0, 0.5) } })} />
            </Grid>
            <p className="scene-hint">
              {node.fitToText.anchor === "follow"
                ? tr(
                  "Узел сохраняет свою ширину и едет за правым краем источника — так держится хвост плашки. Источником может быть и сама подложка.",
                  "The node keeps its width and follows the source's right edge — that is how a plate tail stays attached.",
                )
                : tr(
                  "Ширина считается по образцу поля, а не по текущему значению: у часов оно меняется каждую секунду, и плашка дёргалась бы вместе с цифрами.",
                  "Width is measured from the field's sample, not its current value.",
                )}
            </p>
          </>
        ) : null}
      </Section>

      <Section title={tr("Тень", "Shadow")}>
        <label className="scene-row scene-row-check">
          <input
            checked={node.shadow.enabled}
            onChange={(event) => onChange({ ...node, shadow: { ...node.shadow, enabled: event.target.checked } })}
            type="checkbox"
          />
          <span>{tr("Включить", "Enabled")}</span>
        </label>
        {node.shadow.enabled ? (
          <Grid>
            <Color label={tr("Цвет", "Colour")} value={node.shadow.color}
              onChange={(v) => onChange({ ...node, shadow: { ...node.shadow, color: v } })} />
            <Num label={tr("Размытие", "Blur")} value={node.shadow.blur} unit="%"
              onCommit={(v) => onChange({ ...node, shadow: { ...node.shadow, blur: clamp(v, 0, 0.2) } })} />
            <Num label={tr("Сдвиг вниз", "Offset Y")} value={node.shadow.offsetY} unit="%"
              onCommit={(v) => onChange({ ...node, shadow: { ...node.shadow, offsetY: clamp(v, -0.2, 0.2) } })} />
          </Grid>
        ) : null}
      </Section>
    </aside>
  );
}

/* ------------------------------ текст узла -------------------------------- */

function TextSection({
  node, field, fonts, tr, onChange, onDeclareField, onRemoveField, onFieldChange,
}: {
  node: SceneNode;
  field: SceneField | null;
  fonts: SystemFont[];
  tr: (ru: string, en: string) => string;
  onChange: (node: SceneNode) => void;
  onDeclareField: (nodeId: string, label: string) => void;
  onRemoveField: (key: string) => void;
  onFieldChange: (key: string, patch: Partial<SceneField>) => void;
}) {
  const source = node.text;
  return (
    <>
      <Section title={tr("Текст", "Text")}>
        <label className="scene-row">
          <span>{tr("Источник", "Source")}</span>
          <select
            value={source?.kind ?? "static"}
            onChange={(event) => {
              const kind = event.target.value;
              if (kind === "static") onChange({ ...node, text: { kind: "static", text: "" } });
              if (kind === "clock") onChange({ ...node, text: { kind: "clock", format: "HH:MM:SS", timezoneOffsetMinutes: 0 } });
              if (kind === "countdown") onChange({ ...node, text: { kind: "countdown", format: "MM:SS", source: "fixed", seconds: 60 } });
              if (kind === "ticker") onChange({ ...node, text: { kind: "ticker", items: [], separator: "   •   ", speed: 0.06, direction: "left" } });
            }}
          >
            <option value="static">{tr("Постоянный текст", "Static text")}</option>
            <option value="field" disabled={source?.kind !== "field"}>{tr("Поле шаблона", "Template field")}</option>
            <option value="clock">{tr("Часы", "Clock")}</option>
            <option value="countdown">{tr("Обратный отсчёт", "Countdown")}</option>
            <option value="ticker">{tr("Бегущая строка", "Ticker")}</option>
          </select>
        </label>

        {source?.kind === "static" ? (
          <>
            <label className="scene-row">
              <span>{tr("Значение", "Value")}</span>
              <input
                onChange={(event) => onChange({ ...node, text: { kind: "static", text: event.target.value } })}
                value={source.text}
              />
            </label>
            <button
              className="scene-declare"
              onClick={() => onDeclareField(node.id, node.name)}
              type="button"
            >
              <KeyRound size={12} /> {tr("Сделать полем шаблона", "Turn into a template field")}
            </button>
            <p className="scene-hint">
              {tr(
                "Поле — это то, что подставляет эфир. Ключ создаёт редактор: набранный руками промах не виден, и плашка молча выходит в эфир с образцом.",
                "A field is what playout fills in. The editor derives the key: a hand-typed miss is invisible until air.",
              )}
            </p>
          </>
        ) : null}

        {source?.kind === "field" && field ? (
          <div className="scene-field-bound">
            <div>
              <Link2 size={12} />
              <b>{field.label}</b>
              <code>{field.key}</code>
            </div>
            <label className="scene-row">
              <span>{tr("Образец", "Sample")}</span>
              {/* Образец живёт в объявлении поля, а не в узле: им меряется
                  привязанная плашка, и он общий для всех её потребителей. */}
              <input
                onChange={(event) => onFieldChange(field.key, { sample: event.target.value })}
                value={field.sample}
              />
            </label>
            <button onClick={() => onRemoveField(field.key)} type="button">
              <Link2Off size={12} /> {tr("Отвязать", "Unbind")}
            </button>
          </div>
        ) : null}

        {source?.kind === "clock" ? (
          <Grid>
            <label className="scene-row">
              <span>{tr("Формат", "Format")}</span>
              <select
                onChange={(event) => onChange({ ...node, text: { ...source, format: event.target.value as typeof source.format } })}
                value={source.format}
              >
                {["HH:MM:SS", "HH:MM", "MM:SS", "SS"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <Num label={tr("Пояс, мин", "TZ, min")} value={source.timezoneOffsetMinutes} raw
              onCommit={(v) => onChange({ ...node, text: { ...source, timezoneOffsetMinutes: Math.round(v) } })} />
          </Grid>
        ) : null}

        {source?.kind === "countdown" ? (
          <Grid>
            <label className="scene-row">
              <span>{tr("Отсчёт", "Counts")}</span>
              <select
                onChange={(event) => onChange({ ...node, text: { ...source, source: event.target.value as typeof source.source } })}
                value={source.source}
              >
                <option value="fixed">{tr("от заданного", "from a fixed value")}</option>
                <option value="clip-remaining">{tr("до конца ролика", "to the end of the clip")}</option>
              </select>
            </label>
            <Num label={tr("Секунд", "Seconds")} value={source.seconds} raw
              onCommit={(v) => onChange({ ...node, text: { ...source, seconds: Math.max(1, v) } })} />
          </Grid>
        ) : null}

        {source?.kind === "ticker" ? (
          <>
            <label className="scene-row">
              <span>{tr("Сообщения", "Messages")}</span>
              <textarea
                onChange={(event) => onChange({
                  ...node,
                  text: { ...source, items: event.target.value.split("\n").filter(Boolean) },
                })}
                rows={4}
                value={source.items.join("\n")}
              />
            </label>
            <Grid>
              <Num label={tr("Скорость", "Speed")} value={source.speed} unit="%"
                onCommit={(v) => onChange({ ...node, text: { ...source, speed: clamp(v, 0.001, 2) } })} />
              <label className="scene-row">
                <span>{tr("Направление", "Direction")}</span>
                <select
                  onChange={(event) => onChange({ ...node, text: { ...source, direction: event.target.value as "left" | "right" } })}
                  value={source.direction}
                >
                  <option value="left">←</option>
                  <option value="right">→</option>
                </select>
              </label>
            </Grid>
          </>
        ) : null}
      </Section>

      <Section title={tr("Шрифт", "Font")}>
        <label className="scene-row">
          <span>{tr("Файл", "File")}</span>
          <select
            onChange={(event) => {
              const font = fonts.find((entry) => entry.filePath === event.target.value);
              onChange({
                ...node,
                textStyle: {
                  ...node.textStyle,
                  fontFilePath: font?.filePath ?? null,
                  fontFamily: font?.family ?? "",
                },
              });
            }}
            value={node.textStyle.fontFilePath ?? ""}
          >
            <option value="">{tr("— не выбран —", "— none —")}</option>
            {fonts.map((font) => (
              <option key={font.filePath} value={font.filePath}>
                {font.family}{font.cyrillic ? "" : tr("  · без кириллицы", "  · no Cyrillic")}
              </option>
            ))}
          </select>
        </label>
        {!node.textStyle.fontFilePath ? (
          <p className="scene-hint scene-hint-warn">
            {tr(
              "Шрифт задаётся файлом, а не именем семейства. Без него кириллица может выйти в эфир пустыми прямоугольниками — и заметно это только на выходе.",
              "The font is a file, not a family name. Without one, Cyrillic can reach air as empty boxes.",
            )}
          </p>
        ) : null}
        <Grid>
          <Num label={tr("Кегль", "Font size")} value={node.textStyle.size * pointsPerSceneHeight} unit="pt" raw
            onCommit={(v) => onChange({
              ...node,
              textStyle: { ...node.textStyle, size: clamp(v, 1, 300) / pointsPerSceneHeight },
            })} />
          <Color label={tr("Цвет", "Colour")} value={node.textStyle.color}
            onChange={(v) => onChange({ ...node, textStyle: { ...node.textStyle, color: v } })} />
          <label className="scene-row">
            <span>{tr("Выключка", "Align")}</span>
            <select
              onChange={(event) => onChange({ ...node, textStyle: { ...node.textStyle, align: event.target.value as "left" | "center" | "right" } })}
              value={node.textStyle.align}
            >
              <option value="left">{tr("влево", "left")}</option>
              <option value="center">{tr("по центру", "centre")}</option>
              <option value="right">{tr("вправо", "right")}</option>
            </select>
          </label>
          <Num label={tr("Обводка", "Stroke")} value={node.textStyle.strokeWidth} unit="%"
            onCommit={(v) => onChange({ ...node, textStyle: { ...node.textStyle, strokeWidth: clamp(v, 0, 0.02) } })} />
        </Grid>
      </Section>
    </>
  );
}

/* ------------------------------- примитивы -------------------------------- */

/**
 * Кнопка ключа у свойства.
 *
 * Три состояния, и различать их обязательно: залитый ромб — ключ стоит именно
 * здесь, пустой — дорожка анимирована, но в этот момент ключа нет, тусклый —
 * анимации нет вовсе. Без этого непонятно, что сделает нажатие.
 */
function KeyButton({
  state, disabled, onToggle, tr,
}: {
  state: "here" | "animated" | "none";
  disabled: boolean;
  onToggle: () => void;
  tr: (ru: string, en: string) => string;
}) {
  return (
    <button
      className={`scene-key-toggle ${state}`}
      disabled={disabled}
      onClick={onToggle}
      title={disabled
        ? tr(
          "Ключей в удержании не бывает: оно растягивается под длительность показа. Встаньте на вход или выход.",
          "Hold takes no keyframes: it stretches with the duration. Move to the entrance or the exit.",
        )
        : state === "here"
          ? tr("Убрать ключ в этой точке", "Remove the keyframe here")
          : tr(
            "Поставить ключ в этой точке; следующие изменения значения будут создавать ключи автоматически",
            "Add a keyframe here; further value changes create keyframes automatically",
          )}
      type="button"
    >
      <Diamond fill={state === "here" ? "currentColor" : "none"} size={10} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <details className="scene-section" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>
      <summary><ChevronRight aria-hidden="true" size={11} /> {title}</summary>
      <div className="scene-section-body">{children}</div>
    </details>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="scene-grid">{children}</div>;
}

/**
 * Число с локальным черновиком.
 *
 * `input[type=number]` отдаёт пустую строку для незавершённого ввода — «1.»,
 * «-», «1e». Прямое `Number(value)` даёт ноль и возвращает поле назад: набрать
 * дробное значение становится невозможно.
 */
function Num({
  label, value, unit, raw, keyed, onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  /** Показывать как есть, а не долей в процентах. */
  raw?: boolean;
  /** Кнопка ключа рядом с подписью. */
  keyed?: React.ReactNode;
  onCommit: (value: number) => void;
}) {
  const shown = raw ? value : value * 100;
  const [draft, setDraft] = useState(String(round(shown)));
  useEffect(() => { setDraft(String(round(raw ? value : value * 100))); }, [value, raw]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) { setDraft(String(round(shown))); return; }
    onCommit(raw ? parsed : parsed / 100);
  };

  return (
    <label className="scene-row scene-row-num">
      <span>{label}{keyed}</span>
      <input
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        value={draft}
      />
      {unit ? <i>{unit}</i> : null}
    </label>
  );
}

/**
 * Цвет. Регистр не трогаем ни на входе, ни на выходе: `input[type=color]`
 * возвращает значение строчными буквами, и приведение к верхнему регистру
 * расходится с DOM — React возвращает поле назад, и пипетка перестаёт слушаться.
 */
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="scene-row scene-row-color">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} type="color" value={value} />
    </label>
  );
}

/** Хвост пути: целиком он не помещается и мешает читать остальное. */
function shortPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

/** Подпись точки привязки — по ней её и выбирают. */
function anchorTitle(ax: number, ay: number, tr: (ru: string, en: string) => string): string {
  const vertical = ay === 0 ? tr("верх", "top") : ay === 1 ? tr("низ", "bottom") : tr("середина", "middle");
  const horizontal = ax === 0 ? tr("слева", "left") : ax === 1 ? tr("справа", "right") : tr("по центру", "centre");
  return `${vertical} · ${horizontal}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------- градиент --------------------------------- */

/**
 * Правка градиента: направление и точки перехода.
 *
 * Направление задаётся готовыми кнопками, а не углом: угол приходится
 * пересчитывать в голове, а «слева направо» и «сверху вниз» — то, чем плашка
 * заливается в девяти случаях из десяти. Точная пара точек остаётся полями
 * ниже — у радиального это центр и точка на внешнем круге.
 */
function GradientEditor({
  kind, value, onChange, tr,
}: {
  kind: "linear" | "radial";
  value: SceneGradient;
  onChange: (gradient: SceneGradient) => void;
  tr: (ru: string, en: string) => string;
}) {
  const directions: { ru: string; en: string; from: [number, number]; to: [number, number] }[] = [
    { ru: "→", en: "→", from: [0, 0.5], to: [1, 0.5] },
    { ru: "←", en: "←", from: [1, 0.5], to: [0, 0.5] },
    { ru: "↓", en: "↓", from: [0.5, 0], to: [0.5, 1] },
    { ru: "↑", en: "↑", from: [0.5, 1], to: [0.5, 0] },
    { ru: "↘", en: "↘", from: [0, 0], to: [1, 1] },
    { ru: "↗", en: "↗", from: [0, 1], to: [1, 0] },
  ];

  const stops = [...value.stops].sort((a, b) => a.offset - b.offset);
  const preview = `${kind === "linear" ? "linear-gradient(90deg" : "radial-gradient(circle"}, ${
    stops.map((stop) => `${withAlpha(stop.color, stop.opacity)} ${(stop.offset * 100).toFixed(0)}%`).join(", ")
  })`;

  const patchStop = (index: number, patch: Partial<SceneGradient["stops"][number]>) => {
    onChange({
      ...value,
      stops: value.stops.map((stop, at) => (at === index ? { ...stop, ...patch } : stop)),
    });
  };

  return (
    <div className="gradient-editor">
      <div className="gradient-bar" style={{ backgroundImage: preview }} />

      {kind === "linear" ? (
        <div className="gradient-directions">
          {directions.map((direction) => {
            const active = Math.abs(value.fromX - direction.from[0]) < 0.01 &&
              Math.abs(value.fromY - direction.from[1]) < 0.01 &&
              Math.abs(value.toX - direction.to[0]) < 0.01 &&
              Math.abs(value.toY - direction.to[1]) < 0.01;
            return (
              <button
                className={active ? "active" : ""}
                key={direction.en}
                onClick={() => onChange({
                  ...value,
                  fromX: direction.from[0], fromY: direction.from[1],
                  toX: direction.to[0], toY: direction.to[1],
                })}
                type="button"
              >
                {tr(direction.ru, direction.en)}
              </button>
            );
          })}
        </div>
      ) : null}

      <Grid>
        <Num label={kind === "radial" ? tr("Центр X", "Centre X") : tr("Начало X", "From X")}
          value={value.fromX} unit="%"
          onCommit={(v) => onChange({ ...value, fromX: clamp(v, -1, 2) })} />
        <Num label={kind === "radial" ? tr("Центр Y", "Centre Y") : tr("Начало Y", "From Y")}
          value={value.fromY} unit="%"
          onCommit={(v) => onChange({ ...value, fromY: clamp(v, -1, 2) })} />
        <Num label={kind === "radial" ? tr("Край X", "Edge X") : tr("Конец X", "To X")}
          value={value.toX} unit="%"
          onCommit={(v) => onChange({ ...value, toX: clamp(v, -1, 2) })} />
        <Num label={kind === "radial" ? tr("Край Y", "Edge Y") : tr("Конец Y", "To Y")}
          value={value.toY} unit="%"
          onCommit={(v) => onChange({ ...value, toY: clamp(v, -1, 2) })} />
      </Grid>

      <span className="scene-row-label">{tr("Точки перехода", "Colour stops")}</span>
      {stops.map((stop) => {
        const index = value.stops.indexOf(stop);
        return (
          <div className="gradient-stop" key={index}>
            <input
              onChange={(event) => patchStop(index, { color: event.target.value })}
              type="color"
              value={stop.color}
            />
            <label>
              <span>{tr("Место", "At")}</span>
              <input
                max={100} min={0}
                onChange={(event) => patchStop(index, { offset: Number(event.target.value) / 100 })}
                type="range"
                value={Math.round(stop.offset * 100)}
              />
            </label>
            <label>
              <span>{tr("Прозр.", "Alpha")}</span>
              <input
                max={100} min={0}
                onChange={(event) => patchStop(index, { opacity: Number(event.target.value) / 100 })}
                type="range"
                value={Math.round(stop.opacity * 100)}
              />
            </label>
            <button
              className="gradient-stop-remove"
              disabled={value.stops.length <= 2}
              onClick={() => onChange({
                ...value,
                stops: value.stops.filter((_, at) => at !== index),
              })}
              title={tr("Убрать точку", "Remove stop")}
              type="button"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}

      <button
        className="scene-declare"
        disabled={value.stops.length >= 8}
        onClick={() => {
          // Новая точка встаёт в самый широкий промежуток: там она и нужна,
          // а поставленная в конец слипается с крайней и выглядит потерянной.
          let at = 0.5;
          let widest = 0;
          const sorted = [...value.stops].sort((a, b) => a.offset - b.offset);
          for (let index = 1; index < sorted.length; index += 1) {
            const gap = sorted[index]!.offset - sorted[index - 1]!.offset;
            if (gap > widest) {
              widest = gap;
              at = sorted[index - 1]!.offset + gap / 2;
            }
          }
          onChange({
            ...value,
            stops: [...value.stops, { offset: at, color: sorted[0]?.color ?? "#000000", opacity: 1 }],
          });
        }}
        type="button"
      >
        {tr("Добавить точку", "Add stop")}
      </button>
    </div>
  );
}

/** Цвет с прозрачностью для предпросмотра полосы в интерфейсе. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
