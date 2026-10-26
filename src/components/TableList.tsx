import { useMemo } from "react";
import type { TableInfo } from "../types";

export function TableList({
  tables,
  selected,
  onSelect,
  onRefresh,
  refreshing,
  width,
  onCreateTable,
}: {
  tables: TableInfo[];
  selected: TableInfo | null;
  onSelect: (t: TableInfo) => void;
  onRefresh: () => void;
  refreshing: boolean;
  width: number;
  onCreateTable: () => void;
}) {
  const bySchema = useMemo(() => {
    const map = new Map<string, TableInfo[]>();
    for (const t of tables) {
      if (!map.has(t.schema)) map.set(t.schema, []);
      map.get(t.schema)!.push(t);
    }
    return map;
  }, [tables]);

  return (
    <div className="table-tree" style={{ width }}>
      <div className="table-tree-header">
        <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase" }}>
          Таблицы
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="refresh-btn" onClick={onCreateTable} title="Создать таблицу">
            +
          </button>
          <button className="refresh-btn" onClick={onRefresh} disabled={refreshing} title="Обновить список">
            {refreshing ? "…" : "⟳"}
          </button>
        </div>
      </div>
      {tables.length === 0 && !refreshing && (
        <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--text-dim)" }}>
          Таблицы не найдены. Если вы только что их создали — нажмите ⟳ обновить.
        </div>
      )}
      {[...bySchema.entries()].map(([schema, items]) => (
        <div key={schema}>
          <div className="schema-label">{schema}</div>
          {items.map((t) => (
            <div
              key={`${t.schema}.${t.name}`}
              className={
                "table-row" +
                (selected && selected.schema === t.schema && selected.name === t.name
                  ? " active"
                  : "")
              }
              onClick={() => onSelect(t)}
            >
              <span>{t.kind === "view" ? "👁" : "▤"}</span>
              <span className="table-row-name">{t.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
