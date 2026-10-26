import { useEffect, useState } from "react";
import { api } from "./api";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { ConnectionModal } from "./components/ConnectionModal";
import { TableList } from "./components/TableList";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import { EditableDataGrid } from "./components/EditableDataGrid";
import { CreateTableModal } from "./components/CreateTableModal";
import { TableStructureEditor } from "./components/TableStructureEditor";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorBanner } from "./components/ErrorBanner";
import { ResizeHandle } from "./components/ResizeHandle";
import { SchemaDiagram } from "./components/SchemaDiagram";
import { ExplainPlanView } from "./components/ExplainPlanView";
import { addHistoryEntry, clearHistory, getHistory, type HistoryEntry } from "./history";
import { useResizable } from "./hooks/useResizable";
import { buildChangeSql, buildCreateTableSql, buildDropTableSql, type NewColumnDef } from "./sqlBuilders";
import type {
  AppTab,
  ColumnInfo,
  ConnectionConfig,
  ForeignKeyRef,
  PendingChange,
  SchemaColumn,
  TableInfo,
  Theme,
} from "./types";

const PAGE_SIZE = 200;

function errorText(e: unknown): string {
  // Ошибки из Tauri invoke обычно приходят как строка (мы возвращаем Result<_, String>
  // на стороне Rust), но подстрахуемся и на другие форматы.
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

// Бэкенд оборачивает обрывы соединения (в отличие от обычных ошибок SQL —
// синтаксис, нарушение constraint и т.п.) в сообщение с этим префиксом
// (см. describe_pg_error в src-tauri/src/db.rs), плюс несколько типичных
// фраз ОС на случай, если ошибка придёт из другого места.
function isConnectionError(text: string): boolean {
  return (
    text.includes("Ошибка соединения") ||
    /connection (closed|refused|reset|terminated)/i.test(text) ||
    /os error/i.test(text) ||
    /timed? ?out/i.test(text)
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "light"
  );
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [tabs, setTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tablesByConn, setTablesByConn] = useState<Record<string, TableInfo[]>>({});
  const [tablesLoading, setTablesLoading] = useState<Record<string, boolean>>({});
  const [columnsByConn, setColumnsByConn] = useState<Record<string, SchemaColumn[]>>({});
  const [foreignKeysByConn, setForeignKeysByConn] = useState<Record<string, ForeignKeyRef[]>>({});
  const [historyByConn, setHistoryByConn] = useState<Record<string, HistoryEntry[]>>({});
  const [tableColumnsByKey, setTableColumnsByKey] = useState<Record<string, ColumnInfo[]>>({});
  const [savingChanges, setSavingChanges] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<ConnectionConfig | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<ConnectionConfig | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [analyzingTable, setAnalyzingTable] = useState<string | null>(null);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [pendingDropTable, setPendingDropTable] = useState<TableInfo | null>(null);
  const [dropCascade, setDropCascade] = useState(false);

  const sidebarResize = useResizable({
    initial: 260,
    min: 190,
    max: 480,
    direction: "horizontal",
    storageKey: "ui:sidebarWidth",
  });
  const tableTreeResize = useResizable({
    initial: 220,
    min: 150,
    max: 420,
    direction: "horizontal",
    storageKey: "ui:tableTreeWidth",
  });
  const editorResize = useResizable({
    initial: 160,
    min: 80,
    max: 520,
    direction: "vertical",
    storageKey: "ui:editorHeight",
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    refreshConnections();
  }, []);

  function reportError(prefix: string, e: unknown) {
    const text = `${prefix}: ${errorText(e)}`;
    console.error(text);
    setGlobalError(text);
  }

  async function refreshConnections() {
    try {
      const list = await api.listConnections();
      setConnections(list);
    } catch (e) {
      reportError("Не удалось загрузить список подключений", e);
    }
  }

  function updateTab(id: string, patch: Partial<AppTab>) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // Помечает ВСЕ вкладки этого подключения (за одним соединением на бэкенде
  // может стоять несколько открытых вкладок) как подключенные/отключенные.
  function markConnectionStatus(connectionId: string, connected: boolean) {
    setTabs((prev) =>
      prev.map((t) =>
        t.connectionId === connectionId && t.connected !== connected ? { ...t, connected } : t
      )
    );
  }

  // Общая обёртка: при успехе индикатор зеленеет, при ошибке соединения —
  // краснеет (обычные ошибки SQL вроде опечатки в запросе на индикатор не влияют).
  async function withConnectionStatus<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      markConnectionStatus(connectionId, true);
      return result;
    } catch (e) {
      if (isConnectionError(errorText(e))) {
        markConnectionStatus(connectionId, false);
      }
      throw e;
    }
  }

  function makeErrorResult(e: unknown) {
    return {
      columns: [],
      column_types: [],
      rows: [],
      row_count: 0,
      duration_ms: 0,
      error: errorText(e),
      command_tag: null,
      table_name: null,
    };
  }

  async function loadTables(connectionId: string) {
    setTablesLoading((prev) => ({ ...prev, [connectionId]: true }));
    try {
      const [tables, columns, foreignKeys] = await withConnectionStatus(connectionId, () =>
        Promise.all([
          api.listTables(connectionId),
          api.listAllColumns(connectionId),
          api.listForeignKeys(connectionId),
        ])
      );
      setTablesByConn((prev) => ({ ...prev, [connectionId]: tables }));
      setColumnsByConn((prev) => ({ ...prev, [connectionId]: columns }));
      setForeignKeysByConn((prev) => ({ ...prev, [connectionId]: foreignKeys }));
    } catch (e) {
      reportError("Не удалось получить список таблиц", e);
    } finally {
      setTablesLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }

  async function openConnectionInTab(conn: ConnectionConfig) {
    const tabId = crypto.randomUUID();
    const newTab: AppTab = {
      id: tabId,
      connectionId: conn.id,
      connectionName: conn.name,
      title: conn.name,
      view: "tables",
      selectedTable: null,
      tableSubView: "data",
      sql: "",
      lastResult: null,
      isRunning: false,
      connected: false,
      historyOpen: false,
      analyzeMode: false,
      explainAnalyze: false,
      explainPlan: null,
      explainError: null,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);

    if (!historyByConn[conn.id]) {
      setHistoryByConn((prev) => ({ ...prev, [conn.id]: getHistory(conn.id) }));
    }

    try {
      await withConnectionStatus(conn.id, () => api.openConnection(conn.id));
      updateTab(tabId, { connected: true });
      await loadTables(conn.id);
    } catch (e) {
      updateTab(tabId, { lastResult: makeErrorResult(e) });
      reportError("Не удалось подключиться к базе данных", e);
    }
  }

  async function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next.length ? next[next.length - 1].id : null);
      }
      return next;
    });
    if (tab) {
      const stillUsed = tabs.some((t) => t.id !== id && t.connectionId === tab.connectionId);
      if (!stillUsed) {
        try {
          await api.closeConnection(tab.connectionId);
        } catch (e) {
          console.warn("close_connection failed", e);
        }
      }
    }
  }

  async function selectTable(tab: AppTab, table: TableInfo) {
    updateTab(tab.id, { selectedTable: table, view: "tables", isRunning: true });
    const tableKey = `${tab.connectionId}:${table.schema}.${table.name}`;
    try {
      const [result, cols] = await withConnectionStatus(tab.connectionId, () =>
        Promise.all([
          api.getTableRows(tab.connectionId, table.schema, table.name, PAGE_SIZE, 0),
          api.getTableColumns(tab.connectionId, table.schema, table.name),
        ])
      );
      setTableColumnsByKey((prev) => ({ ...prev, [tableKey]: cols }));
      updateTab(tab.id, {
        lastResult: result,
        isRunning: false,
        title: table.name,
      });
    } catch (e) {
      updateTab(tab.id, {
        isRunning: false,
        lastResult: makeErrorResult(e),
      });
    }
  }

  // Выполняет список SQL-выражений одной транзакцией: BEGIN → все выражения по
  // очереди → COMMIT; при любой ошибке — ROLLBACK и пробрасывание ошибки дальше.
  async function runStatementsInTransaction(tab: AppTab, statements: string[]): Promise<void> {
    await withConnectionStatus(tab.connectionId, async () => {
      await api.runQuery(tab.connectionId, "BEGIN");
      try {
        for (const stmt of statements) {
          await api.runQuery(tab.connectionId, stmt);
        }
        await api.runQuery(tab.connectionId, "COMMIT");
      } catch (e) {
        try {
          await api.runQuery(tab.connectionId, "ROLLBACK");
        } catch {
          // соединение и так уже могло порваться — вторичная ошибка ROLLBACK не важна
        }
        throw e;
      }
    });
  }

  async function submitTableChanges(
    tab: AppTab,
    schema: string,
    table: string,
    changes: PendingChange[]
  ): Promise<boolean> {
    const tableKey = `${tab.connectionId}:${schema}.${table}`;
    const columns = tableColumnsByKey[tableKey] ?? [];
    setSavingChanges(true);
    try {
      const statements = changes.map((change) => buildChangeSql(schema, table, change, columns));
      await runStatementsInTransaction(tab, statements);
      // Перечитываем таблицу и её метаданные (PK/типы могли не измениться,
      // но строки — точно) со свежими данными с сервера.
      if (tab.selectedTable) await selectTable(tab, tab.selectedTable);
      return true;
    } catch (e) {
      reportError("Не удалось сохранить изменения", e);
      return false;
    } finally {
      setSavingChanges(false);
    }
  }

  async function submitStructureChanges(
    tab: AppTab,
    schema: string,
    table: string,
    statements: string[]
  ): Promise<boolean> {
    setSavingChanges(true);
    try {
      await runStatementsInTransaction(tab, statements);
      const tableKey = `${tab.connectionId}:${schema}.${table}`;
      const cols = await api.getTableColumns(tab.connectionId, schema, table);
      setTableColumnsByKey((prev) => ({ ...prev, [tableKey]: cols }));
      if (tab.selectedTable) await selectTable(tab, tab.selectedTable);
      await loadTables(tab.connectionId); // на случай переименования колонок — обновит и схему
      return true;
    } catch (e) {
      reportError("Не удалось изменить структуру таблицы", e);
      return false;
    } finally {
      setSavingChanges(false);
    }
  }

  async function createTable(tab: AppTab, schema: string, tableName: string, columns: NewColumnDef[]): Promise<boolean> {
    try {
      const sql = buildCreateTableSql(schema, tableName, columns);
      await withConnectionStatus(tab.connectionId, () => api.runQuery(tab.connectionId, sql));
      await loadTables(tab.connectionId);
      setCreateTableOpen(false);
      return true;
    } catch (e) {
      reportError("Не удалось создать таблицу", e);
      return false;
    }
  }

  function askDropTable(table: TableInfo) {
    setDropCascade(false);
    setPendingDropTable(table);
  }

  async function confirmDropTable() {
    if (!pendingDropTable || !activeTab) return;
    const table = pendingDropTable;
    setPendingDropTable(null);
    try {
      const sql = buildDropTableSql(table.schema, table.name, dropCascade);
      await withConnectionStatus(activeTab.connectionId, () => api.runQuery(activeTab.connectionId, sql));
      await loadTables(activeTab.connectionId);
      // Если удалённая таблица была где-то открыта — снимем выбор, чтобы не
      // показывать данные несуществующей таблицы.
      setTabs((prev) =>
        prev.map((t) =>
          t.connectionId === activeTab.connectionId &&
          t.selectedTable?.schema === table.schema &&
          t.selectedTable?.name === table.name
            ? { ...t, selectedTable: null, lastResult: null }
            : t
        )
      );
    } catch (e) {
      reportError(`Не удалось удалить таблицу "${table.name}"`, e);
    }
  }

  function setTableSubView(tab: AppTab, view: "data" | "structure") {
    updateTab(tab.id, { tableSubView: view });
  }

  async function runQuery(tab: AppTab) {
    updateTab(tab.id, { isRunning: true });
    try {
      const result = await withConnectionStatus(tab.connectionId, () =>
        api.runQuery(tab.connectionId, tab.sql)
      );
      updateTab(tab.id, { lastResult: result, isRunning: false });
      const list = addHistoryEntry(tab.connectionId, tab.sql, !result.error, result.duration_ms);
      setHistoryByConn((prev) => ({ ...prev, [tab.connectionId]: list }));
      // Если это была DDL-команда (CREATE/DROP/ALTER TABLE и т.п.) — обновим список таблиц,
      // чтобы новые/удалённые таблицы сразу появились в дереве слева и на схеме.
      const firstWord = tab.sql.trim().split(/\s+/)[0]?.toUpperCase();
      if (firstWord && ["CREATE", "DROP", "ALTER", "TRUNCATE"].includes(firstWord)) {
        loadTables(tab.connectionId);
      }
    } catch (e) {
      updateTab(tab.id, {
        isRunning: false,
        lastResult: makeErrorResult(e),
      });
      const list = addHistoryEntry(tab.connectionId, tab.sql, false);
      setHistoryByConn((prev) => ({ ...prev, [tab.connectionId]: list }));
    }
  }

  async function runExplain(tab: AppTab) {
    updateTab(tab.id, { isRunning: true, explainError: null });
    try {
      const plan = await withConnectionStatus(tab.connectionId, () =>
        api.explainQuery(tab.connectionId, tab.sql, tab.explainAnalyze)
      );
      updateTab(tab.id, { isRunning: false, explainPlan: plan, explainError: null });
    } catch (e) {
      updateTab(tab.id, { isRunning: false, explainPlan: null, explainError: errorText(e) });
    }
  }

  async function runAnalyzeTable(tab: AppTab, table: string) {
    setAnalyzingTable(table);
    try {
      const quoted = `"${table.replace(/"/g, '""')}"`;
      await withConnectionStatus(tab.connectionId, () =>
        api.runQuery(tab.connectionId, `ANALYZE ${quoted}`)
      );
      // Статистика обновилась — сразу перестроим план, чтобы сразу было видно результат.
      await runExplain(tab);
    } catch (e) {
      reportError(`Не удалось выполнить ANALYZE "${table}"`, e);
    } finally {
      setAnalyzingTable(null);
    }
  }

  function toggleHistory(tab: AppTab) {
    updateTab(tab.id, { historyOpen: !tab.historyOpen });
  }

  function selectHistoryEntry(tab: AppTab, sql: string) {
    updateTab(tab.id, { sql, historyOpen: false });
  }

  function clearTabHistory(tab: AppTab) {
    const list = clearHistory(tab.connectionId);
    setHistoryByConn((prev) => ({ ...prev, [tab.connectionId]: list }));
  }

  function toggleAnalyzeMode(tab: AppTab) {
    updateTab(tab.id, { analyzeMode: !tab.analyzeMode });
  }

  function setExplainAnalyze(tab: AppTab, value: boolean) {
    updateTab(tab.id, { explainAnalyze: value });
  }

  function askDeleteConnection(conn: ConnectionConfig) {
    setPendingDelete(conn);
  }

  async function confirmDeleteConnection() {
    if (!pendingDelete) return;
    const conn = pendingDelete;
    setPendingDelete(null);
    try {
      await api.deleteConnection(conn.id);
      await refreshConnections();
      // Закроем все вкладки, использующие удалённое подключение.
      setTabs((prev) => prev.filter((t) => t.connectionId !== conn.id));
    } catch (e) {
      reportError(`Не удалось удалить подключение "${conn.name}"`, e);
    }
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeTables = activeTab ? tablesByConn[activeTab.connectionId] ?? [] : [];
  const activeColumns = activeTab ? columnsByConn[activeTab.connectionId] ?? [] : [];
  const activeForeignKeys = activeTab ? foreignKeysByConn[activeTab.connectionId] ?? [] : [];
  const activeTablesLoading = activeTab ? !!tablesLoading[activeTab.connectionId] : false;
  const activeTableKey =
    activeTab && activeTab.selectedTable
      ? `${activeTab.connectionId}:${activeTab.selectedTable.schema}.${activeTab.selectedTable.name}`
      : null;
  const activeTableColumns = activeTableKey ? tableColumnsByKey[activeTableKey] ?? [] : [];

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNew={() => {
          setEditingConn(undefined);
          setModalOpen(true);
        }}
        theme={theme}
        onThemeChange={setTheme}
      />

      {globalError && (
        <ErrorBanner message={globalError} onClose={() => setGlobalError(null)} />
      )}

      <div className="body-row">
        <Sidebar
          connections={connections}
          width={sidebarResize.size}
          onOpen={openConnectionInTab}
          onEdit={(c) => {
            setEditingConn(c);
            setModalOpen(true);
          }}
          onDelete={askDeleteConnection}
          onNew={() => {
            setEditingConn(undefined);
            setModalOpen(true);
          }}
        />
        <ResizeHandle
          direction="horizontal"
          dragging={sidebarResize.dragging}
          onMouseDown={sidebarResize.onMouseDown}
        />

        <div className="main">
          {!activeTab && (
            <div className="empty-state">
              <div style={{ fontSize: 15 }}>Нет открытых вкладок</div>
              <div style={{ fontSize: 13 }}>
                Выберите подключение слева или создайте новое
              </div>
            </div>
          )}

          {activeTab && (
            <>
              <div className="subtabs">
                <div
                  className={"subtab" + (activeTab.view === "tables" ? " active" : "")}
                  onClick={() => updateTab(activeTab.id, { view: "tables" })}
                >
                  Таблицы
                </div>
                <div
                  className={"subtab" + (activeTab.view === "schema" ? " active" : "")}
                  onClick={() => updateTab(activeTab.id, { view: "schema" })}
                >
                  Схема
                </div>
                <div
                  className={"subtab" + (activeTab.view === "query" ? " active" : "")}
                  onClick={() => updateTab(activeTab.id, { view: "query" })}
                >
                  SQL-запрос
                </div>
              </div>

              <div className="content-split">
                {activeTab.view === "tables" && (
                  <>
                    <TableList
                      tables={activeTables}
                      selected={activeTab.selectedTable}
                      onSelect={(t) => selectTable(activeTab, t)}
                      onRefresh={() => loadTables(activeTab.connectionId)}
                      refreshing={activeTablesLoading}
                      width={tableTreeResize.size}
                      onCreateTable={() => setCreateTableOpen(true)}
                    />
                    <ResizeHandle
                      direction="horizontal"
                      dragging={tableTreeResize.dragging}
                      onMouseDown={tableTreeResize.onMouseDown}
                    />
                    <div className="pane">
                      {activeTab.selectedTable && (
                        <div className="subtabs subtabs-nested">
                          <div
                            className={"subtab" + (activeTab.tableSubView === "data" ? " active" : "")}
                            onClick={() => setTableSubView(activeTab, "data")}
                          >
                            Данные
                          </div>
                          <div
                            className={"subtab" + (activeTab.tableSubView === "structure" ? " active" : "")}
                            onClick={() => setTableSubView(activeTab, "structure")}
                          >
                            Редактирование
                          </div>
                        </div>
                      )}
                      {!activeTab.selectedTable ? (
                        <ResultsTable result={activeTab.lastResult} loading={activeTab.isRunning} />
                      ) : activeTab.tableSubView === "structure" ? (
                        <TableStructureEditor
                          key={`${activeTab.connectionId}:${activeTab.selectedTable.schema}.${activeTab.selectedTable.name}`}
                          schema={activeTab.selectedTable.schema}
                          table={activeTab.selectedTable.name}
                          columns={activeTableColumns}
                          loading={activeTab.isRunning}
                          saving={savingChanges}
                          onSubmit={(statements) =>
                            submitStructureChanges(
                              activeTab,
                              activeTab.selectedTable!.schema,
                              activeTab.selectedTable!.name,
                              statements
                            )
                          }
                          onDropTable={() => askDropTable(activeTab.selectedTable!)}
                        />
                      ) : (
                        <EditableDataGrid
                          key={`${activeTab.connectionId}:${activeTab.selectedTable.schema}.${activeTab.selectedTable.name}`}
                          schema={activeTab.selectedTable.schema}
                          table={activeTab.selectedTable.name}
                          columns={activeTableColumns}
                          result={activeTab.lastResult}
                          loading={activeTab.isRunning}
                          saving={savingChanges}
                          onSubmit={(changes) =>
                            submitTableChanges(
                              activeTab,
                              activeTab.selectedTable!.schema,
                              activeTab.selectedTable!.name,
                              changes
                            )
                          }
                        />
                      )}
                    </div>
                  </>
                )}

                {activeTab.view === "schema" && (
                  <SchemaDiagram
                    key={activeTab.connectionId}
                    tables={activeTables}
                    columns={activeColumns}
                    foreignKeys={activeForeignKeys}
                    loading={activeTablesLoading}
                    connectionId={activeTab.connectionId}
                  />
                )}

                {activeTab.view === "query" && (
                  <div className="pane">
                    <QueryEditor
                      sql={activeTab.sql}
                      onChange={(v) => updateTab(activeTab.id, { sql: v })}
                      onRun={() =>
                        activeTab.analyzeMode ? runExplain(activeTab) : runQuery(activeTab)
                      }
                      running={activeTab.isRunning}
                      theme={theme}
                      columns={activeColumns}
                      history={historyByConn[activeTab.connectionId] ?? []}
                      historyOpen={activeTab.historyOpen}
                      onToggleHistory={() => toggleHistory(activeTab)}
                      onSelectHistory={(sql) => selectHistoryEntry(activeTab, sql)}
                      onClearHistory={() => clearTabHistory(activeTab)}
                      editorHeight={editorResize.size}
                      analyzeMode={activeTab.analyzeMode}
                      onToggleAnalyze={() => toggleAnalyzeMode(activeTab)}
                      explainAnalyze={activeTab.explainAnalyze}
                      onToggleExplainAnalyze={(v) => setExplainAnalyze(activeTab, v)}
                    />
                    <ResizeHandle
                      direction="vertical"
                      dragging={editorResize.dragging}
                      onMouseDown={editorResize.onMouseDown}
                    />
                    {activeTab.analyzeMode ? (
                      <ExplainPlanView
                        plan={activeTab.explainPlan}
                        error={activeTab.explainError}
                        loading={activeTab.isRunning}
                        analyzingTable={analyzingTable}
                        onRunAnalyze={(table) => runAnalyzeTable(activeTab, table)}
                      />
                    ) : (
                      <ResultsTable result={activeTab.lastResult} loading={activeTab.isRunning} />
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <ConnectionModal
          initial={editingConn}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false);
            await refreshConnections();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Удалить подключение?"
          message={`Подключение "${pendingDelete.name}" будет удалено вместе с сохранённым паролем. Это действие нельзя отменить.`}
          onConfirm={confirmDeleteConnection}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {createTableOpen && activeTab && (
        <CreateTableModal
          schema={activeTab.selectedTable?.schema ?? "public"}
          onClose={() => setCreateTableOpen(false)}
          onCreate={(name, columns) =>
            createTable(activeTab, activeTab.selectedTable?.schema ?? "public", name, columns)
          }
        />
      )}

      {pendingDropTable && (
        <ConfirmDialog
          title="Удалить таблицу?"
          message={`Таблица "${pendingDropTable.schema}.${pendingDropTable.name}" и все данные в ней будут удалены безвозвратно.`}
          confirmLabel="Удалить таблицу"
          onConfirm={confirmDropTable}
          onCancel={() => setPendingDropTable(null)}
        >
          <label className="checkbox-field" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={dropCascade} onChange={(e) => setDropCascade(e.target.checked)} />
            <span>
              CASCADE — удалить и всё, что зависит от таблицы (внешние ключи из других таблиц и т.п.)
            </span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
