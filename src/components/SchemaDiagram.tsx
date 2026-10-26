import { useEffect, useMemo, useRef, useState } from "react";
import type { ForeignKeyRef, SchemaColumn, TableInfo } from "../types";
import { ColumnTypeIcon } from "./ColumnTypeIcon";

interface BoxColumn {
  name: string;
  data_type: string;
}

interface Box {
  key: string;
  schema: string;
  name: string;
  columns: BoxColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
  isJunction: boolean;
}

const BOX_WIDTH = 230;
const GAP_X = 90;
const GAP_Y = 70;
const HEADER_H = 30;
const ROW_H = 20;
const MAX_VISIBLE_COLS = 8;
const MARGIN = 40;

function layout(tables: TableInfo[], columns: SchemaColumn[], fks: ForeignKeyRef[]): Box[] {
  const colsByTable = new Map<string, BoxColumn[]>();
  for (const c of columns) {
    const key = `${c.schema}.${c.table}`;
    if (!colsByTable.has(key)) colsByTable.set(key, []);
    colsByTable.get(key)!.push({ name: c.name, data_type: c.data_type });
  }

  // Таблица считается "промежуточной" (many-to-many), если у неё есть FK хотя бы
  // на 2 разные таблицы — типичный признак junction/pivot-таблицы.
  const fkTargetsByTable = new Map<string, Set<string>>();
  for (const fk of fks) {
    const key = `${fk.source_schema}.${fk.source_table}`;
    if (!fkTargetsByTable.has(key)) fkTargetsByTable.set(key, new Set());
    fkTargetsByTable.get(key)!.add(`${fk.target_schema}.${fk.target_table}`);
  }

  const perRow = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const boxes: Box[] = [];
  let x = MARGIN;
  let y = MARGIN;
  let col = 0;
  let rowMaxHeight = 0;

  tables.forEach((t) => {
    const key = `${t.schema}.${t.name}`;
    const cols = colsByTable.get(key) ?? [];
    const visibleCount = Math.min(cols.length, MAX_VISIBLE_COLS);
    const extra = cols.length > MAX_VISIBLE_COLS ? 1 : 0;
    const height = HEADER_H + Math.max(1, visibleCount + extra) * ROW_H + 10;
    const targets = fkTargetsByTable.get(key);
    const isJunction = !!targets && targets.size >= 2;

    boxes.push({ key, schema: t.schema, name: t.name, columns: cols, x, y, width: BOX_WIDTH, height, isJunction });

    rowMaxHeight = Math.max(rowMaxHeight, height);
    col++;
    x += BOX_WIDTH + GAP_X;
    if (col >= perRow) {
      col = 0;
      x = MARGIN;
      y += rowMaxHeight + GAP_Y;
      rowMaxHeight = 0;
    }
  });

  return boxes;
}

/** Y-координата конкретной строки колонки внутри блока (или центр блока, если колонка скрыта под "+N ещё"). */
function columnRowY(box: Box, columnName: string): number {
  const idx = box.columns.findIndex((c) => c.name === columnName);
  if (idx === -1 || idx >= MAX_VISIBLE_COLS) {
    return box.y + box.height / 2;
  }
  return box.y + HEADER_H + idx * ROW_H + ROW_H / 2;
}

export function SchemaDiagram({
  tables,
  columns,
  foreignKeys,
  loading,
  connectionId,
}: {
  tables: TableInfo[];
  columns: SchemaColumn[];
  foreignKeys: ForeignKeyRef[];
  loading: boolean;
  connectionId: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const positionsKey = `schema-positions:${connectionId}`;
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const raw = localStorage.getItem(positionsKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(positionsKey, JSON.stringify(positions));
    } catch {
      // Хранилище недоступно — просто не сохраняем расположение между сессиями.
    }
  }, [positions, positionsKey]);

  const layoutBoxes = useMemo(() => layout(tables, columns, foreignKeys), [tables, columns, foreignKeys]);
  const boxes = useMemo(
    () =>
      layoutBoxes.map((b) => {
        const override = positions[b.key];
        return override ? { ...b, x: override.x, y: override.y } : b;
      }),
    [layoutBoxes, positions]
  );
  const boxByKey = useMemo(() => new Map(boxes.map((b) => [b.key, b])), [boxes]);

  function handleBoxDragStart(e: React.MouseEvent, box: Box) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = box.x;
    const origY = box.y;

    const onMove = (moveEvent: MouseEvent) => {
      const z = zoomRef.current;
      const dx = (moveEvent.clientX - startX) / z;
      const dy = (moveEvent.clientY - startY) / z;
      setPositions((prev) => ({
        ...prev,
        [box.key]: { x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) },
      }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }

  // Колонки, участвующие в связях — чтобы пометить их значком даже если линию
  // трудно проследить визуально (например, таблицы далеко друг от друга).
  const fkColumnKeys = useMemo(() => {
    const s = new Set<string>();
    for (const fk of foreignKeys) s.add(`${fk.source_schema}.${fk.source_table}.${fk.source_column}`);
    return s;
  }, [foreignKeys]);
  const referencedColumnKeys = useMemo(() => {
    const s = new Set<string>();
    for (const fk of foreignKeys) s.add(`${fk.target_schema}.${fk.target_table}.${fk.target_column}`);
    return s;
  }, [foreignKeys]);

  const bounds = useMemo(() => {
    let maxX = 400;
    let maxY = 300;
    for (const b of boxes) {
      maxX = Math.max(maxX, b.x + b.width + MARGIN);
      maxY = Math.max(maxY, b.y + b.height + MARGIN);
    }
    return { width: maxX, height: maxY };
  }, [boxes]);

  if (loading) {
    return <div className="results-status">Загрузка схемы…</div>;
  }

  if (tables.length === 0) {
    return (
      <div className="results-status">
        В этой базе не найдено пользовательских таблиц для построения схемы.
      </div>
    );
  }

  return (
    <div className="schema-diagram-wrap">
      <div className="schema-diagram-toolbar">
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
          −
        </button>
        <span className="schema-zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
          +
        </button>
        <button className="icon-btn" onClick={() => setZoom(1)}>
          Сбросить зум
        </button>
        {Object.keys(positions).length > 0 && (
          <button className="icon-btn" onClick={() => setPositions({})}>
            Авторасположение
          </button>
        )}
        <div className="schema-legend">
          <span className="schema-legend-fk">🔗 внешний ключ</span>
          <span className="schema-legend-pk">🔑 на неё ссылаются</span>
          <span className="schema-legend-junction">M:N — промежуточная таблица</span>
        </div>
      </div>

      <div className="schema-diagram-scroll">
        <div
          className="schema-diagram-canvas"
          style={{
            width: bounds.width * zoom,
            height: bounds.height * zoom,
          }}
        >
          <div
            style={{
              width: bounds.width,
              height: bounds.height,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              position: "relative",
            }}
          >
            <svg
              width={bounds.width}
              height={bounds.height}
              className="schema-svg"
              style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
            >
              {foreignKeys.map((fk, i) => {
                const source = boxByKey.get(`${fk.source_schema}.${fk.source_table}`);
                const target = boxByKey.get(`${fk.target_schema}.${fk.target_table}`);
                if (!source || !target) return null;

                const sourceCenterX = source.x + source.width / 2;
                const targetCenterX = target.x + target.width / 2;
                // Крепим линию к КОНКРЕТНОЙ строке колонки-источника/цели, а не к центру блока —
                // так видно, от какой именно ячейки идёт связь.
                const p1 = {
                  x: targetCenterX > sourceCenterX ? source.x + source.width : source.x,
                  y: columnRowY(source, fk.source_column),
                };
                const p2 = {
                  x: sourceCenterX > targetCenterX ? target.x + target.width : target.x,
                  y: columnRowY(target, fk.target_column),
                };
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const dimmed =
                  hoveredTable && hoveredTable !== source.key && hoveredTable !== target.key;
                const sourceSymbol = fk.source_is_unique ? "1" : "N";

                return (
                  <g key={fk.constraint_name + i} className={dimmed ? "fk-edge dimmed" : "fk-edge"}>
                    <path
                      d={`M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`}
                      className="fk-line"
                      fill="none"
                    />
                    <circle cx={p1.x} cy={p1.y} r={3} className="fk-endpoint" />
                    <circle cx={p2.x} cy={p2.y} r={3} className="fk-endpoint" />
                    <text x={p1.x + (midX - p1.x) * 0.3} y={p1.y - 5} className="fk-label">
                      {sourceSymbol}
                    </text>
                    <text x={p2.x + (midX - p2.x) * 0.3} y={p2.y - 5} className="fk-label">
                      1
                    </text>
                  </g>
                );
              })}
            </svg>

            {boxes.map((b) => (
              <div
                key={b.key}
                className={"schema-box" + (hoveredTable === b.key ? " hovered" : "")}
                style={{ left: b.x, top: b.y, width: b.width }}
                onMouseEnter={() => setHoveredTable(b.key)}
                onMouseLeave={() => setHoveredTable(null)}
              >
                <div
                  className="schema-box-header"
                  onMouseDown={(e) => handleBoxDragStart(e, b)}
                  title="Перетащите, чтобы переместить таблицу"
                >
                  <span>{b.name}</span>
                  {b.isJunction && <span className="schema-box-badge">M:N</span>}
                </div>
                <div className="schema-box-body">
                  {b.columns.slice(0, MAX_VISIBLE_COLS).map((c) => {
                    const fullKey = `${b.schema}.${b.name}.${c.name}`;
                    const isFk = fkColumnKeys.has(fullKey);
                    const isReferenced = referencedColumnKeys.has(fullKey);
                    return (
                      <div key={c.name} className="schema-box-col">
                        <span className="schema-col-left">
                          {isReferenced && <span className="schema-col-badge pk" title="На эту колонку ссылаются">🔑</span>}
                          {isFk && <span className="schema-col-badge fk" title="Внешний ключ">🔗</span>}
                          <span className="schema-col-name">{c.name}</span>
                        </span>
                        <span className="schema-col-type" title={c.data_type}>
                          <ColumnTypeIcon type={c.data_type} />
                        </span>
                      </div>
                    );
                  })}
                  {b.columns.length > MAX_VISIBLE_COLS && (
                    <div className="schema-box-col schema-box-more">
                      +{b.columns.length - MAX_VISIBLE_COLS} ещё
                    </div>
                  )}
                  {b.columns.length === 0 && (
                    <div className="schema-box-col schema-box-more">нет колонок</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
