import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang, PostgreSQL } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import type { HistoryEntry } from "../history";
import type { SchemaColumn, Theme } from "../types";
import { QueryHistoryPanel } from "./QueryHistoryPanel";

export function QueryEditor({
  sql,
  onChange,
  onRun,
  running,
  theme,
  columns,
  history,
  historyOpen,
  onToggleHistory,
  onSelectHistory,
  onClearHistory,
  editorHeight,
  analyzeMode,
  onToggleAnalyze,
  explainAnalyze,
  onToggleExplainAnalyze,
}: {
  sql: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
  theme: Theme;
  columns: SchemaColumn[];
  history: HistoryEntry[];
  historyOpen: boolean;
  onToggleHistory: () => void;
  onSelectHistory: (sql: string) => void;
  onClearHistory: () => void;
  editorHeight: number;
  analyzeMode: boolean;
  onToggleAnalyze: () => void;
  explainAnalyze: boolean;
  onToggleExplainAnalyze: (value: boolean) => void;
}) {
  // onRun меняется на каждый рендер App — держим актуальную ссылку в ref,
  // чтобы не пересоздавать keymap-расширение (и не сбрасывать позицию курсора).
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const runKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ]),
    []
  );

  // Схема для автодополнения: и по короткому имени таблицы, и по "schema.table".
  const schema = useMemo(() => {
    const s: Record<string, string[]> = {};
    for (const col of columns) {
      for (const key of [col.table, `${col.schema}.${col.table}`]) {
        if (!s[key]) s[key] = [];
        if (!s[key].includes(col.name)) s[key].push(col.name);
      }
    }
    return s;
  }, [columns]);

  const sqlExtension = useMemo(
    () => sqlLang({ dialect: PostgreSQL, schema, upperCaseKeywords: true }),
    [schema]
  );

  const extensions = useMemo(() => [sqlExtension, runKeymap], [sqlExtension, runKeymap]);

  return (
    <div className="query-editor">
      <div className="cm-wrapper">
        <CodeMirror
          value={sql}
          height={`${editorHeight}px`}
          theme={theme === "dark" ? githubDark : githubLight}
          extensions={extensions}
          placeholder="SELECT * FROM ..."
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: true,
          }}
          onChange={(value) => onChange(value)}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="query-hint">⌘/Ctrl + Enter — выполнить</div>
          <button
            className={"btn history-toggle" + (historyOpen ? " active" : "")}
            onClick={onToggleHistory}
          >
            🕓 История{history.length > 0 ? ` (${history.length})` : ""}
          </button>
          <button
            className={"btn analyze-toggle" + (analyzeMode ? " active" : "")}
            onClick={onToggleAnalyze}
            title="Показать план выполнения запроса вместо результата"
          >
            🔍 Анализ
          </button>
          {analyzeMode && (
            <div className="explain-mode-toggle" title="Выберите режим анализа запроса">
              <button
                className={"explain-mode-btn" + (!explainAnalyze ? " active" : "")}
                onClick={() => onToggleExplainAnalyze(false)}
                title="Только построить план — запрос не выполняется, безопасно для любых запросов"
              >
                📋 EXPLAIN
              </button>
              <button
                className={"explain-mode-btn danger" + (explainAnalyze ? " active" : "")}
                onClick={() => onToggleExplainAnalyze(true)}
                title="Реально выполнит запрос и измерит фактическое время — осторожно с INSERT/UPDATE/DELETE"
              >
                ⚡ ANALYZE
              </button>
            </div>
          )}
        </div>
        <button
          className={"btn primary" + (analyzeMode && explainAnalyze ? " danger-primary" : "")}
          onClick={onRun}
          disabled={running || !sql.trim()}
        >
          {running
            ? "Выполняется…"
            : !analyzeMode
              ? "▶ Выполнить"
              : explainAnalyze
                ? "⚡ Выполнить и измерить"
                : "🔍 Построить план"}
        </button>
      </div>

      {analyzeMode && !explainAnalyze && (
        <div className="query-hint analyze-hint">
          Строится только оценка плана (EXPLAIN без ANALYZE) — запрос не выполняется, безопасно
          и для INSERT/UPDATE/DELETE.
        </div>
      )}
      {analyzeMode && explainAnalyze && (
        <div className="query-hint analyze-hint danger">
          ⚠ EXPLAIN ANALYZE реально выполнит запрос — включая изменения данных для
          INSERT/UPDATE/DELETE. Используйте осознанно.
        </div>
      )}

      {historyOpen && (
        <QueryHistoryPanel entries={history} onSelect={onSelectHistory} onClear={onClearHistory} />
      )}
    </div>
  );
}
