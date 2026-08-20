import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { PlayoutStatus } from "@gruber/contracts";

/**
 * Живой статус эфира — через контекст, а не пропсом.
 *
 * Статус опрашивается раз в секунду и приходит новым объектом. Пока он шёл
 * пропсом, `memo` на экране не работал в принципе: перерисовывалась вся форма
 * настроек вместе с селекторами и полями ввода, и оператор ловил это как
 * залипание. Через контекст обновляются только те узлы, которые статус
 * действительно показывают, — монитор кодирования и строка состояния.
 */
const PlayoutStatusContext = createContext<PlayoutStatus | null>(null);

export function PlayoutStatusProvider(
  { status, children }: { status: PlayoutStatus | null; children: ReactNode },
): ReactElement {
  return (
    <PlayoutStatusContext.Provider value={status}>{children}</PlayoutStatusContext.Provider>
  );
}

export function usePlayoutStatus(): PlayoutStatus | null {
  return useContext(PlayoutStatusContext);
}
