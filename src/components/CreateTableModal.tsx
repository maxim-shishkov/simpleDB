import { useState } from "react";
import { COMMON_PG_TYPES } from "../pgTypes";
import type { NewColumnDef } from "../sqlBuilders";

function blankColumn(): NewColumnDef & { key: string } {
  return { key: crypto.randomUUID(), name: "", dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: "" };
}

export function CreateTableModal({
  schema,
  onClose,
  onCreate,
}: {
  schema: string;
  onClose: () => void;
  onCreate: (tableName: string, columns: NewColumnDef[]) => Promise<boolean>;
}) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<(NewColumnDef & { key: string })[]>(() => [
    { ...blankColumn(), name: "id", dataType: "serial", nullable: false, isPrimaryKey: true },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateColumn(key: string, patch: Partial<NewColumnDef>) {
    setColumns((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addColumn() {
    setColumns((prev) => [...prev, blankColumn()]);
  }

  function removeColumn(key: string) {
    setColumns((prev) => prev.filter((c) => c.key !== key));
  }

  async function handleCreate() {
    setError(null);
    if (!tableName.trim()) {
      setError("Укажите название таблицы");
      return;
    }
    if (columns.filter((c) => c.name.trim()).length === 0) {
      setError("Добавьте хотя бы одну колонку");
      return;
    }
    setCreating(true);
    const ok = await onCreate(tableName.trim(), columns);
    setCreating(false);
    if (!ok) setError("Не удалось создать таблицу — подробности в баннере ошибки сверху");
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <h2>Новая таблица</h2>

        <div className="field">
          <label>Название таблицы (схема: {schema})</label>
          <input type="text" value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="orders" />
        </div>

        <div className="new-table-columns">
          <div className="new-table-columns-header">
            <span>Имя</span>
            <span>Тип</span>
            <span title="Отмечено — допускает NULL (пусто). Снято — NOT NULL, значение обязательно.">
              Nullable
            </span>
            <span>PK</span>
            <span title="Подставится автоматически, если колонку не заполнить при вставке строки. Например: 0, 'active', now().">
              По умолчанию
            </span>
            <span />
          </div>
          {columns.map((c) => (
            <div className="new-table-column-row" key={c.key}>
              <input
                type="text"
                value={c.name}
                placeholder="имя_колонки"
                onChange={(e) => updateColumn(c.key, { name: e.target.value })}
              />
              <input
                type="text"
                value={c.dataType}
                list="pg-types-list"
                placeholder="text"
                onChange={(e) => updateColumn(c.key, { dataType: e.target.value })}
              />
              <input
                type="checkbox"
                checked={c.nullable}
                title="Разрешить NULL"
                onChange={(e) => updateColumn(c.key, { nullable: e.target.checked })}
              />
              <input
                type="checkbox"
                checked={c.isPrimaryKey}
                title="Первичный ключ"
                onChange={(e) =>
                  updateColumn(c.key, { isPrimaryKey: e.target.checked, nullable: e.target.checked ? false : c.nullable })
                }
              />
              <input
                type="text"
                value={c.defaultValue}
                placeholder="(необязательно)"
                onChange={(e) => updateColumn(c.key, { defaultValue: e.target.value })}
              />
              <button className="icon-btn" onClick={() => removeColumn(c.key)} title="Убрать колонку">
                ✕
              </button>
            </div>
          ))}
          <datalist id="pg-types-list">
            {COMMON_PG_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <button className="btn add-column-btn" onClick={addColumn}>
          + Колонка
        </button>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={handleCreate} disabled={creating}>
            {creating ? "Создание…" : "Создать таблицу"}
          </button>
        </div>
      </div>
    </div>
  );
}
