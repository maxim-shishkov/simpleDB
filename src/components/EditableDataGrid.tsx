import { useEffect, useMemo, useState } from "react";
import type { ColumnInfo, PendingChange, QueryResult } from "../types";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";

interface GridRow {
  key: string;
  isNew: boolean;
  deleted: boolean;
  original: Record<string, unknown> | null;
  values: Record<string, unknown>;
}

function formatForInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function rowIsDirty(row: GridRow, columns: string[]): boolean {
  if (!row.original) return false;
  return columns.some((c) => !valuesEqual(row.original![c], row.values[c]));
}

function initRows(result: QueryResult | null): GridRow[] {
  if (!result) return [];
  return result.rows.map((r) => ({
    key: crypto.randomUUID(),
    isNew: false,
    deleted: false,
    original: r,
    values: { ...r },
  }));
}

// Ставит курсор в конец содержимого редактируемой ячейки и выделяет весь текст,
// чтобы можно было сразу начать печатать поверх старого значения.
function focusAndSelectCell(el: HTMLTableCellElement | null) {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function EditableDataGrid({
  schema,
  table,
  columns,
  result,
  loading,
  saving,
  onSubmit,
}: {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  result: QueryResult | null;
  loading: boolean;
  saving: boolean;
  onSubmit: (changes: PendingChange[]) => Promise<boolean>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [rows, setRows] = useState<GridRow[]>(() => initRows(result));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowKey: string; col: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Данные перезагрузились (первый показ таблицы, обновление после сохранения,
  // и т.п.) — сбрасываем локальные несохранённые изменения на свежие с сервера.
  useEffect(() => {
    setRows(initRows(result));
    setSelected(new Set());
    setEditingCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const pkColumns = useMemo(() => columns.filter((c) => c.is_primary_key).map((c) => c.name), [columns]);
  const hasPk = pkColumns.length > 0;
  const displayColumns = result?.columns ?? [];

  function pkOf(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(pkColumns.map((c) => [c, row[c]]));
  }

  const changes = useMemo<PendingChange[]>(() => {
    const out: PendingChange[] = [];
    for (const row of rows) {
      if (row.isNew) {
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row.values)) {
          if (v !== undefined && v !== "" && v !== null) values[k] = v;
        }
        out.push({ kind: "insert", values });
      } else if (row.deleted) {
        out.push({ kind: "delete", pk: pkOf(row.original!) });
      } else if (rowIsDirty(row, displayColumns)) {
        const dirty: Record<string, unknown> = {};
        for (const c of displayColumns) {
          if (!valuesEqual(row.original![c], row.values[c])) dirty[c] = row.values[c];
        }
        out.push({ kind: "update", pk: pkOf(row.original!), values: dirty });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, displayColumns, pkColumns]);

  function toggleEditMode() {
    if (editMode && changes.length > 0) {
      setConfirmDiscard(true);
      return;
    }
    setEditMode((v) => !v);
    setEditingCell(null);
  }

  function confirmDiscardChanges() {
    setRows(initRows(result));
    setSelected(new Set());
    setEditMode(false);
    setConfirmDiscard(false);
  }

  function addRow() {
    const blank: Record<string, unknown> = {};
    for (const c of displayColumns) blank[c] = "";
    setRows((prev) => [
      ...prev,
      { key: crypto.randomUUID(), isNew: true, deleted: false, original: null, values: blank },
    ]);
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function deleteSelected() {
    setRows((prev) =>
      prev
        .filter((r) => !(selected.has(r.key) && r.isNew)) // новые строки просто убираем
        .map((r) => (selected.has(r.key) && !r.isNew ? { ...r, deleted: !r.deleted } : r))
    );
    setSelected(new Set());
  }

  function revert() {
    setRows(initRows(result));
    setSelected(new Set());
  }

  function commitCellEdit(rowKey: string, col: string, raw: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === rowKey ? { ...r, values: { ...r.values, [col]: raw === "" ? null : raw } } : r))
    );
    setEditingCell(null);
  }

  async function handleSubmit() {
    if (changes.length === 0) return;
    const ok = await onSubmit(changes);
    if (ok) setSelected(new Set());
  }

  if (loading) {
    return <div className="results-status">Загрузка данных…</div>;
  }

  if (!result) {
    return <div className="results-status">Выберите таблицу слева.</div>;
  }

  if (result.error) {
    return <div className="results-status error">{result.error}</div>;
  }

  return (
    <div className="results-wrap">
      <div className={"edit-toolbar" + (editMode ? " edit-toolbar-active" : "")}>
        <button
          className={"btn edit-toggle-btn" + (editMode ? " active" : "")}
          onClick={toggleEditMode}
          disabled={!hasPk}
          title={
            hasPk
              ? "Включить/выключить редактирование"
              : "У таблицы нет первичного ключа — редактирование недоступно"
          }
        >
          ✏️
        </button>
        <div className="toolbar-divider" />
        <button className="icon-btn-lg icon-btn-add" onClick={addRow} disabled={!editMode} title="Вставить строку">
          ➕
        </button>
        <button
          className="icon-btn-lg icon-btn-delete"
          onClick={deleteSelected}
          disabled={!editMode || selected.size === 0}
          title="Удалить выбранные строки"
        >
          🗑
        </button>
        <div className="toolbar-divider" />
        <button
          className="icon-btn-lg icon-btn-revert"
          onClick={revert}
          disabled={!editMode || changes.length === 0}
          title="Отменить все изменения"
        >
          ↩
        </button>
        <button
          className="btn icon-btn-lg submit-btn"
          onClick={handleSubmit}
          disabled={!editMode || changes.length === 0 || saving}
          title={saving ? "Сохранение…" : `Отправить изменения${changes.length ? ` (${changes.length})` : ""}`}
        >
          {saving ? "…" : "✔"}
          {!saving && changes.length > 0 && <span className="submit-badge">{changes.length}</span>}
        </button>
      </div>

      <div className="results-scroll">
        {displayColumns.length > 0 && (
          <table className="grid editable-grid">
            <thead>
              <tr>
                {editMode && <th className="row-checkbox-cell" />}
                {displayColumns.map((c, i) => (
                  <th key={c}>
                    <div className="column-header">
                      <span className="column-icon">
                        <ColumnTypeIcon type={result.column_types[i] ?? ""} />
                      </span>
                      <span className="col-name">{c}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={displayColumns.length + (editMode ? 1 : 0)} className="no-rows">
                    Строк нет
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const rowClass = row.deleted
                  ? "row-deleted"
                  : row.isNew
                    ? "row-new"
                    : rowIsDirty(row, displayColumns)
                      ? "row-modified"
                      : "";
                return (
                  <tr key={row.key} className={rowClass || undefined}>
                    {editMode && (
                      <td className="row-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selected.has(row.key)}
                          onChange={() => toggleSelect(row.key)}
                        />
                      </td>
                    )}
                    {displayColumns.map((c) => {
                      const isEditing = editMode && editingCell?.rowKey === row.key && editingCell.col === c;
                      const v = row.values[c];
                      const cellDirty = row.original && !valuesEqual(row.original[c], v);
                      return (
                        <td
                          key={c}
                          ref={isEditing ? focusAndSelectCell : undefined}
                          className={(cellDirty ? "cell-dirty " : "") + (editMode && !row.deleted ? "cell-editable" : "")}
                          contentEditable={isEditing}
                          suppressContentEditableWarning
                          onClick={() => {
                            if (editMode && !row.deleted && !isEditing) {
                              setEditingCell({ rowKey: row.key, col: c });
                            }
                          }}
                          onBlur={(e) => {
                            if (isEditing) commitCellEdit(row.key, c, e.currentTarget.textContent ?? "");
                          }}
                          onKeyDown={(e) => {
                            if (!isEditing) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLElement).blur();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingCell(null);
                            }
                          }}
                        >
                          {isEditing
                            ? formatForInput(v)
                            : v === null || v === undefined
                              ? <span className="null-value">NULL</span>
                              : formatForInput(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="results-status">
        {result.table_name ? `Таблица: ${result.table_name} · ` : ""}
        {result.row_count} строк(и) · {result.duration_ms} мс
        {editMode && !hasPk && " · редактирование недоступно (нет первичного ключа)"}
        {editMode && changes.length > 0 && ` · несохранённых изменений: ${changes.length}`}
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Отменить изменения?"
          message="Есть несохранённые изменения. Выключить редактирование и отменить их?"
          confirmLabel="Отменить изменения"
          onConfirm={confirmDiscardChanges}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
