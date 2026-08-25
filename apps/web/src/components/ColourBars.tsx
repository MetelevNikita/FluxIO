/**
 * Цветные полосы SMPTE.
 *
 * Рисуются вектором, а не картинкой: заглушка должна выглядеть одинаково на
 * любом размере панели и не зависеть от файла на диске — установка бывает
 * офлайновой, и недостающий `.png` превратил бы монитор в пустой прямоугольник.
 *
 * Та же картинка отвечает за два состояния сразу: эфир ещё не запущен, и эфир
 * запущен без расписания — во втором случае ровно эти полосы FFmpeg отдаёт
 * в линию генератором `smptehdbars`.
 */

/** 75-процентные цвета верхнего ряда — тот же порядок, что и у генератора FFmpeg. */
const topBars = [
  "#BFBFBF",
  "#BFBF00",
  "#00BFBF",
  "#00BF00",
  "#BF00BF",
  "#BF0000",
  "#0000BF",
];

/** Обратный синий ряд: проверка цветовой синхронизации на глаз. */
const middleBars = [
  "#0000BF",
  "#131313",
  "#BF00BF",
  "#131313",
  "#00BFBF",
  "#131313",
  "#BFBFBF",
];

const frameWidth = 1_920;
const frameHeight = 1_080;
const columnWidth = frameWidth / topBars.length;
const topHeight = 720;
const middleHeight = 90;
const bottomY = topHeight + middleHeight;
const bottomHeight = frameHeight - bottomY;

/**
 * Нижний ряд: опорные сигналы -I, 100% белый, +Q, чёрный и PLUGE.
 * PLUGE — три градации вокруг уровня чёрного, по ним выставляют яркость.
 */
const bottomBars: { color: string; width: number }[] = [
  { color: "#00214C", width: columnWidth },
  { color: "#FFFFFF", width: columnWidth },
  { color: "#32006A", width: columnWidth },
  { color: "#131313", width: columnWidth },
  { color: "#070707", width: columnWidth / 3 },
  { color: "#131313", width: columnWidth / 3 },
  { color: "#1F1F1F", width: columnWidth / 3 },
  { color: "#131313", width: columnWidth * 2 },
];

export function ColourBars({ title }: { title?: string }) {
  let bottomX = 0;
  return (
    <svg
      aria-label={title ?? "Colour bars"}
      className="colour-bars"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
    >
      {topBars.map((color, index) => (
        <rect
          fill={color}
          height={topHeight}
          key={`top-${color}`}
          width={columnWidth + 1}
          x={index * columnWidth}
          y={0}
        />
      ))}
      {middleBars.map((color, index) => (
        <rect
          fill={color}
          height={middleHeight}
          key={`middle-${index}`}
          width={columnWidth + 1}
          x={index * columnWidth}
          y={topHeight}
        />
      ))}
      {bottomBars.map((bar, index) => {
        const x = bottomX;
        bottomX += bar.width;
        return (
          <rect
            fill={bar.color}
            height={bottomHeight}
            key={`bottom-${index}`}
            width={bar.width + 1}
            x={x}
            y={bottomY}
          />
        );
      })}
    </svg>
  );
}
