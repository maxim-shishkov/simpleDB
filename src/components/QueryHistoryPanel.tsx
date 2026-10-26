import type { HistoryEntry } from "../history";

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function QueryHistoryPanel({
  entries,
  onSelect,
  onClear,
}: {
  entries: HistoryEntry[];
  onSelect: (sql: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span>История запросов</span>
        {entries.length > 0 && (
          <button className="icon-btn" onClick={onClear} title="Очистить историю">
            Очистить
          </button>
        )}
      </div>
      {entries.length === 0 && (
        <div className="history-empty">Здесь появятся выполненные запросы</div>
      )}
      <div className="history-list">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="history-item"
            onClick={() => onSelect(entry.sql)}
            title="Нажмите, чтобы вставить в редактор"
          >
            <span className={"history-dot" + (entry.success ? "" : " error")} />
            <span className="history-sql">{entry.sql}</span>
            <span className="history-time">{timeLabel(entry.ranAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
