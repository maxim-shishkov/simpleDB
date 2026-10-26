import {
  collectWarnings,
  extractPlanMeta,
  nodeCategory,
  nodeWarning,
  type PlanNode,
} from "../explainAnalysis";

function AnalyzeButton({
  table,
  analyzingTable,
  onRunAnalyze,
}: {
  table: string;
  analyzingTable: string | null;
  onRunAnalyze: (table: string) => void;
}) {
  const isRunning = analyzingTable === table;
  return (
    <button
      className="analyze-table-btn"
      disabled={analyzingTable !== null}
      onClick={() => onRunAnalyze(table)}
      title={`Выполнит ANALYZE ${table} и сразу перестроит план со свежей статистикой`}
    >
      {isRunning ? "Выполняется…" : `▶ ANALYZE ${table}`}
    </button>
  );
}

function PlanNodeView({
  node,
  rootCost,
  depth,
  analyzingTable,
  onRunAnalyze,
}: {
  node: PlanNode;
  rootCost: number;
  depth: number;
  analyzingTable: string | null;
  onRunAnalyze: (table: string) => void;
}) {
  const type = String(node["Node Type"] ?? "?");
  const category = nodeCategory(type);
  const warning = nodeWarning(node, rootCost);
  const relLabel =
    node["Relation Name"] &&
    (node["Alias"] && node["Alias"] !== node["Relation Name"]
      ? `${node["Relation Name"]} (${node["Alias"]})`
      : node["Relation Name"]);

  const hasActual = node["Actual Total Time"] !== undefined;

  const detailLines: string[] = [];
  if (node["Index Name"]) detailLines.push(`Индекс: ${node["Index Name"]}`);
  if (node["Index Cond"]) detailLines.push(`Условие индекса: ${node["Index Cond"]}`);
  if (node["Filter"]) detailLines.push(`Фильтр: ${node["Filter"]}`);
  if (node["Rows Removed by Filter"] !== undefined)
    detailLines.push(`Отфильтровано строк: ${node["Rows Removed by Filter"]}`);
  if (node["Hash Cond"]) detailLines.push(`Условие соединения: ${node["Hash Cond"]}`);
  if (node["Merge Cond"]) detailLines.push(`Условие слияния: ${node["Merge Cond"]}`);
  if (node["Sort Key"]) detailLines.push(`Ключ сортировки: ${(node["Sort Key"] as string[]).join(", ")}`);
  if (node["Group Key"]) detailLines.push(`Группировка: ${(node["Group Key"] as string[]).join(", ")}`);
  if (node["Join Type"]) detailLines.push(`Тип соединения: ${node["Join Type"]}`);
  if (node["Shared Hit Blocks"] !== undefined || node["Shared Read Blocks"] !== undefined) {
    detailLines.push(
      `Буферы: hit=${node["Shared Hit Blocks"] ?? 0} read=${node["Shared Read Blocks"] ?? 0}`
    );
  }

  return (
    <div className="plan-node" style={{ marginLeft: depth * 18 }}>
      <div className={"plan-node-header" + (warning ? ` plan-node-${warning.level}` : "")}>
        <span className={`plan-node-type plan-type-${category}`}>{type}</span>
        {relLabel && <span className="plan-node-rel">{relLabel}</span>}
        <span className="plan-node-stats">
          план: cost={Number(node["Startup Cost"] ?? 0).toFixed(2)}..
          {Number(node["Total Cost"] ?? 0).toFixed(2)} rows≈{node["Plan Rows"] ?? "?"}
        </span>
        {hasActual && (
          <span className="plan-node-stats plan-node-actual">
            факт: {Number(node["Actual Total Time"] ?? 0).toFixed(2)} мс · rows=
            {node["Actual Rows"]} · loops={node["Actual Loops"] ?? 1}
          </span>
        )}
      </div>
      {detailLines.length > 0 && (
        <div className="plan-node-detail">
          {detailLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {warning && (
        <div className={"plan-node-warning " + warning.level}>
          <div>⚠ {warning.text}</div>
          {warning.action && (
            <AnalyzeButton
              table={warning.action.table}
              analyzingTable={analyzingTable}
              onRunAnalyze={onRunAnalyze}
            />
          )}
        </div>
      )}
      {(node.Plans ?? []).map((child, i) => (
        <PlanNodeView
          key={i}
          node={child}
          rootCost={rootCost}
          depth={depth + 1}
          analyzingTable={analyzingTable}
          onRunAnalyze={onRunAnalyze}
        />
      ))}
    </div>
  );
}

export function ExplainPlanView({
  plan,
  error,
  loading,
  analyzingTable,
  onRunAnalyze,
}: {
  plan: unknown | null;
  error: string | null;
  loading: boolean;
  analyzingTable: string | null;
  onRunAnalyze: (table: string) => void;
}) {
  if (loading) {
    return <div className="results-status">Строим план запроса…</div>;
  }
  if (error) {
    return <div className="results-status error">{error}</div>;
  }
  if (!plan) {
    return (
      <div className="results-status">
        Нажмите «🔍 Анализировать», чтобы построить план запроса.
      </div>
    );
  }

  const meta = extractPlanMeta(plan);
  if (!meta) {
    return (
      <div className="results-status error">
        Не удалось разобрать план — неожиданный формат ответа Postgres.
      </div>
    );
  }

  const rootCost = Number(meta.root["Total Cost"] ?? 0);
  const warnings = collectWarnings(meta.root, rootCost);

  return (
    <div className="results-wrap">
      <div className="results-scroll">
        {meta.analyzed && (
          <div className="explain-analyzed-badge">
            ⚡ EXPLAIN ANALYZE — запрос был реально выполнен, метрики фактические
          </div>
        )}
        {warnings.length > 0 && (
          <div className="explain-summary">
            <div className="explain-summary-title">На что обратить внимание</div>
            {warnings.map((w, i) => (
              <div key={i} className={"explain-summary-item " + w.level}>
                <span className="explain-summary-node">{w.relation ?? w.nodeType}</span>
                {w.text}
                {w.action && (
                  <AnalyzeButton
                    table={w.action.table}
                    analyzingTable={analyzingTable}
                    onRunAnalyze={onRunAnalyze}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {warnings.length === 0 && (
          <div className="explain-summary explain-summary-ok">
            Явных проблем в плане не найдено — выглядит нормально.
          </div>
        )}
        <div className="plan-tree">
          <PlanNodeView
            node={meta.root}
            rootCost={rootCost}
            depth={0}
            analyzingTable={analyzingTable}
            onRunAnalyze={onRunAnalyze}
          />
        </div>
      </div>
      <div className="results-status">
        {meta.analyzed
          ? `EXPLAIN ANALYZE · планирование ${(meta.planningTime ?? 0).toFixed(2)} мс · выполнение ${(meta.executionTime ?? 0).toFixed(2)} мс`
          : `Оценка плана PostgreSQL (без выполнения запроса) · итоговая стоимость ≈ ${rootCost.toFixed(2)}`}
      </div>
    </div>
  );
}
