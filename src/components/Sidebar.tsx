import type { ConnectionConfig } from "../types";

export function Sidebar({
  connections,
  width,
  onOpen,
  onEdit,
  onDelete,
  onNew,
}: {
  connections: ConnectionConfig[];
  width: number;
  onOpen: (conn: ConnectionConfig) => void;
  onEdit: (conn: ConnectionConfig) => void;
  onDelete: (conn: ConnectionConfig) => void;
  onNew: () => void;
}) {
  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span>Подключения</span>
      </div>
      <button className="btn primary new-conn-btn" onClick={onNew}>
        + Новое подключение
      </button>
      <div className="sidebar-list">
        {connections.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: "var(--text-dim)" }}>
            Пока нет сохранённых подключений
          </div>
        )}
        {connections.map((c) => (
          <div className="conn-item" key={c.id} onClick={() => onOpen(c)}>
            <div>
              <div className="name">{c.name}</div>
              <div className="meta">
                {c.user}@{c.host}:{c.port}/{c.dbname}
              </div>
            </div>
            <div className="actions">
              <button
                className="icon-btn"
                title="Изменить"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(c);
                }}
              >
                ✎
              </button>
              <button
                className="icon-btn"
                title="Удалить"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c);
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
