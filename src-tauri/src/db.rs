use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::track::Track;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchInfo {
    pub id: i64,
    pub file_name: String,
    pub source: String,
    pub track_count: i64,
    pub imported_at: String,
}

pub fn db_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("radarview.db")
}

pub fn init_db(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }

    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            source TEXT NOT NULL,
            track_count INTEGER NOT NULL,
            imported_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saved_tracks (
            icao_address TEXT NOT NULL,
            batch_id INTEGER NOT NULL,
            track_json TEXT NOT NULL,
            PRIMARY KEY (icao_address, batch_id),
            FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
        );
        PRAGMA foreign_keys = ON;
        ",
    )
    .map_err(|e| format!("create tables: {}", e))?;

    Ok(())
}

pub fn save_batch(
    path: &PathBuf,
    file_name: &str,
    source: &str,
    tracks: &[Track],
) -> Result<i64, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO batches (file_name, source, track_count, imported_at) VALUES (?1, ?2, ?3, ?4)",
        params![file_name, source, tracks.len() as i64, now],
    )
    .map_err(|e| format!("insert batch: {}", e))?;

    let batch_id = conn.last_insert_rowid();

    for track in tracks {
        let json =
            serde_json::to_string(track).map_err(|e| format!("serialize track: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO saved_tracks (icao_address, batch_id, track_json) VALUES (?1, ?2, ?3)",
            params![track.icao_address, batch_id, json],
        )
        .map_err(|e| format!("insert track: {}", e))?;
    }

    Ok(batch_id)
}

pub fn load_all_tracks(path: &PathBuf) -> Result<Vec<Track>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT track_json FROM saved_tracks")
        .map_err(|e| format!("prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        let json = row.map_err(|e| format!("row: {}", e))?;
        let track: Track =
            serde_json::from_str(&json).map_err(|e| format!("deserialize track: {}", e))?;
        tracks.push(track);
    }

    Ok(tracks)
}

pub fn load_tracks_by_batch(path: &PathBuf, batch_id: i64) -> Result<Vec<Track>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT track_json FROM saved_tracks WHERE batch_id = ?1")
        .map_err(|e| format!("prepare: {}", e))?;

    let rows = stmt
        .query_map(params![batch_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        let json = row.map_err(|e| format!("row: {}", e))?;
        let track: Track =
            serde_json::from_str(&json).map_err(|e| format!("deserialize track: {}", e))?;
        tracks.push(track);
    }

    Ok(tracks)
}

pub fn get_batches(path: &PathBuf) -> Result<Vec<BatchInfo>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT id, file_name, source, track_count, imported_at FROM batches ORDER BY id DESC")
        .map_err(|e| format!("prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(BatchInfo {
                id: row.get(0)?,
                file_name: row.get(1)?,
                source: row.get(2)?,
                track_count: row.get(3)?,
                imported_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("query: {}", e))?;

    let mut batches = Vec::new();
    for row in rows {
        batches.push(row.map_err(|e| format!("row: {}", e))?);
    }

    Ok(batches)
}

pub fn batch_exists(path: &PathBuf, file_name: &str) -> Result<bool, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT COUNT(*) FROM batches WHERE file_name = ?1")
        .map_err(|e| format!("prepare: {}", e))?;
    let count: i64 = stmt
        .query_row(params![file_name], |row| row.get(0))
        .map_err(|e| format!("query: {}", e))?;
    Ok(count > 0)
}

pub fn delete_batch(path: &PathBuf, batch_id: i64) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    conn.execute("DELETE FROM saved_tracks WHERE batch_id = ?1", params![batch_id])
        .map_err(|e| format!("delete tracks: {}", e))?;

    conn.execute("DELETE FROM batches WHERE id = ?1", params![batch_id])
        .map_err(|e| format!("delete batch: {}", e))?;

    Ok(())
}
