import type { ReactNode } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Удалить",
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 0 }}>{message}</p>
        {children}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
