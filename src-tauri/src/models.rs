use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub dbname: String,
    pub user: String,
    pub ssl_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
    pub row_count: i64,
    pub duration_ms: i64,
    pub error: Option<String>,
    pub command_tag: Option<String>,
    pub table_name: Option<String>,
}

/// Лёгкая запись "таблица.колонка" для автодополнения в SQL-редакторе и для
/// диаграммы схемы (иконка типа рядом с названием колонки).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaColumn {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
}

/// Связь по внешнему ключу между таблицами — для диаграммы схемы.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyRef {
    pub constraint_name: String,
    pub source_schema: String,
    pub source_table: String,
    pub source_column: String,
    pub target_schema: String,
    pub target_table: String,
    pub target_column: String,
    /// true — на стороне source колонка уникальна (PK/UNIQUE), значит связь 1—1.
    /// false — обычная связь "многие (source) — один (target)".
    pub source_is_unique: bool,
}
