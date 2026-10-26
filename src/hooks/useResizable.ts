import { useCallback, useEffect, useRef, useState } from "react";

type Direction = "horizontal" | "vertical";

interface UseResizableOptions {
  initial: number;
  min: number;
  max: number;
  direction: Direction;
  /** Если задан — размер сохраняется/восстанавливается из localStorage. */
  storageKey?: string;
}

function readStored(key: string | undefined, fallback: number, min: number, max: number): number {
  if (!key) return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Управляет размером панели, которая находится "перед" разделителем
 * (слева — для горизонтального, сверху — для вертикального). Перетаскивание
 * разделителя в сторону увеличения координаты увеличивает размер панели.
 */
export function useResizable({ initial, min, max, direction, storageKey }: UseResizableOptions) {
  const [size, setSize] = useState(() => readStored(storageKey, initial, min, max));
  const [dragging, setDragging] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSize.current = size;
      setDragging(true);
    },
    [direction, size]
  );

  useEffect(() => {
    if (!dragging) return;

    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    function onMove(e: MouseEvent) {
      const pos = direction === "horizontal" ? e.clientX : e.clientY;
      const next = clamp(startSize.current + (pos - startPos.current));
      setSize(next);
    }
    function onUp() {
      setDragging(false);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, direction, clamp]);

  // Сохраняем в localStorage только по завершении перетаскивания.
  useEffect(() => {
    if (dragging || !storageKey) return;
    localStorage.setItem(storageKey, String(size));
  }, [dragging, size, storageKey]);

  return { size, onMouseDown, dragging };
}
