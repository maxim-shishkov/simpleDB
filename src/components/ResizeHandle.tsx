export function ResizeHandle({
  direction,
  dragging,
  onMouseDown,
}: {
  direction: "horizontal" | "vertical";
  dragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={
        "resize-handle " + (direction === "horizontal" ? "h" : "v") + (dragging ? " dragging" : "")
      }
      onMouseDown={onMouseDown}
    />
  );
}
