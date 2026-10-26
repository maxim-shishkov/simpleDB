import type { ColumnInfo, PendingChange } from "./types";

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Пытается разобрать значение как JS-массив (для array-колонок) — либо оно
 * уже массив (JSON-значение из результата запроса), либо строка вида [1,2,3]. */
function coerceArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // не JSON — просто одно значение? Разделим по запятой как fallback.
      return trimmed.split(",").map((s) => s.trim());
    }
  }
  return null;
}

function arrayElementLiteral(v: unknown): string {
  if (v === null || v === undefined || v === "") return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Внутри '{...}'-литерала массива каждый текстовый элемент в кавычках,
  // с экранированием кавычек и обратных слэшей.
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Конвертирует отредактированное значение ячейки в SQL-литерал, ориентируясь
 * на тип колонки Postgres. Для большинства типов (date/timestamp/uuid/numeric/
 * json/enum и т.п.) достаточно строкового литерала — Postgres сам приведёт его
 * к нужному типу при INSERT/UPDATE. Специальный разбор нужен только числам,
 * булевым значениям и массивам. */
export function valueToSqlLiteral(value: unknown, dataType: string): string {
  if (value === null || value === undefined || value === "") return "NULL";

  const t = dataType.toLowerCase();

  if (t.endsWith("[]")) {
    const arr = coerceArray(value);
    if (arr === null) return "NULL";
    return quoteStringLiteral(`{${arr.map(arrayElementLiteral).join(",")}}`);
  }

  if (t === "bool" || t === "boolean") {
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    const s = String(value).trim().toLowerCase();
    if (["true", "t", "1", "yes"].includes(s)) return "TRUE";
    if (["false", "f", "0", "no"].includes(s)) return "FALSE";
    return "NULL";
  }

  const isNumeric =
    t.includes("int") ||
    t.includes("serial") ||
    t.includes("numeric") ||
    t.includes("decimal") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("real") ||
    t === "money";
  if (isNumeric) {
    const s = String(value).trim().replace(/[^0-9eE+\-.]/g, "");
    return s === "" ? "NULL" : s;
  }

  // text/varchar/date/timestamp/uuid/json/jsonb/enum/geometry и всё остальное —
  // как строковый литерал, Postgres приведёт сам.
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return quoteStringLiteral(s);
}

function typeOfColumn(columns: ColumnInfo[], name: string): string {
  return columns.find((c) => c.name === name)?.data_type ?? "text";
}

function buildWhere(pk: Record<string, unknown>, columns: ColumnInfo[]): string {
  const parts = Object.entries(pk).map(([col, val]) =>
    val === null || val === undefined
      ? `${quoteIdent(col)} IS NULL`
      : `${quoteIdent(col)} = ${valueToSqlLiteral(val, typeOfColumn(columns, col))}`
  );
  return parts.join(" AND ");
}

/** Строит одно SQL-выражение для одного изменения (insert/update/delete). */
export function buildChangeSql(
  schema: string,
  table: string,
  change: PendingChange,
  columns: ColumnInfo[]
): string {
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  if (change.kind === "insert") {
    const cols = Object.keys(change.values);
    if (cols.length === 0) {
      return `INSERT INTO ${qualified} DEFAULT VALUES`;
    }
    const colSql = cols.map(quoteIdent).join(", ");
    const valSql = cols.map((c) => valueToSqlLiteral(change.values[c], typeOfColumn(columns, c))).join(", ");
    return `INSERT INTO ${qualified} (${colSql}) VALUES (${valSql})`;
  }

  if (change.kind === "update") {
    const setSql = Object.entries(change.values)
      .map(([col, val]) => `${quoteIdent(col)} = ${valueToSqlLiteral(val, typeOfColumn(columns, col))}`)
      .join(", ");
    return `UPDATE ${qualified} SET ${setSql} WHERE ${buildWhere(change.pk, columns)}`;
  }

  return `DELETE FROM ${qualified} WHERE ${buildWhere(change.pk, columns)}`;
}

export interface NewColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string;
}

/** CREATE TABLE из списка колонок (для нового первичного ключа собирает
 * составной PRIMARY KEY, если отмечено несколько колонок). */
export function buildCreateTableSql(schema: string, table: string, columns: NewColumnDef[]): string {
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const colDefs = columns
    .filter((c) => c.name.trim() !== "")
    .map((c) => {
      let def = `${quoteIdent(c.name.trim())} ${c.dataType.trim() || "text"}`;
      if (!c.nullable) def += " NOT NULL";
      if (c.defaultValue.trim()) def += ` DEFAULT ${c.defaultValue.trim()}`;
      return def;
    });
  const pkCols = columns.filter((c) => c.isPrimaryKey && c.name.trim() !== "").map((c) => quoteIdent(c.name.trim()));
  if (pkCols.length > 0) colDefs.push(`PRIMARY KEY (${pkCols.join(", ")})`);
  return `CREATE TABLE ${qualified} (\n  ${colDefs.join(",\n  ")}\n)`;
}

export function buildDropTableSql(schema: string, table: string, cascade: boolean): string {
  return `DROP TABLE ${quoteIdent(schema)}.${quoteIdent(table)}${cascade ? " CASCADE" : ""}`;
}

/** Строка редактора структуры — то же самое, что колонка в БД, плюс
 * "исходное" состояние для определения, что именно изменилось. */
export interface StructureRow {
  key: string;
  isNew: boolean;
  deleted: boolean;
  originalName: string | null;
  name: string;
  dataType: string;
  originalDataType: string;
  nullable: boolean;
  originalNullable: boolean;
  defaultValue: string;
  originalDefaultValue: string;
  isPrimaryKey: boolean;
}

/** Строит список ALTER TABLE ... для всех изменений колонок разом (порядок:
 * сначала удаления, потом добавления, потом переименования/тип/null/default —
 * так переименование новой колонки не пытается сослаться на старое имя). */
export function buildAlterColumnStatements(schema: string, table: string, rows: StructureRow[]): string[] {
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const stmts: string[] = [];

  for (const r of rows) {
    if (!r.isNew && r.deleted) {
      stmts.push(`ALTER TABLE ${qualified} DROP COLUMN ${quoteIdent(r.originalName!)}`);
    }
  }

  for (const r of rows) {
    if (r.isNew && !r.deleted && r.name.trim() !== "") {
      let def = `${quoteIdent(r.name.trim())} ${r.dataType.trim() || "text"}`;
      if (!r.nullable) def += " NOT NULL";
      if (r.defaultValue.trim()) def += ` DEFAULT ${r.defaultValue.trim()}`;
      stmts.push(`ALTER TABLE ${qualified} ADD COLUMN ${def}`);
    }
  }

  for (const r of rows) {
    if (r.isNew || r.deleted) continue;
    const renamed = r.name.trim() !== r.originalName;
    const typeChanged = r.dataType.trim() !== r.originalDataType;
    const nullableChanged = r.nullable !== r.originalNullable;
    const defaultChanged = r.defaultValue.trim() !== r.originalDefaultValue.trim();

    if (typeChanged) {
      // Изменение типа делаем ДО переименования — ссылаемся на исходное имя,
      // так порядок операций не важен для RENAME, идущего следом.
      stmts.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(r.originalName!)} TYPE ${r.dataType.trim()} USING ${quoteIdent(
          r.originalName!
        )}::${r.dataType.trim()}`
      );
    }
    if (nullableChanged) {
      stmts.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(r.originalName!)} ${r.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`
      );
    }
    if (defaultChanged) {
      stmts.push(
        r.defaultValue.trim()
          ? `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(r.originalName!)} SET DEFAULT ${r.defaultValue.trim()}`
          : `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(r.originalName!)} DROP DEFAULT`
      );
    }
    if (renamed) {
      stmts.push(`ALTER TABLE ${qualified} RENAME COLUMN ${quoteIdent(r.originalName!)} TO ${quoteIdent(r.name.trim())}`);
    }
  }

  return stmts;
}
