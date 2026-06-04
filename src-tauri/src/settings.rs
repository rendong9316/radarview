use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{params, Connection};

/// Create the app_settings KV table if it doesn't exist.
/// Called from db::init_db() during app startup.
pub fn ensure_settings_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("create app_settings table: {}", e))
}

/// UPSERT a single setting key → value pair.
pub fn save_setting(path: &PathBuf, key: &str, value: &str) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("set busy timeout: {}", e))?;

    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| format!("save setting '{}': {}", key, e))?;

    Ok(())
}

/// Return all settings as a flat key→value map.
pub fn load_all_settings(path: &PathBuf) -> Result<HashMap<String, String>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|e| format!("prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("query: {}", e))?;

    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| format!("row: {}", e))?;
        map.insert(k, v);
    }

    Ok(map)
}
