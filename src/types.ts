export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  dbname: string;
  user: string;
  ssl_mode: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: string; // 'table' | 'view'
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
}

export interface QueryResult {
  columns: string[];
  column_types: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  duration_ms: number;
  error: string | null;
  command_tag: string | null;
  table_name: string | null;
}

export interface SchemaColumn {
  schema: string;
  table: string;
  name: string;
  data_type: string;
}

export interface ForeignKeyRef {
  constraint_name: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  source_is_unique: boolean;
}

export type TabView = "tables" | "query" | "schema";

export type TableSubView = "data" | "structure";

export interface AppTab {
  id: string;
  connectionId: string;
  connectionName: string;
  title: string;
  view: TabView;
  selectedTable: TableInfo | null;
  tableSubView: TableSubView;
  sql: string;
  lastResult: QueryResult | null;
  isRunning: boolean;
  connected: boolean;
  historyOpen: boolean;
  analyzeMode: boolean;
  explainAnalyze: boolean;
  explainPlan: unknown | null;
  explainError: string | null;
}

export type PendingChange =
  | { kind: "insert"; values: Record<string, unknown> }
  | { kind: "update"; pk: Record<string, unknown>; values: Record<string, unknown> }
  | { kind: "delete"; pk: Record<string, unknown> };

export type Theme = "light" | "dark";
