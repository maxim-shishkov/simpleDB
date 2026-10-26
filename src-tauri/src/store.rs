use crate::models::ConnectionConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Подключение вместе с паролем — то, что реально лежит на диске.
/// Пароль хранится в открытом виде в этом же файле (по просьбе — без
/// обращения к Keychain macOS, чтобы не спрашивать пароль от учётной записи
/// при каждом удалении/использовании подключения). Файл лежит в обычной
/// пользовательской директории конфигурации, доступной только текущему
/// пользователю ОС; дополнительная защита — включённый FileVault на диске.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredConnection {
    #[serde(flatten)]
    config: ConnectionConfig,
    #[serde(default)]
    password: String,
}

fn config_path() -> Result<PathBuf, String> {
    let mut dir = dirs::config_dir().ok_or("Не удалось определить директорию конфигурации")?;
    dir.push("simpledb");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.push("connections.json");
    Ok(dir)
}

fn load_stored() -> Result<Vec<StoredConnection>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if data.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn write_stored(list: &[StoredConnection]) -> Result<(), String> {
    let path = config_path()?;
    let data = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_connections() -> Result<Vec<ConnectionConfig>, String> {
    Ok(load_stored()?.into_iter().map(|s| s.config).collect())
}

pub fn save_connection(config: ConnectionConfig, password: Option<String>) -> Result<(), String> {
    let mut list = load_stored()?;
    if let Some(existing) = list.iter_mut().find(|c| c.config.id == config.id) {
        // Пароль обновляем, только если пользователь ввёл новый непустой —
        // иначе оставляем ранее сохранённый (в форме редактирования поле
        // пароля показывается пустым специально, чтобы не хранить его в UI).
        if let Some(pwd) = &password {
            if !pwd.is_empty() {
                existing.password = pwd.clone();
            }
        }
        existing.config = config;
    } else {
        list.push(StoredConnection {
            config,
            password: password.unwrap_or_default(),
        });
    }
    write_stored(&list)
}

pub fn get_password(id: &str) -> Result<String, String> {
    Ok(load_stored()?
        .into_iter()
        .find(|c| c.config.id == id)
        .map(|c| c.password)
        .unwrap_or_default())
}

pub fn delete_connection(id: &str) -> Result<(), String> {
    let mut list = load_stored()?;
    list.retain(|c| c.config.id != id);
    write_stored(&list)
}

pub fn find_connection(id: &str) -> Result<ConnectionConfig, String> {
    load_stored()?
        .into_iter()
        .find(|c| c.config.id == id)
        .map(|c| c.config)
        .ok_or_else(|| "Подключение не найдено".to_string())
}
