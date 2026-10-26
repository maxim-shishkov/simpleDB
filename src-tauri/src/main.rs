// Не открывать дополнительную консоль на Windows (не влияет на macOS/Linux)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod store;

use db::AppState;
use models::{ColumnInfo, ConnectionConfig, ForeignKeyRef, QueryResult, SchemaColumn, TableInfo};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
fn list_connections() -> Result<Vec<ConnectionConfig>, String> {
    store::load_connections()
}

#[tauri::command]
fn save_connection(config: ConnectionConfig, password: String) -> Result<(), String> {
    let pwd = if password.is_empty() { None } else { Some(password) };
    store::save_connection(config, pwd)
}

#[tauri::command]
fn delete_connection(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
        if let Some(handle) = clients.remove(&id) {
            handle.task.abort();
        }
    }
    store::delete_connection(&id)
}

#[tauri::command]
async fn test_connection(config: ConnectionConfig, password: String) -> Result<(), String> {
    let handle = db::connect(&config, &password).await?;
    handle.task.abort();
    Ok(())
}

/// Возвращает сохранённый пароль подключения — используется формой
/// редактирования, чтобы «Проверить»/пересохранение работали, даже если
/// пользователь не стал заново вводить пароль (поле специально показывается
/// пустым в UI, чтобы не светить пароль на экране).
#[tauri::command]
fn get_connection_password(id: String) -> Result<String, String> {
    store::get_password(&id)
}

#[tauri::command]
async fn open_connection(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
        if clients.contains_key(&id) {
            return Ok(());
        }
    }
    let config = store::find_connection(&id)?;
    let password = store::get_password(&id)?;
    let handle = db::connect(&config, &password).await?;
    let mut clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
    clients.insert(id, handle);
    Ok(())
}

#[tauri::command]
fn close_connection(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
    if let Some(handle) = clients.remove(&id) {
        handle.task.abort();
    }
    Ok(())
}

/// Возвращает активного клиента для подключения. Если по какой-то причине
/// соединение отсутствует в памяти (например, было закрыто сервером или
/// приложение перезапустилось), пытается прозрачно переподключиться заново
/// по сохранённой конфигурации — чтобы SQL-запросы и просмотр таблиц не
/// падали с невнятной ошибкой "нет соединения" на ровном месте.
async fn get_or_reconnect(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<Arc<tokio_postgres::Client>, String> {
    {
        let clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
        if let Some(handle) = clients.get(id) {
            return Ok(handle.client.clone());
        }
    }

    let config = store::find_connection(id)?;
    let password = store::get_password(id)?;
    let handle = db::connect(&config, &password).await?;
    let client = handle.client.clone();

    let mut clients = state.clients.lock().map_err(|_| "lock poisoned".to_string())?;
    clients.insert(id.to_string(), handle);
    Ok(client)
}

#[tauri::command]
async fn list_tables(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableInfo>, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::list_tables(&client).await
}

#[tauri::command]
async fn get_table_columns(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::get_table_columns(&client, &schema, &table).await
}

#[tauri::command]
async fn get_table_rows(
    connection_id: String,
    schema: String,
    table: String,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::get_table_rows(&client, &schema, &table, limit, offset).await
}

#[tauri::command]
async fn list_all_columns(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaColumn>, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::list_all_columns(&client).await
}

#[tauri::command]
async fn list_foreign_keys(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ForeignKeyRef>, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::list_foreign_keys(&client).await
}

#[tauri::command]
async fn explain_query(
    connection_id: String,
    sql: String,
    analyze: bool,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::explain_query(&client, &sql, analyze).await
}

#[tauri::command]
async fn run_query(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let client = get_or_reconnect(&state, &connection_id).await?;
    db::run_sql(&client, &sql).await
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_connections,
            save_connection,
            delete_connection,
            test_connection,
            get_connection_password,
            open_connection,
            close_connection,
            list_tables,
            get_table_columns,
            get_table_rows,
            list_all_columns,
            list_foreign_keys,
            explain_query,
            run_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
