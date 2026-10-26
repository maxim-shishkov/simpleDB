import type { QueryResult } from "../types";
import { ColumnTypeIcon } from "./ColumnTypeIcon";

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ResultsTable({
  result,
  loading,
}: {
  result: QueryResult | null;
  loading: boolean;
}) {
  if (loading) {
    return <div className="results-status">Выполняется запрос…</div>;
  }

  if (!result) {
    return <div className="results-status">Нет результатов. Выполните запрос.</div>;
  }

  const statusParts: string[] = [];
  if (result.table_name) statusParts.push(`Таблица: ${result.table_name}`);
  if (result.command_tag) statusParts.push(result.command_tag);
  statusParts.push(`${result.row_count} строк(и)`);
  statusParts.push(`${result.duration_ms} мс`);

  return (
    <div className="results-wrap">
      <div className="results-scroll">
        {!result.error && result.columns.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                {result.columns.map((c, i) => (
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
              {result.rows.length === 0 && (
                <tr>
                  <td colSpan={result.columns.length} className="no-rows">
                    Строк нет
                  </td>
                </tr>
              )}
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => {
                    const v = row[c];
                    return (
                      <td key={c}>
                        {v === null || v === undefined ? (
                          <span className="null-value">NULL</span>
                        ) : (
                          formatCell(v)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={"results-status" + (result.error ? " error" : "")}>
        {result.error ? result.error : statusParts.join(" · ")}
      </div>
    </div>
  );
}
