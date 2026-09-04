/* -------------------------------------------------------------------------- *
 * Опознаватели строк расписания и показов сцен.
 *
 * У показа сцены опознаватель ограничен контрактом 64 символами
 * (`playoutSceneShowSchema`), и это не формальность: снимок сессии проверяется
 * одной схемой целиком, поэтому один слишком длинный опознаватель отменяет
 * **всё** сохранение. Снаружи это выглядит как «сессия перестала сохраняться»
 * — без единого указания на то, что дело в идентификаторе.
 *
 * Сюда же собраны опознаватели строк расписания: они склеиваются в другие
 * идентификаторы, и их длина расходится по всей модели.
 * ------------------------------------------------------------------------- */

/** Потолок из `playoutSceneShowSchema`. */
export const maximumSceneShowIdLength = 64;

/**
 * Короткий устойчивый отпечаток строки.
 *
 * Не криптография: он нужен только чтобы различать склеенные опознаватели
 * после обрезки, и восемь шестнадцатеричных знаков дают для этого запас.
 */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Опознаватель показа сцены, который заведомо влезает в контракт.
 *
 * Части склеиваются как есть, пока помещаются; переросшая склейка
 * подменяется отпечатком целиком — он короткий, устойчивый и различает
 * показы так же надёжно, как исходная строка.
 */
export function sceneShowId(...parts: readonly string[]): string {
  const joined = parts.filter(Boolean).join("-");
  if (joined.length <= maximumSceneShowIdLength) return joined;
  const prefix = parts[0] ?? "scene";
  const short = `${prefix}-${shortHash(joined)}`;
  return short.length <= maximumSceneShowIdLength
    ? short
    : short.slice(0, maximumSceneShowIdLength);
}

/**
 * Приводит опознаватели показов к контрактной длине.
 *
 * Нужна сессиям, собранным прежними версиями: там уже лежат длинные
 * опознаватели, и без приведения такая сессия не сохранится вовсе — оператор
 * теряет всё, что сделал с прошлого удачного сохранения.
 */
export function withValidSceneShowIds<T extends { scenes?: { id: string }[] }>(
  asset: T,
): T {
  const scenes = asset.scenes;
  if (!scenes || scenes.every((show) => show.id.length <= maximumSceneShowIdLength)) {
    return asset;
  }
  return {
    ...asset,
    scenes: scenes.map((show) => (show.id.length <= maximumSceneShowIdLength
      ? show
      : { ...show, id: sceneShowId("scene", show.id) })),
  };
}
