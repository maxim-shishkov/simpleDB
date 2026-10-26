import { useEffect, useMemo, useState } from "react";
import type { ColumnInfo } from "../types";
import { buildAlterColumnStatements, type StructureRow } from "../sqlBuilders";
import { COMMON_PG_TYPES } from "../pgTypes";
import { ConfirmDialog } from "./ConfirmDialog";

function initRows(columns: ColumnInfo[]): StructureRow[] {
  return columns.map((c) => ({
    key: crypto.randomUUID(),
    isNew: false,
    deleted: false,
    originalName: c.name,
    name: c.name,
    dataType: c.data_type,
    originalDataType: c.data_type,
    nullable: c.is_nullable,
    originalNullable: c.is_nullable,
    defaultValue: "",
    originalDefaultValue: "",
    isPrimaryKey: c.is_primary_key,
  }));
}

function rowChanged(r: StructureRow): boolean {
  if (r.isNew || r.deleted) return true;
  return (
    r.name.trim() !== r.originalName ||
    r.dataType.trim() !== r.originalDataType ||
    r.nullable !== r.originalNullable ||
    r.defaultValue.trim() !== r.originalDefaultValue.trim()
  );
}

export function TableStructureEditor({
  schema,
  table,
  columns,
  loading,
  saving,
  onSubmit,
  onDropTable,
}: {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  loading: boolean;
  saving: boolean;
  onSubmit: (statements: string[]) => Promise<boolean>;
  onDropTable: () => void;
}) {
  const [rows, setRows] = useState<StructureRow[]>(() => initRows(columns));
  const [confirmRevert, setConfirmRevert] = useState(false);

  useEffect(() => {
    setRows(initRows(columns));
  }, [columns]);

  const statements = useMemo(() => buildAlterColumnStatements(schema, table, rows), [schema, table, rows]);
  const changedCount = rows.filter(rowChanged).length;

  function addColumn() {
    setRows((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        isNew: true,
        deleted: false,
        originalName: null,
        name: "",
        dataType: "text",
        originalDataType: "text",
        nullable: true,
        originalNullable: true,
        defaultValue: "",
        originalDefaultValue: "",
        isPrimaryKey: false,
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.key !== key) return [r];
        if (r.isNew) return []; // новая колонка — просто убираем локально
        return [{ ...r, deleted: !r.deleted }];
      })
    );
  }

  function patchRow(key: string, patch: Partial<StructureRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function revert() {
    setRows(initRows(columns));
    setConfirmRevert(false);
  }

  async function handleSubmit() {
    if (statements.length === 0) return;
    await onSubmit(statements);
  }

  if (loading) {
    return <div className="results-status">Загрузка структуры…</div>;
  }

  return (
    <div className="results-wrap">
      <div className="edit-toolbar edit-toolbar-active">
        <button className="icon-btn-lg icon-btn-add" onClick={addColumn} title="Добавить колонку">
          ➕
        </button>
        <div className="toolbar-divider" />
        <button
          className="icon-btn-lg icon-btn-revert"
          onClick={() => (changedCount > 0 ? setConfirmRevert(true) : undefined)}
          disabled={changedCount === 0}
          title="Отменить все изменения"
        >
          ↩
        </button>
        <button
          className="btn icon-btn-lg submit-btn"
          onClick={handleSubmit}
          disabled={statements.length === 0 || saving}
          title={saving ? "Применение…" : `Применить изменения структуры${statements.length ? ` (${statements.length})` : ""}`}
        >
          {saving ? "…" : "✔"}
          {!saving && statements.length > 0 && <span className="submit-badge">{statements.length}</span>}
        </button>
        <div className="toolbar-divider" />
        <button className="icon-btn-lg icon-btn-delete" onClick={onDropTable} title="Удалить таблицу целиком">
          🗑
        </button>
        <span className="edit-toolbar-hint">
          Первичный ключ меняется отдельным SQL-запросом — здесь только просмотр (🔑)
        </span>
      </div>

      <div className="results-scroll">
        <table className="grid structure-grid">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Тип</th>
              <th title="Отмечено — колонка может быть пустой (NULL). Снято — NOT NULL, значение обязательно при вставке строки.">
                Nullable
              </th>
              <th title="Значение, которое Postgres подставит сам, если при вставке строки колонку не заполнили. Например: 0, 'active', now(), gen_random_uuid().">
                По умолчанию
              </th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={r.deleted ? "row-deleted" : r.isNew ? "row-new" : rowChanged(r) ? "row-modified" : ""}
              >
                <td>
                  <input
                    className="structure-input"
                    type="text"
                    value={r.name}
                    disabled={r.deleted}
                    onChange={(e) => patchRow(r.key, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="structure-input"
                    type="text"
                    value={r.dataType}
                    list="pg-types-list-structure"
                    disabled={r.deleted}
                    onChange={(e) => patchRow(r.key, { dataType: e.target.value })}
                  />
                </td>
                <td className="structure-checkbox-cell">
                  <input
                    type="checkbox"
                    checked={r.nullable}
                    disabled={r.deleted}
                    title="Отмечено — допускает NULL (пусто). Снято — NOT NULL, значение обязательно."
                    onChange={(e) => patchRow(r.key, { nullable: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    className="structure-input"
                    type="text"
                    value={r.defaultValue}
                    placeholder={r.isNew ? "(необязательно)" : "(без изменений)"}
                    title="Значение по умолчанию — подставляется автоматически, если колонку не заполнили при вставке строки. Например: 0, 'active', now()."
                    disabled={r.deleted}
                    onChange={(e) => patchRow(r.key, { defaultValue: e.target.value })}
                  />
                </td>
                <td className="structure-pk-cell">{r.isPrimaryKey && <span title="Первичный ключ">🔑</span>}</td>
                <td className="structure-checkbox-cell">
                  <button className="icon-btn" onClick={() => removeRow(r.key)} title={r.deleted ? "Вернуть колонку" : "Удалить колонку"}>
                    {r.deleted ? "↩" : "✕"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="pg-types-list-structure">
          {COMMON_PG_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <div className="results-status">
        Структура: {schema}.{table}
        {changedCount > 0 && ` · несохранённых изменений колонок: ${changedCount}`}
      </div>

      {confirmRevert && (
        <ConfirmDialog
          title="Отменить изменения структуры?"
          message="Все несохранённые изменения колонок будут отменены."
          confirmLabel="Отменить изменения"
          onConfirm={revert}
          onCancel={() => setConfirmRevert(false)}
        />
      )}
    </div>
  );
}
