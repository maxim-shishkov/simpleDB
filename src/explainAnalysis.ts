export interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Alias"?: string;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Filter"?: string;
  "Index Cond"?: string;
  "Index Name"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Merge Cond"?: string;
  "Sort Key"?: string[];
  "Group Key"?: string[];
  "Plans"?: PlanNode[];
  // Присутствуют только при EXPLAIN ANALYZE (запрос реально выполнялся):
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Rows Removed by Filter"?: number;
  [key: string]: unknown;
}

export interface PlanMeta {
  root: PlanNode;
  planningTime?: number;
  executionTime?: number;
  analyzed: boolean;
}

export interface PlanWarning {
  level: "warn" | "info";
  text: string;
  /** Если задано — в UI можно показать кнопку, выполняющую это действие. */
  action?: { type: "analyze"; table: string };
}

/** "Собственная" стоимость узла — общая минус стоимость всех дочерних узлов. */
export function selfCost(node: PlanNode): number {
  const total = Number(node["Total Cost"] ?? 0);
  const childrenCost = (node.Plans ?? []).reduce(
    (sum, c) => sum + Number(c["Total Cost"] ?? 0),
    0
  );
  return Math.max(0, total - childrenCost);
}

/** Возвращает предупреждение/подсказку для конкретного узла плана, если есть. */
export function nodeWarning(node: PlanNode, rootCost: number): PlanWarning | null {
  const type = String(node["Node Type"] ?? "");
  const rows = Number(node["Plan Rows"] ?? 0);
  const cost = selfCost(node);
  const share = rootCost > 0 ? cost / rootCost : 0;

  // Проверка расхождения оценки планировщика и факта — доступна только
  // при EXPLAIN ANALYZE, но это одна из самых полезных подсказок: если
  // Postgres сильно ошибся в оценке числа строк, статистика таблицы устарела
  // (или ANALYZE по ней вообще ни разу не выполнялся — тогда используется
  // грубая заглушка планировщика вместо реальных данных).
  if (node["Actual Rows"] !== undefined && node["Relation Name"]) {
    const actualRows = Number(node["Actual Rows"]) * Number(node["Actual Loops"] ?? 1);
    const estRows = Number(node["Plan Rows"] ?? 0);
    const table = String(node["Relation Name"]);
    if (estRows > 10 || actualRows > 10) {
      const ratio = actualRows > estRows ? actualRows / Math.max(estRows, 1) : estRows / Math.max(actualRows, 1);
      if (ratio > 8) {
        return {
          level: "warn",
          text: `Оценка планировщика сильно расходится с фактом: ожидалось ≈${estRows} строк, по факту ${actualRows}. Обычно значит, что по таблице «${table}» ещё не выполнялся ANALYZE (или данные сильно изменились с прошлого раза) — планировщик использует грубую заглушку вместо реальной статистики.`,
          action: { type: "analyze", table },
        };
      }
    }
  }

  if (type === "Seq Scan" && node["Filter"]) {
    return {
      level: "warn",
      text: `Последовательное сканирование «${node["Relation Name"] ?? "?"}» (≈${rows} строк) с фильтром «${node["Filter"]}» — возможно, стоит добавить индекс по этому условию.`,
    };
  }
  if (type === "Seq Scan" && !node["Filter"] && rows > 5000) {
    return {
      level: "info",
      text: `Полное сканирование «${node["Relation Name"] ?? "?"}» (≈${rows} строк) без фильтра — нормально, если действительно нужны все строки.`,
    };
  }
  if (type === "Nested Loop") {
    const inner = node.Plans?.[1];
    if (inner && String(inner["Node Type"]).includes("Seq Scan")) {
      return {
        level: "warn",
        text: "Nested Loop с последовательным сканированием на внутренней стороне — с ростом внешней таблицы будет всё медленнее. Возможно, нужен индекс на колонке соединения.",
      };
    }
  }
  if (type === "Sort" && node["Sort Key"]) {
    return {
      level: "info",
      text: `Сортировка по ${(node["Sort Key"] as string[]).join(", ")} — если это поле часто используется в ORDER BY, индекс может убрать этот шаг вовсе.`,
    };
  }
  if ((type === "Hash Join" || type === "Merge Join") && rows > 50000) {
    return {
      level: "info",
      text: `${type} с оценкой ≈${rows} строк — при таком объёме проверьте, что статистика таблиц свежая (ANALYZE), иначе оценка может быть неточной.`,
    };
  }
  if (share > 0.35 && rootCost > 5) {
    return {
      level: "warn",
      text: `Это самый затратный шаг плана — примерно ${Math.round(share * 100)}% от общей стоимости запроса.`,
    };
  }
  return null;
}

export interface CollectedWarning extends PlanWarning {
  path: string;
  nodeType: string;
  relation?: string;
}

export function collectWarnings(
  node: PlanNode,
  rootCost: number,
  out: CollectedWarning[] = [],
  path = "0"
): CollectedWarning[] {
  const w = nodeWarning(node, rootCost);
  if (w) {
    out.push({
      ...w,
      path,
      nodeType: String(node["Node Type"] ?? ""),
      relation: node["Relation Name"] as string | undefined,
    });
  }
  (node.Plans ?? []).forEach((child, i) => collectWarnings(child, rootCost, out, `${path}.${i}`));
  return out;
}

/** Категория узла — используется для цветовой маркировки в дереве плана. */
export function nodeCategory(type: string): string {
  if (type.includes("Seq Scan")) return "scan";
  if (type.includes("Index")) return "index";
  if (type.includes("Join") || type.includes("Nested Loop")) return "join";
  if (type.includes("Sort")) return "sort";
  if (type.includes("Aggregate") || type.includes("Group")) return "agg";
  if (type.includes("Limit")) return "limit";
  if (type.includes("Hash") && !type.includes("Join")) return "hash";
  return "other";
}

/** Достаёт корневой узел плана и сопутствующие метаданные из ответа Postgres. */
export function extractPlanMeta(raw: unknown): PlanMeta | null {
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const first = arr[0] as
    | { Plan?: PlanNode; "Planning Time"?: number; "Execution Time"?: number }
    | undefined;
  if (!first?.Plan) return null;
  return {
    root: first.Plan,
    planningTime: first["Planning Time"],
    executionTime: first["Execution Time"],
    analyzed: first["Execution Time"] !== undefined,
  };
}
