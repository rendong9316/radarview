use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::track::Track;
use crate::track::ts_to_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchInfo {
    pub id: i64,
    pub file_name: String,
    pub source: String,
    pub track_count: i64,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceFilter {
    pub source: String,
    pub min_points: Option<i64>,
    pub max_points: Option<i64>,
}

pub fn db_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("radarview.db")
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("pragma: {}", e))?;
    let exists = stmt
        .query_map([], |row| Ok(row.get::<_, String>(1)?))
        .map_err(|e| format!("query pragma: {}", e))?
        .filter_map(|r| r.ok())
        .any(|name| name == column);
    Ok(exists)
}

pub fn init_db(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }

    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    // Set busy timeout for multi-connection safety (background writes, concurrent reads)
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| format!("set busy timeout: {}", e))?;

    // Enable WAL mode — better concurrency, safer for large transactions
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("set WAL mode: {}", e))?;

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

    // Migration: add metadata columns (ignore if already exist)
    if !has_column(&conn, "saved_tracks", "source")? {
        conn.execute(
            "ALTER TABLE saved_tracks ADD COLUMN source TEXT",
            [],
        )
        .map_err(|e| format!("add source column: {}", e))?;
    }
    if !has_column(&conn, "saved_tracks", "min_timestamp")? {
        conn.execute(
            "ALTER TABLE saved_tracks ADD COLUMN min_timestamp TEXT",
            [],
        )
        .map_err(|e| format!("add min_timestamp column: {}", e))?;
    }
    if !has_column(&conn, "saved_tracks", "max_timestamp")? {
        conn.execute(
            "ALTER TABLE saved_tracks ADD COLUMN max_timestamp TEXT",
            [],
        )
        .map_err(|e| format!("add max_timestamp column: {}", e))?;
    }
    if !has_column(&conn, "saved_tracks", "point_count")? {
        conn.execute(
            "ALTER TABLE saved_tracks ADD COLUMN point_count INTEGER DEFAULT 0",
            [],
        )
        .map_err(|e| format!("add point_count column: {}", e))?;
    }

    // Create indexes for the new columns
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tracks_source ON saved_tracks(source);
         CREATE INDEX IF NOT EXISTS idx_tracks_time ON saved_tracks(min_timestamp, max_timestamp);
         CREATE INDEX IF NOT EXISTS idx_tracks_points ON saved_tracks(point_count);",
    )
    .map_err(|e| format!("create indexes: {}", e))?;

    // Backfill existing rows that have NULL metadata
    backfill_metadata(&conn)?;

    // Backfill source column from JSON for existing rows
    conn.execute(
        "UPDATE saved_tracks SET source = json_extract(track_json, '$.source') WHERE source IS NULL",
        [],
    )
    .map_err(|e| format!("backfill source: {}", e))?;

    // ── track_points table: row-per-position for window-function analytics ──
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS track_points (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            icao_address  TEXT NOT NULL,
            batch_id      INTEGER NOT NULL,
            source        TEXT NOT NULL DEFAULT '',
            timestamp_ms  INTEGER NOT NULL,
            latitude      REAL NOT NULL,
            longitude     REAL NOT NULL,
            altitude      REAL DEFAULT 0,
            heading       REAL DEFAULT 0,
            ground_speed  REAL DEFAULT 0,
            vertical_rate REAL DEFAULT 0
        );",
    )
    .map_err(|e| format!("create track_points: {}", e))?;

    // Run backfill only if schema version has not been bumped yet
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);
    if version < 1 {
        // Create indexes AFTER backfill (faster bulk insert, indexes built once)
        backfill_track_points(&conn)?;

        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique ON track_points(icao_address, batch_id, timestamp_ms);
             CREATE INDEX IF NOT EXISTS idx_points_track ON track_points(icao_address, batch_id);
             CREATE INDEX IF NOT EXISTS idx_points_ts    ON track_points(timestamp_ms);
             CREATE INDEX IF NOT EXISTS idx_points_src   ON track_points(source);",
        )
        .map_err(|e| format!("create track_points indexes: {}", e))?;

        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| format!("set user_version: {}", e))?;
    } else {
        // Ensure indexes exist for upgrades from partial runs
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique ON track_points(icao_address, batch_id, timestamp_ms);
             CREATE INDEX IF NOT EXISTS idx_points_track ON track_points(icao_address, batch_id);
             CREATE INDEX IF NOT EXISTS idx_points_ts    ON track_points(timestamp_ms);
             CREATE INDEX IF NOT EXISTS idx_points_src   ON track_points(source);",
        )
        .map_err(|e| format!("ensure track_points indexes: {}", e))?;
    }

    // ── app_settings KV table for user preferences ──
    crate::settings::ensure_settings_table(&conn)?;

    Ok(())
}

/// Extract min/max timestamp from positions (positions are sorted by time)
fn extract_track_meta(track: &Track) -> (String, String, i64) {
    let len = track.positions.len();
    if len == 0 {
        return (String::new(), String::new(), 0);
    }
    let min_ts = track.positions[0].timestamp.clone();
    let max_ts = track.positions[len - 1].timestamp.clone();
    (min_ts, max_ts, len as i64)
}

/// One-time backfill of metadata columns from existing track_json
fn backfill_metadata(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT icao_address, batch_id, track_json FROM saved_tracks WHERE min_timestamp IS NULL",
        )
        .map_err(|e| format!("prepare backfill select: {}", e))?;

    let rows: Vec<(String, i64, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("query backfill: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(());
    }

    let mut update = conn
        .prepare(
            "UPDATE saved_tracks SET min_timestamp = ?1, max_timestamp = ?2, point_count = ?3 \
             WHERE icao_address = ?4 AND batch_id = ?5",
        )
        .map_err(|e| format!("prepare backfill update: {}", e))?;

    for (icao, batch_id, json) in &rows {
        let track: Track = serde_json::from_str(json)
            .map_err(|e| format!("deserialize track for backfill: {}", e))?;
        let (min_ts, max_ts, pt_count) = extract_track_meta(&track);
        update
            .execute(params![min_ts, max_ts, pt_count, icao, batch_id])
            .map_err(|e| format!("backfill update: {}", e))?;
    }

    Ok(())
}

/// One-time backfill: expand existing track_json positions into track_points rows.
/// Processes tracks in small batches to avoid SQLite B-tree corruption.
fn backfill_track_points(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT icao_address, batch_id, source, track_json FROM saved_tracks")
        .map_err(|e| format!("prepare backfill select: {}", e))?;

    let rows: Vec<(String, i64, Option<String>, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("query backfill tracks: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    for chunk in rows.chunks(50) {
        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|e| format!("backfill tx begin: {}", e))?;

        let result = (|| -> Result<(), String> {
            for (icao, batch_id, source, json) in chunk {
                let track: Track = serde_json::from_str(json)
                    .map_err(|e| format!("deserialize track for backfill: {}", e))?;
                let source_str = source
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&track.source);

                let mut pos_values: Vec<String> = Vec::new();
                for pos in &track.positions {
                    let ts_ms = ts_to_ms(&pos.timestamp).unwrap_or(0);
                    if ts_ms == 0 {
                        continue;
                    }
                    pos_values.push(format!(
                        "('{}',{},{},'{}',{},{},{},{},{},{})",
                        icao.replace('\'', "''"),
                        batch_id,
                        ts_ms,
                        source_str.replace('\'', "''"),
                        pos.latitude,
                        pos.longitude,
                        pos.altitude,
                        pos.heading,
                        pos.ground_speed,
                        pos.vertical_rate,
                    ));
                }

                for batch in pos_values.chunks(500) {
                    let sql = format!(
                        "INSERT OR IGNORE INTO track_points \
                         (icao_address, batch_id, timestamp_ms, source, latitude, longitude, altitude, heading, ground_speed, vertical_rate) \
                         VALUES {}",
                        batch.join(",")
                    );
                    conn.execute(&sql, [])
                        .map_err(|e| format!("insert backfill batch: {}", e))?;
                }
            }
            Ok(())
        })();

        match result {
            Ok(()) => {
                conn.execute("COMMIT", [])
                    .map_err(|e| format!("backfill tx commit: {}", e))?;
            }
            Err(e) => {
                let _ = conn.execute("ROLLBACK", []);
                return Err(e);
            }
        }
    }

    Ok(())
}

/// Convert epoch millis to "YYYY-MM-DD HH:MM:SS" text (Beijing time, UTC+8)
fn ms_to_ts(ms: i64) -> String {
    if ms <= 0 {
        return String::new();
    }
    let china_tz = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    if let Some(dt) = chrono::DateTime::from_timestamp_millis(ms) {
        return dt.with_timezone(&china_tz).format("%Y-%m-%d %H:%M:%S").to_string();
    }
    String::new()
}

pub fn save_batch(
    path: &PathBuf,
    file_name: &str,
    source: &str,
    tracks: &[Track],
) -> Result<i64, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    // Set busy timeout so background writes don't fail on transient locks
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| format!("set busy timeout: {}", e))?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin tx: {}", e))?;

    let result = (|| -> Result<i64, String> {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        conn.execute(
            "INSERT INTO batches (file_name, source, track_count, imported_at) VALUES (?1, ?2, ?3, ?4)",
            params![file_name, source, tracks.len() as i64, now],
        )
        .map_err(|e| format!("insert batch: {}", e))?;

        let batch_id = conn.last_insert_rowid();

        // Phase 1: Insert saved_tracks with a reused prepared statement, and collect
        // ALL track_points rows for a single-phase batch write afterwards.
        let total_positions: usize = tracks.iter().map(|t| t.positions.len()).sum();
        let mut point_rows: Vec<String> = Vec::with_capacity(total_positions);

        {
            let mut stmt = conn
                .prepare(
                    "INSERT OR REPLACE INTO saved_tracks \
                     (icao_address, batch_id, track_json, source, min_timestamp, max_timestamp, point_count) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| format!("prepare saved_tracks: {}", e))?;

            for track in tracks {
                let json = serde_json::to_string(track)
                    .map_err(|e| format!("serialize track: {}", e))?;
                let (min_ts, max_ts, pt_count) = extract_track_meta(track);

                stmt.execute(params![
                    track.icao_address,
                    batch_id,
                    json,
                    track.source,
                    min_ts,
                    max_ts,
                    pt_count,
                ])
                .map_err(|e| format!("insert saved_track: {}", e))?;

                // Collect track_points rows — escape once per track, not per position
                let icao_esc = track.icao_address.replace('\'', "''");
                let src_esc = track.source.replace('\'', "''");
                for pos in &track.positions {
                    let ts_ms = ts_to_ms(&pos.timestamp)?;
                    if ts_ms == 0 {
                        continue; // invalid / empty timestamp — skip (matches backfill behavior)
                    }
                    point_rows.push(format!(
                        "('{}',{},{},'{}',{},{},{},{},{},{})",
                        icao_esc, batch_id, ts_ms, src_esc,
                        pos.latitude, pos.longitude, pos.altitude,
                        pos.heading, pos.ground_speed, pos.vertical_rate,
                    ));
                }
            }
        } // stmt dropped → releases conn borrow

        // Phase 2: One-pass batch insert of ALL track_points (5000 rows/INSERT, ~10× fewer SQL calls)
        for chunk in point_rows.chunks(5000) {
            let sql = format!(
                "INSERT OR IGNORE INTO track_points \
                 (icao_address, batch_id, timestamp_ms, source, latitude, longitude, altitude, heading, ground_speed, vertical_rate) \
                 VALUES {}",
                chunk.join(",")
            );
            conn.execute(&sql, [])
                .map_err(|e| format!("insert track_points batch: {}", e))?;
        }

        Ok(batch_id)
    })();

    match result {
        Ok(batch_id) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("commit: {}", e))?;
            Ok(batch_id)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
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

/// Get the global time range across all tracks using indexed metadata (O(1))
pub fn get_global_time_range(path: &PathBuf) -> Result<Option<(i64, i64)>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT MIN(min_timestamp), MAX(max_timestamp) FROM saved_tracks \
             WHERE min_timestamp IS NOT NULL AND min_timestamp != ''",
        )
        .map_err(|e| format!("prepare time range: {}", e))?;

    let result = stmt
        .query_row([], |row| {
            let min: Option<String> = row.get(0)?;
            let max: Option<String> = row.get(1)?;
            Ok((min, max))
        })
        .map_err(|e| format!("query time range: {}", e))?;

    match result {
        (Some(min_s), Some(max_s)) if !min_s.is_empty() && !max_s.is_empty() => {
            let min_ms = ts_to_ms(&min_s)?;
            let max_ms = ts_to_ms(&max_s)?;
            Ok(Some((min_ms, max_ms)))
        }
        _ => Ok(None),
    }
}

/// Load tracks filtered by time range and per-source point count ranges.
/// Uses indexed columns (min_timestamp, max_timestamp, point_count, source) — O(1) index scan.
pub fn load_filtered_tracks(
    path: &PathBuf,
    min_time_ms: Option<i64>,
    max_time_ms: Option<i64>,
    source_filters: &[SourceFilter],
) -> Result<Vec<Track>, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let min_ts_text = min_time_ms.map(|ms| ms_to_ts(ms)).unwrap_or_default();
    let max_ts_text = max_time_ms.map(|ms| ms_to_ts(ms)).unwrap_or_default();

    let mut sql = String::from("SELECT track_json FROM saved_tracks WHERE 1=1");
    let mut param_values: Vec<String> = Vec::new();

    // Time range filter
    if !min_ts_text.is_empty() {
        param_values.push(min_ts_text.clone());
        sql.push_str(&format!(" AND max_timestamp >= ?{}", param_values.len()));
    }
    if !max_ts_text.is_empty() {
        param_values.push(max_ts_text.clone());
        sql.push_str(&format!(" AND min_timestamp <= ?{}", param_values.len()));
    }

    // Per-source point count filter
    if !source_filters.is_empty() {
        sql.push_str(" AND (");
        let mut first = true;
        for sf in source_filters {
            if !first {
                sql.push_str(" OR ");
            }
            first = false;

            param_values.push(sf.source.clone());
            sql.push_str(&format!("(source = ?{}", param_values.len()));

            if let Some(min_pts) = sf.min_points {
                param_values.push(min_pts.to_string());
                sql.push_str(&format!(" AND point_count >= ?{}", param_values.len()));
            }
            if let Some(max_pts) = sf.max_points {
                param_values.push(max_pts.to_string());
                sql.push_str(&format!(" AND point_count <= ?{}", param_values.len()));
            }
            sql.push(')');
        }
        sql.push(')');
    }

    // Build params as &dyn ToSql
    let param_strs: Vec<&str> = param_values.iter().map(|s| s.as_str()).collect();
    let param_dyn: Vec<&dyn rusqlite::types::ToSql> =
        param_strs.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare filter: {}", e))?;

    let rows = stmt
        .query_map(param_dyn.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| format!("query filter: {}", e))?;

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

    conn.execute("DELETE FROM track_points WHERE batch_id = ?1", params![batch_id])
        .map_err(|e| format!("delete track points: {}", e))?;

    conn.execute("DELETE FROM saved_tracks WHERE batch_id = ?1", params![batch_id])
        .map_err(|e| format!("delete tracks: {}", e))?;

    conn.execute("DELETE FROM batches WHERE id = ?1", params![batch_id])
        .map_err(|e| format!("delete batch: {}", e))?;

    Ok(())
}
