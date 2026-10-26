export interface HistoryEntry {
  id: string;
  sql: string;
  ranAt: number; // Date.now()
  success: boolean;
  durationMs?: number;
}

const MAX_ENTRIES = 100;

function storageKey(connectionId: string) {
  return `simpledb:history:${connectionId}`;
}

export function getHistory(connectionId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addHistoryEntry(
  connectionId: string,
  sql: string,
  success: boolean,
  durationMs?: number
): HistoryEntry[] {
  const trimmed = sql.trim();
  if (!trimmed) return getHistory(connectionId);

  const list = getHistory(connectionId);
  // Не дублируем подряд один и тот же запрос (например, при повторном ⌘+Enter).
  if (list[0]?.sql === trimmed) {
    const updated = [{ ...list[0], ranAt: Date.now(), success, durationMs }, ...list.slice(1)];
    localStorage.setItem(storageKey(connectionId), JSON.stringify(updated));
    return updated;
  }

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    sql: trimmed,
    ranAt: Date.now(),
    success,
    durationMs,
  };
  const next = [entry, ...list].slice(0, MAX_ENTRIES);
  localStorage.setItem(storageKey(connectionId), JSON.stringify(next));
  return next;
}

export function clearHistory(connectionId: string): HistoryEntry[] {
  localStorage.removeItem(storageKey(connectionId));
  return [];
}
