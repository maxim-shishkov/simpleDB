use crate::models::{ColumnInfo, ConnectionConfig, ForeignKeyRef, QueryResult, SchemaColumn, TableInfo};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_postgres::types::{Kind, Type};

pub struct ConnHandle {
    pub client: Arc<tokio_postgres::Client>,
    pub task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
pub struct AppState {
    pub clients: Mutex<HashMap<String, ConnHandle>>,
}

fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Разворачивает ошибку Postgres в максимально подробное человекочитаемое
/// сообщение: код SQLSTATE, основной текст, DETAIL и HINT, если они есть.
/// Обычный `.to_string()` отдаёт только первую строку и теряет самое полезное.
fn describe_pg_error(e: &tokio_postgres::Error) -> String {
    use std::error::Error as _;
    if let Some(db_err) = e.as_db_error() {
        let mut parts = vec![format!("[{}] {}", db_err.code().code(), db_err.message())];
        if let Some(detail) = db_err.detail() {
            parts.push(format!("Детали: {detail}"));
        }
        if let Some(hint) = db_err.hint() {
            parts.push(format!("Подсказка: {hint}"));
        }
        parts.join("\n")
    } else if let Some(io_err) = e.source().and_then(|s| s.downcast_ref::<std::io::Error>()) {
        format!("Ошибка соединения: {io_err}")
    } else {
        format!("Ошибка Postgres: {e}")
    }
}

pub async fn connect(cfg: &ConnectionConfig, password: &str) -> Result<ConnHandle, String> {
    let mut pgcfg = tokio_postgres::Config::new();
    pgcfg
        .host(&cfg.host)
        .port(cfg.port)
        .dbname(&cfg.dbname)
        .user(&cfg.user)
        .password(password)
        .connect_timeout(std::time::Duration::from_secs(10));

    if cfg.ssl_mode {
        pgcfg.ssl_mode(tokio_postgres::config::SslMode::Require);
        let connector = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| e.to_string())?;
        let connector = postgres_native_tls::MakeTlsConnector::new(connector);
        let (client, connection) = pgcfg
            .connect(connector)
            .await
            .map_err(|e| describe_pg_error(&e))?;
        let task = tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("connection error: {e}");
            }
        });
        Ok(ConnHandle {
            client: Arc::new(client),
            task,
        })
    } else {
        pgcfg.ssl_mode(tokio_postgres::config::SslMode::Prefer);
        let (client, connection) = pgcfg
            .connect(tokio_postgres::NoTls)
            .await
            .map_err(|e| describe_pg_error(&e))?;
        let task = tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("connection error: {e}");
            }
        });
        Ok(ConnHandle {
            client: Arc::new(client),
            task,
        })
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn opt_to_json<T: serde::Serialize>(
    r: Result<Option<T>, tokio_postgres::Error>,
) -> serde_json::Value {
    match r {
        Ok(Some(v)) => serde_json::to_value(v).unwrap_or(serde_json::Value::Null),
        _ => serde_json::Value::Null,
    }
}

/// Читает колонку как массив T и конвертирует в JSON-массив (NULL-элементы —
/// как JSON null). Работает для любого T с обычной сериализацией в JSON
/// (числа, bool, json/jsonb).
fn vec_to_json<T>(row: &tokio_postgres::Row, idx: usize) -> serde_json::Value
where
    T: for<'a> tokio_postgres::types::FromSql<'a> + serde::Serialize,
{
    match row.try_get::<_, Option<Vec<Option<T>>>>(idx) {
        Ok(Some(v)) => serde_json::Value::Array(
            v.into_iter()
                .map(|x| match x {
                    Some(val) => serde_json::to_value(val).unwrap_or(serde_json::Value::Null),
                    None => serde_json::Value::Null,
                })
                .collect(),
        ),
        Ok(None) => serde_json::Value::Null,
        Err(_) => serde_json::Value::Null,
    }
}

/// То же самое, но для типов, которые мы всегда показываем строкой (numeric,
/// uuid, даты/время — как и в скалярном случае, через Display).
fn vec_to_json_stringify<T>(row: &tokio_postgres::Row, idx: usize) -> serde_json::Value
where
    T: for<'a> tokio_postgres::types::FromSql<'a> + std::fmt::Display,
{
    match row.try_get::<_, Option<Vec<Option<T>>>>(idx) {
        Ok(Some(v)) => serde_json::Value::Array(
            v.into_iter()
                .map(|x| {
                    x.map(|val| serde_json::Value::String(val.to_string()))
                        .unwrap_or(serde_json::Value::Null)
                })
                .collect(),
        ),
        Ok(None) => serde_json::Value::Null,
        Err(_) => serde_json::Value::Null,
    }
}

/// Разворачивает массив (int4[], text[], uuid[], jsonb[] и т.п.) в JSON-массив,
/// подбирая декодер по имени типа элемента.
fn pg_array_to_json(row: &tokio_postgres::Row, idx: usize, elem_ty: &Type) -> serde_json::Value {
    match elem_ty.name() {
        "bool" => vec_to_json::<bool>(row, idx),
        "int2" => vec_to_json::<i16>(row, idx),
        "int4" => vec_to_json::<i32>(row, idx),
        "int8" => vec_to_json::<i64>(row, idx),
        "float4" => vec_to_json::<f32>(row, idx),
        "float8" => vec_to_json::<f64>(row, idx),
        "json" | "jsonb" => vec_to_json::<serde_json::Value>(row, idx),
        "numeric" => vec_to_json_stringify::<rust_decimal::Decimal>(row, idx),
        "uuid" => vec_to_json_stringify::<uuid::Uuid>(row, idx),
        "date" => vec_to_json_stringify::<chrono::NaiveDate>(row, idx),
        "time" => vec_to_json_stringify::<chrono::NaiveTime>(row, idx),
        "timestamp" => vec_to_json_stringify::<chrono::NaiveDateTime>(row, idx),
        "timestamptz" => match row.try_get::<_, Option<Vec<Option<chrono::DateTime<chrono::Utc>>>>>(idx) {
            Ok(Some(v)) => serde_json::Value::Array(
                v.into_iter()
                    .map(|x| {
                        x.map(|d| serde_json::Value::String(d.to_rfc3339()))
                            .unwrap_or(serde_json::Value::Null)
                    })
                    .collect(),
            ),
            Ok(None) => serde_json::Value::Null,
            Err(_) => serde_json::Value::Null,
        },
        // varchar/text/bpchar/name/enum и всё остальное неизвестное — как текст.
        _ => vec_to_json::<String>(row, idx),
    }
}

/// Конвертирует значение скалярной (не массивной) колонки в JSON по имени типа.
fn pg_scalar_to_json(row: &tokio_postgres::Row, idx: usize, type_name: &str) -> serde_json::Value {
    match type_name {
        "bool" => opt_to_json(row.try_get::<_, Option<bool>>(idx)),
        "int2" => opt_to_json(row.try_get::<_, Option<i16>>(idx)),
        "int4" => opt_to_json(row.try_get::<_, Option<i32>>(idx)),
        "int8" => opt_to_json(row.try_get::<_, Option<i64>>(idx)),
        "float4" => opt_to_json(row.try_get::<_, Option<f32>>(idx)),
        "float8" => opt_to_json(row.try_get::<_, Option<f64>>(idx)),
        "numeric" => match row.try_get::<_, Option<rust_decimal::Decimal>>(idx) {
            Ok(Some(d)) => serde_json::Value::String(d.to_string()),
            _ => serde_json::Value::Null,
        },
        "uuid" => match row.try_get::<_, Option<uuid::Uuid>>(idx) {
            Ok(Some(u)) => serde_json::Value::String(u.to_string()),
            _ => serde_json::Value::Null,
        },
        "json" | "jsonb" => match row.try_get::<_, Option<serde_json::Value>>(idx) {
            Ok(Some(v)) => v,
            _ => serde_json::Value::Null,
        },
        "timestamp" => match row.try_get::<_, Option<chrono::NaiveDateTime>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(v.to_string()),
            _ => serde_json::Value::Null,
        },
        "timestamptz" => match row.try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(v.to_rfc3339()),
            _ => serde_json::Value::Null,
        },
        "date" => match row.try_get::<_, Option<chrono::NaiveDate>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(v.to_string()),
            _ => serde_json::Value::Null,
        },
        "time" => match row.try_get::<_, Option<chrono::NaiveTime>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(v.to_string()),
            _ => serde_json::Value::Null,
        },
        "bytea" => match row.try_get::<_, Option<Vec<u8>>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(format!("\\x{}", hex_encode(&v))),
            _ => serde_json::Value::Null,
        },
        _ => {
            // varchar/text/bpchar/name/enum и всё остальное — как текст.
            if let Ok(v) = row.try_get::<_, Option<String>>(idx) {
                v.map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<_, Option<i32>>(idx) {
                v.map(|n| serde_json::Value::Number(n.into()))
                    .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
    }
}

/// Конвертирует значение колонки в JSON, ориентируясь на реальный тип Postgres
/// (не только имя) — так отличаем массивы (int4[], text[], jsonb[]...) от
/// скалярных значений и разворачиваем их по элементам, а не показываем NULL.
fn pg_value_to_json(row: &tokio_postgres::Row, idx: usize, ty: &Type) -> serde_json::Value {
    if let Kind::Array(elem_ty) = ty.kind() {
        return pg_array_to_json(row, idx, elem_ty);
    }
    pg_scalar_to_json(row, idx, ty.name())
}

/// Человекочитаемое имя типа для UI: массивы показываем как "int4[]", а не
/// как системное имя Postgres "_int4".
fn display_type_name(ty: &Type) -> String {
    match ty.kind() {
        Kind::Array(elem_ty) => format!("{}[]", elem_ty.name()),
        _ => ty.name().to_string(),
    }
}

/// Пытается угадать основную таблицу запроса по ключевым словам
/// FROM / INTO / UPDATE / DELETE FROM. Это простая эвристика (без полного
/// SQL-парсера), поэтому для сложных запросов с JOIN покажет первую таблицу
/// из FROM — этого достаточно, чтобы подписать результат.
fn extract_table_name(sql: &str) -> Option<String> {
    let tokens: Vec<&str> = sql
        .split(|c: char| c.is_whitespace() || c == '(' || c == ',')
        .filter(|s| !s.is_empty())
        .collect();
    let lower: Vec<String> = tokens.iter().map(|t| t.to_lowercase()).collect();

    for (i, tok) in lower.iter().enumerate() {
        let is_delete_from = tok == "delete" && lower.get(i + 1).map(|s| s.as_str()) == Some("from");
        if is_delete_from {
            if let Some(next) = tokens.get(i + 2) {
                return Some(clean_ident_token(next));
            }
        }
        if tok == "from" || tok == "into" || tok == "update" {
            if let Some(next) = tokens.get(i + 1) {
                return Some(clean_ident_token(next));
            }
        }
    }
    None
}

fn clean_ident_token(raw: &str) -> String {
    raw.trim_matches(|c| c == '"' || c == ';' || c == ',').to_string()
}

/// Выполняет один SQL-оператор через подготовленный запрос (extended protocol).
/// В отличие от simple_query, так метаданные колонок (имена и типы) приходят
/// всегда — даже если запрос вернул ноль строк.
pub async fn run_sql(client: &tokio_postgres::Client, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    let stmt = client
        .prepare(sql)
        .await
        .map_err(|e| describe_pg_error(&e))?;

    let columns: Vec<String> = stmt.columns().iter().map(|c| c.name().to_string()).collect();
    let pg_types: Vec<Type> = stmt.columns().iter().map(|c| c.type_().clone()).collect();
    let column_types: Vec<String> = pg_types.iter().map(display_type_name).collect();

    let (rows, row_count) = if columns.is_empty() {
        // Нет возвращаемых колонок — значит это INSERT/UPDATE/DELETE без RETURNING.
        // execute() даёт точное число затронутых строк.
        let affected = client
            .execute(&stmt, &[])
            .await
            .map_err(|e| describe_pg_error(&e))?;
        (Vec::new(), affected as i64)
    } else {
        let pg_rows = client
            .query(&stmt, &[])
            .await
            .map_err(|e| describe_pg_error(&e))?;
        let mut out = Vec::with_capacity(pg_rows.len());
        for row in &pg_rows {
            let mut map = serde_json::Map::new();
            for (i, col_name) in columns.iter().enumerate() {
                map.insert(col_name.clone(), pg_value_to_json(row, i, &pg_types[i]));
            }
            out.push(map);
        }
        let count = out.len() as i64;
        (out, count)
    };

    let command_tag = sql
        .trim_start()
        .split_whitespace()
        .next()
        .map(|s| s.to_uppercase());

    Ok(QueryResult {
        columns,
        column_types,
        rows,
        row_count,
        duration_ms: start.elapsed().as_millis() as i64,
        error: None,
        command_tag,
        table_name: extract_table_name(sql),
    })
}

pub async fn list_tables(client: &tokio_postgres::Client) -> Result<Vec<TableInfo>, String> {
    let sql = "SELECT table_schema, table_name, table_type FROM information_schema.tables \
               WHERE table_schema NOT IN ('pg_catalog','information_schema') \
               ORDER BY table_schema, table_name";
    let result = run_sql(client, sql).await?;
    Ok(result
        .rows
        .into_iter()
        .map(|r| TableInfo {
            schema: r
                .get("table_schema")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: r
                .get("table_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            kind: if r.get("table_type").and_then(|v| v.as_str()) == Some("VIEW") {
                "view".to_string()
            } else {
                "table".to_string()
            },
        })
        .collect())
}

/// Заменяет длинное SQL-стандартное имя типа (то, что выдаёт information_schema
/// и что видно в начале строки format_type) на короткий алиас Postgres —
/// ровно такой же, каким подписаны колонки в результатах запросов и на схеме.
/// Модификатор (длина/точность в скобках) и суффикс массива "[]" сохраняются
/// как есть — заменяется только сам базовый префикс имени типа.
fn normalize_type_name(raw: &str) -> String {
    // Порядок важен: более длинные/специфичные варианты — раньше более
    // коротких, иначе "character varying" по ошибке схлопнется в "character".
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("timestamp without time zone", "timestamp"),
        ("timestamp with time zone", "timestamptz"),
        ("time without time zone", "time"),
        ("time with time zone", "timetz"),
        ("character varying", "varchar"),
        ("character", "char"),
        ("double precision", "float8"),
        ("real", "float4"),
        ("boolean", "bool"),
        ("bigint", "int8"),
        ("smallint", "int2"),
        ("integer", "int4"),
    ];
    for (long, short) in REPLACEMENTS {
        if let Some(rest) = raw.strip_prefix(long) {
            return format!("{short}{rest}");
        }
    }
    raw.to_string()
}

pub async fn get_table_columns(
    client: &tokio_postgres::Client,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let schema_lit = quote_literal(schema);
    let table_lit = quote_literal(table);
    // pg_catalog вместо information_schema: format_type() отдаёт тот же
    // канонический короткий вид типа (с длиной/точностью в скобках), каким
    // подписаны колонки в результатах SELECT и на диаграмме схемы — вместо
    // многословных SQL-стандартных имён вроде "character varying" или
    // "timestamp with time zone" из information_schema.
    let sql = format!(
        "SELECT a.attname AS column_name, \
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type, \
                NOT a.attnotnull AS is_nullable, \
                EXISTS ( \
                    SELECT 1 FROM pg_catalog.pg_constraint con \
                    WHERE con.conrelid = a.attrelid \
                      AND con.contype = 'p' \
                      AND a.attnum = ANY (con.conkey) \
                ) AS is_pk \
         FROM pg_catalog.pg_attribute a \
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = {schema_lit} AND c.relname = {table_lit} \
           AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum"
    );
    let result = run_sql(client, &sql).await?;
    Ok(result
        .rows
        .into_iter()
        .map(|r| ColumnInfo {
            name: r
                .get("column_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            data_type: normalize_type_name(r.get("data_type").and_then(|v| v.as_str()).unwrap_or("")),
            is_nullable: r.get("is_nullable").and_then(|v| v.as_bool()).unwrap_or(true),
            is_primary_key: r.get("is_pk").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect())
}

pub async fn get_table_rows(
    client: &tokio_postgres::Client,
    schema: &str,
    table: &str,
    limit: i64,
    offset: i64,
) -> Result<QueryResult, String> {
    let sql = format!(
        "SELECT * FROM {}.{} LIMIT {} OFFSET {}",
        quote_ident(schema),
        quote_ident(table),
        limit,
        offset
    );
    let mut result = run_sql(client, &sql).await?;
    // Здесь точное имя известно заранее — надёжнее, чем эвристика по тексту SQL.
    result.table_name = Some(format!("{schema}.{table}"));
    Ok(result)
}

/// Возвращает список всех внешних ключей БД (для диаграммы схемы), с признаком
/// того, уникальна ли колонка-источник (PK/UNIQUE) — по этому признаку на
/// фронтенде определяется тип связи: 1—1 (уникальна) или 1—N (не уникальна).
pub async fn list_foreign_keys(client: &tokio_postgres::Client) -> Result<Vec<ForeignKeyRef>, String> {
    let fk_sql = "SELECT tc.constraint_name, tc.table_schema AS source_schema, \
                  tc.table_name AS source_table, kcu.column_name AS source_column, \
                  ccu.table_schema AS target_schema, ccu.table_name AS target_table, \
                  ccu.column_name AS target_column \
                  FROM information_schema.table_constraints tc \
                  JOIN information_schema.key_column_usage kcu \
                    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
                  JOIN information_schema.constraint_column_usage ccu \
                    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
                  WHERE tc.constraint_type = 'FOREIGN KEY' \
                    AND tc.table_schema NOT IN ('pg_catalog','information_schema') \
                  ORDER BY source_schema, source_table";
    let fk_result = run_sql(client, fk_sql).await?;

    let unique_sql = "SELECT tc.table_schema, tc.table_name, kcu.column_name \
                       FROM information_schema.table_constraints tc \
                       JOIN information_schema.key_column_usage kcu \
                         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
                       WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE') \
                         AND tc.table_schema NOT IN ('pg_catalog','information_schema')";
    let unique_result = run_sql(client, unique_sql).await?;

    let mut unique_set: std::collections::HashSet<(String, String, String)> =
        std::collections::HashSet::new();
    for r in unique_result.rows {
        let schema = r.get("table_schema").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let table = r.get("table_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let column = r.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        unique_set.insert((schema, table, column));
    }

    Ok(fk_result
        .rows
        .into_iter()
        .map(|r| {
            let source_schema = r.get("source_schema").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let source_table = r.get("source_table").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let source_column = r.get("source_column").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let source_is_unique =
                unique_set.contains(&(source_schema.clone(), source_table.clone(), source_column.clone()));
            ForeignKeyRef {
                constraint_name: r.get("constraint_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                source_schema,
                source_table,
                source_column,
                target_schema: r.get("target_schema").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                target_table: r.get("target_table").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                target_column: r.get("target_column").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                source_is_unique,
            }
        })
        .collect())
}

/// Строит план выполнения запроса через EXPLAIN.
/// analyze = false (по умолчанию, безопасно): EXPLAIN без ANALYZE — запрос
/// НЕ выполняется, только планируется, поэтому безопасно для INSERT/UPDATE/DELETE.
/// analyze = true: EXPLAIN ANALYZE — запрос РЕАЛЬНО выполняется (с побочными
/// эффектами для INSERT/UPDATE/DELETE!), зато план содержит фактические
/// метрики (время, реальное число строк, буферы) — вызывающая сторона обязана
/// явно и осознанно запросить этот режим.
pub async fn explain_query(
    client: &tokio_postgres::Client,
    sql: &str,
    analyze: bool,
) -> Result<serde_json::Value, String> {
    let opts = if analyze {
        "FORMAT JSON, VERBOSE, COSTS, ANALYZE, BUFFERS, TIMING, SUMMARY"
    } else {
        "FORMAT JSON, VERBOSE, COSTS, SUMMARY"
    };
    let explain_sql = format!("EXPLAIN ({opts}) {sql}");
    let mut result = run_sql(client, &explain_sql).await?;
    let row = result
        .rows
        .drain(..)
        .next()
        .ok_or_else(|| "Postgres не вернул план запроса".to_string())?;
    row.into_iter()
        .find_map(|(k, v)| if k == "QUERY PLAN" { Some(v) } else { None })
        .ok_or_else(|| "Неожиданный формат ответа EXPLAIN — не найдена колонка QUERY PLAN".to_string())
}

/// Возвращает список всех колонок всех пользовательских таблиц одним запросом —
/// используется для автодополнения названий полей в SQL-редакторе.
pub async fn list_all_columns(client: &tokio_postgres::Client) -> Result<Vec<SchemaColumn>, String> {
    let sql = "SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns \
               WHERE table_schema NOT IN ('pg_catalog','information_schema') \
               ORDER BY table_schema, table_name, ordinal_position";
    let result = run_sql(client, sql).await?;
    Ok(result
        .rows
        .into_iter()
        .map(|r| SchemaColumn {
            schema: r
                .get("table_schema")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            table: r
                .get("table_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            data_type: normalize_type_name(r.get("data_type").and_then(|v| v.as_str()).unwrap_or("")),
            name: r
                .get("column_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}
