import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ConnectionConfig,
  ForeignKeyRef,
  QueryResult,
  SchemaColumn,
  TableInfo,
} from "./types";

export const api = {
  listConnections: () => invoke<ConnectionConfig[]>("list_connections"),

  saveConnection: (config: ConnectionConfig, password: string) =>
    invoke<void>("save_connection", { config, password }),

  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),

  testConnection: (config: ConnectionConfig, password: string) =>
    invoke<void>("test_connection", { config, password }),

  getConnectionPassword: (id: string) => invoke<string>("get_connection_password", { id }),

  openConnection: (id: string) => invoke<void>("open_connection", { id }),

  closeConnection: (id: string) => invoke<void>("close_connection", { id }),

  listTables: (connectionId: string) =>
    invoke<TableInfo[]>("list_tables", { connectionId }),

  getTableColumns: (connectionId: string, schema: string, table: string) =>
    invoke<ColumnInfo[]>("get_table_columns", {
      connectionId,
      schema,
      table,
    }),

  getTableRows: (
    connectionId: string,
    schema: string,
    table: string,
    limit: number,
    offset: number
  ) =>
    invoke<QueryResult>("get_table_rows", {
      connectionId,
      schema,
      table,
      limit,
      offset,
    }),

  listAllColumns: (connectionId: string) =>
    invoke<SchemaColumn[]>("list_all_columns", { connectionId }),

  listForeignKeys: (connectionId: string) =>
    invoke<ForeignKeyRef[]>("list_foreign_keys", { connectionId }),

  explainQuery: (connectionId: string, sql: string, analyze: boolean) =>
    invoke<unknown>("explain_query", { connectionId, sql, analyze }),

  runQuery: (connectionId: string, sql: string) =>
    invoke<QueryResult>("run_query", { connectionId, sql }),
};
