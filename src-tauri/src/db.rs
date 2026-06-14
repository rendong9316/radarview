use std::collections::HashSet;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::manage::{
    DistinctOptions, TrackMetaFilter, TrackMetaInfo, TrackMetadataResponse, TrackStats,
};
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

/// Check whether the stored app version matches `current_version`.
/// Returns `Ok(true)` if the database was deleted (version mismatch → fresh start).
/// Returns `Ok(false)` if versions match, no stored version exists, or the file is absent.
pub fn check_version_and_reset(path: &PathBuf, current_version: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let conn = Connection::open(path).map_err(|e| format!("open db for version check: {}", e))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| format!("ensure app_settings: {}", e))?;
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'app.version'",
            [],
            |row| row.get(0),
        )
        .ok();
    drop(conn);
    match stored {
        None => Ok(false),
        Some(v) if v == current_version => Ok(false),
        Some(_) => {
            std::fs::remove_file(path).map_err(|e| format!("delete old db: {}", e))?;
            let _ = std::fs::remove_file(&path.with_extension("db-wal"));
            let _ = std::fs::remove_file(&path.with_extension("db-shm"));
            Ok(true)
        }
    }
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

pub fn init_db(path: &PathBuf, current_version: &str) -> Result<(), String> {
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

    // ── Store current app version for future upgrade detection ──
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('app.version', ?1)",
        params![current_version],
    )
    .map_err(|e| format!("store app version: {}", e))?;

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

/// When re-importing a file whose batch already exists, find tracks that were
/// deleted since the first import and insert only the missing ones.
/// Returns the number of tracks actually added (0 = nothing missing).
pub fn append_missing_tracks(
    path: &PathBuf,
    file_name: &str,
    source: &str,
    tracks: &[Track],
) -> Result<usize, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| format!("set busy timeout: {}", e))?;

    // Find the existing batch
    let batch_id: i64 = conn
        .query_row(
            "SELECT id FROM batches WHERE file_name = ?1",
            params![file_name],
            |row| row.get(0),
        )
        .map_err(|e| format!("find batch by file_name '{}': {}", file_name, e))?;

    // Collect existing ICAOs for this batch
    let mut stmt = conn
        .prepare("SELECT icao_address FROM saved_tracks WHERE batch_id = ?1")
        .map_err(|e| format!("prepare: {}", e))?;
    let existing: HashSet<String> = stmt
        .query_map(params![batch_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query existing icaos: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Filter to tracks not yet in this batch
    let missing: Vec<&Track> = tracks
        .iter()
        .filter(|t| !existing.contains(&t.icao_address))
        .collect();

    if missing.is_empty() {
        return Ok(0);
    }

    let added = missing.len();

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin tx: {}", e))?;

    let result = (|| -> Result<(), String> {
        // Insert missing saved_tracks + collect track_points rows
        let total_positions: usize = missing.iter().map(|t| t.positions.len()).sum();
        let mut point_rows: Vec<String> = Vec::with_capacity(total_positions);

        {
            let mut ins_stmt = conn
                .prepare(
                    "INSERT OR REPLACE INTO saved_tracks \
                     (icao_address, batch_id, track_json, source, min_timestamp, max_timestamp, point_count) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| format!("prepare saved_tracks: {}", e))?;

            for track in &missing {
                let json = serde_json::to_string(track)
                    .map_err(|e| format!("serialize track: {}", e))?;
                let (min_ts, max_ts, pt_count) = extract_track_meta(track);

                ins_stmt
                    .execute(params![
                        track.icao_address,
                        batch_id,
                        json,
                        source,
                        min_ts,
                        max_ts,
                        pt_count,
                    ])
                    .map_err(|e| format!("insert saved_track: {}", e))?;

                let icao_esc = track.icao_address.replace('\'', "''");
                let src_esc = source.replace('\'', "''");
                for pos in &track.positions {
                    let ts_ms = ts_to_ms(&pos.timestamp)?;
                    if ts_ms == 0 {
                        continue;
                    }
                    point_rows.push(format!(
                        "('{}',{},{},'{}',{},{},{},{},{},{})",
                        icao_esc, batch_id, ts_ms, src_esc,
                        pos.latitude, pos.longitude, pos.altitude,
                        pos.heading, pos.ground_speed, pos.vertical_rate,
                    ));
                }
            }
        }

        // Batch insert track_points
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

        // Update batch track_count
        conn.execute(
            "UPDATE batches SET track_count = track_count + ?1 WHERE id = ?2",
            params![added as i64, batch_id],
        )
        .map_err(|e| format!("update batch count: {}", e))?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("commit: {}", e))?;
            Ok(added)
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

// ── Track Management System queries ──────────────────────────────────────────

/// Build a safe column name for ORDER BY (whitelist-based to prevent SQL injection).
fn sort_column(filter: &TrackMetaFilter) -> &'static str {
    match filter.sort_by.as_str() {
        "icao_address" => "st.icao_address",
        "flight_no" => "json_extract(st.track_json, '$.flight_no')",
        "registration" => "json_extract(st.track_json, '$.registration')",
        "aircraft_type" => "json_extract(st.track_json, '$.aircraft_type')",
        "airline" => "json_extract(st.track_json, '$.airline')",
        "origin" => "json_extract(st.track_json, '$.origin')",
        "destination" => "json_extract(st.track_json, '$.destination')",
        "point_count" => "st.point_count",
        "min_timestamp" => "st.min_timestamp",
        "max_timestamp" => "st.max_timestamp",
        "batch_file_name" => "b.file_name",
        "batch_imported_at" => "b.imported_at",
        _ => "b.imported_at",
    }
}

/// Paginated + filtered track metadata query.
/// Returns (rows for current page, total matching count).
pub fn query_track_metadata(
    path: &PathBuf,
    filter: &TrackMetaFilter,
    limit: i64,
    offset: i64,
) -> Result<TrackMetadataResponse, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let min_ts_text = filter
        .min_time_ms
        .map(|ms| ms_to_ts(ms))
        .unwrap_or_default();
    let max_ts_text = filter
        .max_time_ms
        .map(|ms| ms_to_ts(ms))
        .unwrap_or_default();

    // ── Build WHERE clause ──
    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<String> = Vec::new();

    // Source filter — optional, with frontend→DB name mapping
    if let Some(ref src) = filter.source {
        let db_src = crate::manage::source_to_db(src);
        param_values.push(db_src.to_string());
        where_clauses.push(format!("st.source = ?{}", param_values.len()));
    }

    // Time range filter (uses indexed columns)
    if !min_ts_text.is_empty() {
        param_values.push(min_ts_text);
        where_clauses.push(format!(
            "st.max_timestamp >= ?{}",
            param_values.len()
        ));
    }
    if !max_ts_text.is_empty() {
        param_values.push(max_ts_text);
        where_clauses.push(format!(
            "st.min_timestamp <= ?{}",
            param_values.len()
        ));
    }

    // Point count filter (indexed)
    if let Some(min_pts) = filter.min_points {
        param_values.push(min_pts.to_string());
        where_clauses.push(format!("st.point_count >= ?{}", param_values.len()));
    }
    if let Some(max_pts) = filter.max_points {
        param_values.push(max_pts.to_string());
        where_clauses.push(format!("st.point_count <= ?{}", param_values.len()));
    }

    // Batch filter
    if let Some(batch_id) = filter.batch_id {
        param_values.push(batch_id.to_string());
        where_clauses.push(format!("st.batch_id = ?{}", param_values.len()));
    }

    // Airline filter — extracted from JSON at query time
    if let Some(ref airline) = filter.airline {
        param_values.push(airline.clone());
        where_clauses.push(format!(
            "json_extract(st.track_json, '$.airline') = ?{}",
            param_values.len()
        ));
    }

    // Aircraft type filter
    if let Some(ref atype) = filter.aircraft_type {
        param_values.push(atype.clone());
        where_clauses.push(format!(
            "json_extract(st.track_json, '$.aircraft_type') = ?{}",
            param_values.len()
        ));
    }

    // Full-text search across multiple JSON fields (case-insensitive via LOWER)
    if let Some(ref txt) = filter.search_text {
        if !txt.trim().is_empty() {
            let like_pattern = format!("%{}%", txt.trim().to_lowercase());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern.clone());
            param_values.push(like_pattern);
            let n = param_values.len();
            where_clauses.push(format!(
                "(LOWER(st.icao_address) LIKE ?{n0} \
                 OR LOWER(json_extract(st.track_json, '$.flight_no')) LIKE ?{n1} \
                 OR LOWER(json_extract(st.track_json, '$.icao_flight_no')) LIKE ?{n2} \
                 OR LOWER(json_extract(st.track_json, '$.registration')) LIKE ?{n3} \
                 OR LOWER(json_extract(st.track_json, '$.aircraft_type')) LIKE ?{n4} \
                 OR LOWER(json_extract(st.track_json, '$.airline')) LIKE ?{n5} \
                 OR LOWER(json_extract(st.track_json, '$.origin')) LIKE ?{n6} \
                 OR LOWER(json_extract(st.track_json, '$.destination')) LIKE ?{n7})",
                n0 = n - 7,
                n1 = n - 6,
                n2 = n - 5,
                n3 = n - 4,
                n4 = n - 3,
                n5 = n - 2,
                n6 = n - 1,
                n7 = n,
            ));
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::from("1=1")
    } else {
        where_clauses.join(" AND ")
    };

    // ── Count total ──
    let count_sql = format!(
        "SELECT COUNT(*) FROM saved_tracks st JOIN batches b ON st.batch_id = b.id WHERE {}",
        where_sql
    );

    eprintln!("[manage] count_sql: {}", count_sql);
    eprintln!("[manage] params: {:?}", param_values);

    let param_strs: Vec<&str> = param_values.iter().map(|s| s.as_str()).collect();
    let param_dyn: Vec<&dyn rusqlite::types::ToSql> =
        param_strs.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

    let mut count_stmt = conn
        .prepare(&count_sql)
        .map_err(|e| format!("prepare count: {}", e))?;
    let total_count: i64 = count_stmt
        .query_row(param_dyn.as_slice(), |row| row.get(0))
        .map_err(|e| format!("count query: {}", e))?;

    // ── Query page ──
    let sort_col = sort_column(filter);
    let direction = if filter.sort_desc { "DESC" } else { "ASC" };
    let data_sql = format!(
        "SELECT st.icao_address, st.batch_id, st.source, st.track_json, \
                st.min_timestamp, st.max_timestamp, st.point_count, \
                b.file_name, b.imported_at \
         FROM saved_tracks st JOIN batches b ON st.batch_id = b.id \
         WHERE {} \
         ORDER BY {} {} \
         LIMIT ?{} OFFSET ?{}",
        where_sql,
        sort_col,
        direction,
        param_values.len() + 1,
        param_values.len() + 2,
    );

    let mut all_params: Vec<String> = param_values.clone();
    all_params.push(limit.to_string());
    all_params.push(offset.to_string());

    let all_strs: Vec<&str> = all_params.iter().map(|s| s.as_str()).collect();
    let all_dyn: Vec<&dyn rusqlite::types::ToSql> =
        all_strs.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

    let mut stmt = conn
        .prepare(&data_sql)
        .map_err(|e| format!("prepare data: {}", e))?;

    let rows = stmt
        .query_map(all_dyn.as_slice(), |row| {
            let json: String = row.get(3)?;
            // Parse JSON once, extract all metadata fields from the same Value tree
            let track_value: serde_json::Value =
                serde_json::from_str(&json).unwrap_or_default();
            let field = |key: &str| -> String {
                track_value
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            };
            let flight_no = field("flight_no");
            let icao_flight_no = field("icao_flight_no");
            let registration = field("registration");
            let aircraft_type = field("aircraft_type");
            let airline = field("airline");
            let origin = field("origin");
            let destination = field("destination");

            Ok(TrackMetaInfo {
                icao_address: row.get(0)?,
                batch_id: row.get(1)?,
                source: row.get(2)?,
                flight_number: flight_no,
                icao_flight_number: icao_flight_no,
                registration,
                aircraft_type,
                airline,
                origin,
                destination,
                min_timestamp: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                max_timestamp: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                point_count: row.get(6)?,
                batch_file_name: row.get(7)?,
                batch_imported_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("data query: {}", e))?;

    let mut metadata_rows = Vec::new();
    for row in rows {
        metadata_rows.push(row.map_err(|e| format!("row: {}", e))?);
    }

    Ok(TrackMetadataResponse {
        rows: metadata_rows,
        total_count,
    })
}

/// Get aggregate statistics across all tracks.
pub fn get_track_statistics(path: &PathBuf) -> Result<TrackStats, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    // Total tracks and per-source breakdown
    let mut stmt = conn
        .prepare("SELECT COUNT(*), source FROM saved_tracks GROUP BY source")
        .map_err(|e| format!("prepare source counts: {}", e))?;
    let source_rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("query source counts: {}", e))?;

    let mut by_source = std::collections::HashMap::new();
    let mut total_tracks: i64 = 0;
    for row in source_rows {
        let (count, source) = row.map_err(|e| format!("row: {}", e))?;
        total_tracks += count;
        by_source.insert(source, count);
    }

    // Total batches
    let total_batches: i64 = conn
        .query_row("SELECT COUNT(*) FROM batches", [], |row| row.get(0))
        .map_err(|e| format!("batch count: {}", e))?;

    // Unique ICAO addresses
    let unique_icao: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT icao_address) FROM saved_tracks",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("unique icao: {}", e))?;

    // Unique airlines (from JSON)
    let mut stmt = conn
        .prepare("SELECT DISTINCT json_extract(track_json, '$.airline') FROM saved_tracks WHERE json_extract(track_json, '$.airline') IS NOT NULL AND json_extract(track_json, '$.airline') != ''")
        .map_err(|e| format!("prepare airlines: {}", e))?;
    let unique_airlines: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query airlines: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Unique aircraft types
    let mut stmt = conn
        .prepare("SELECT DISTINCT json_extract(track_json, '$.aircraft_type') FROM saved_tracks WHERE json_extract(track_json, '$.aircraft_type') IS NOT NULL AND json_extract(track_json, '$.aircraft_type') != ''")
        .map_err(|e| format!("prepare aircraft types: {}", e))?;
    let unique_aircraft_types: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query aircraft types: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Global time range
    let mut stmt = conn
        .prepare(
            "SELECT MIN(min_timestamp), MAX(max_timestamp) FROM saved_tracks \
             WHERE min_timestamp IS NOT NULL AND min_timestamp != ''",
        )
        .map_err(|e| format!("prepare time range: {}", e))?;

    let time_range = stmt
        .query_row([], |row| {
            let min_s: Option<String> = row.get(0)?;
            let max_s: Option<String> = row.get(1)?;
            Ok((min_s, max_s))
        })
        .map_err(|e| format!("query time range: {}", e))?;

    let (time_min_ms, time_max_ms) = match time_range {
        (Some(min_s), Some(max_s)) if !min_s.is_empty() && !max_s.is_empty() => {
            (ts_to_ms(&min_s).ok(), ts_to_ms(&max_s).ok())
        }
        _ => (None, None),
    };

    Ok(TrackStats {
        total_tracks,
        total_batches,
        by_source,
        unique_icao,
        unique_airlines,
        unique_aircraft_types,
        time_min_ms,
        time_max_ms,
    })
}

/// Get distinct filter options (airlines, aircraft types, batch names) for a given source.
pub fn get_distinct_options(path: &PathBuf, source: Option<&str>) -> Result<DistinctOptions, String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    let source_clause: String;
    let source_param: Option<String> = source.map(|s| crate::manage::source_to_db(s).to_string());

    if let Some(ref s) = source_param {
        source_clause = format!("WHERE source = '{}'", s.replace('\'', "''"));
    } else {
        source_clause = String::new();
    }

    // Airlines
    let airline_sql = format!(
        "SELECT DISTINCT json_extract(track_json, '$.airline') FROM saved_tracks {} \
         AND json_extract(track_json, '$.airline') IS NOT NULL \
         AND json_extract(track_json, '$.airline') != '' ORDER BY 1",
        source_clause
    );
    let mut stmt = conn.prepare(&airline_sql).map_err(|e| format!("prepare airlines: {}", e))?;
    let airlines: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query airlines: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Aircraft types
    let type_sql = format!(
        "SELECT DISTINCT json_extract(track_json, '$.aircraft_type') FROM saved_tracks {} \
         AND json_extract(track_json, '$.aircraft_type') IS NOT NULL \
         AND json_extract(track_json, '$.aircraft_type') != '' ORDER BY 1",
        source_clause
    );
    let mut stmt = conn.prepare(&type_sql).map_err(|e| format!("prepare aircraft types: {}", e))?;
    let aircraft_types: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query aircraft types: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Batch names
    let batch_sql = if let Some(ref s) = source_param {
        format!("SELECT id, file_name FROM batches WHERE source = '{}' ORDER BY id DESC", s.replace('\'', "''"))
    } else {
        "SELECT id, file_name FROM batches ORDER BY id DESC".to_string()
    };
    let mut stmt = conn.prepare(&batch_sql).map_err(|e| format!("prepare batches: {}", e))?;
    let batch_names: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("query batches: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DistinctOptions {
        airlines,
        aircraft_types,
        batch_names,
    })
}

/// Delete a single track from `saved_tracks` and `track_points`,
/// and decrement the batch's `track_count`. Removes the batch row if count reaches 0.
pub fn delete_track(path: &PathBuf, icao_address: &str, batch_id: i64) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin tx: {}", e))?;

    let result = (|| -> Result<(), String> {
        // Delete from track_points
        conn.execute(
            "DELETE FROM track_points WHERE icao_address = ?1 AND batch_id = ?2",
            params![icao_address, batch_id],
        )
        .map_err(|e| format!("delete track_points: {}", e))?;

        // Delete from saved_tracks
        conn.execute(
            "DELETE FROM saved_tracks WHERE icao_address = ?1 AND batch_id = ?2",
            params![icao_address, batch_id],
        )
        .map_err(|e| format!("delete saved_track: {}", e))?;

        // Decrement batch track_count
        conn.execute(
            "UPDATE batches SET track_count = track_count - 1 WHERE id = ?1",
            params![batch_id],
        )
        .map_err(|e| format!("update batch count: {}", e))?;

        // Remove batch if count <= 0
        conn.execute(
            "DELETE FROM batches WHERE id = ?1 AND track_count <= 0",
            params![batch_id],
        )
        .map_err(|e| format!("cleanup batch: {}", e))?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("commit: {}", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

/// Bulk delete tracks. Each element is (icao_address, batch_id).
pub fn delete_tracks_bulk(
    path: &PathBuf,
    tracks: &[(String, i64)],
) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin tx: {}", e))?;

    let result = (|| -> Result<(), String> {
        for (icao_address, batch_id) in tracks {
            conn.execute(
                "DELETE FROM track_points WHERE icao_address = ?1 AND batch_id = ?2",
                params![icao_address, *batch_id],
            )
            .map_err(|e| {
                format!("delete track_points for {}/{}: {}", icao_address, batch_id, e)
            })?;

            conn.execute(
                "DELETE FROM saved_tracks WHERE icao_address = ?1 AND batch_id = ?2",
                params![icao_address, *batch_id],
            )
            .map_err(|e| {
                format!("delete saved_track for {}/{}: {}", icao_address, batch_id, e)
            })?;

            conn.execute(
                "UPDATE batches SET track_count = track_count - 1 WHERE id = ?1",
                params![*batch_id],
            )
            .map_err(|e| format!("update batch count: {}", e))?;
        }

        // Cleanup empty batches
        conn.execute("DELETE FROM batches WHERE track_count <= 0", [])
            .map_err(|e| format!("cleanup batches: {}", e))?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("commit: {}", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

/// Load full Track data (with positions) for a list of (icao_address, batch_id) pairs.
/// Used to load selected tracks into the map display and for export.
pub fn export_tracks(
    path: &PathBuf,
    track_ids: &[(String, i64)],
) -> Result<Vec<Track>, String> {
    if track_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(path).map_err(|e| format!("open db: {}", e))?;

    // Build IN clause with parameterized values
    let mut placeholders: Vec<String> = Vec::new();
    let mut params_vec: Vec<String> = Vec::new();
    for (icao, batch_id) in track_ids {
        placeholders.push(format!(
            "(icao_address = ?{} AND batch_id = ?{})",
            params_vec.len() + 1,
            params_vec.len() + 2,
        ));
        params_vec.push(icao.clone());
        params_vec.push(batch_id.to_string());
    }

    let sql = format!(
        "SELECT track_json FROM saved_tracks WHERE {}",
        placeholders.join(" OR ")
    );

    let param_strs: Vec<&str> = params_vec.iter().map(|s| s.as_str()).collect();
    let param_dyn: Vec<&dyn rusqlite::types::ToSql> =
        param_strs.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare export: {}", e))?;

    let rows = stmt
        .query_map(param_dyn.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| format!("query export: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        let json = row.map_err(|e| format!("row: {}", e))?;
        let track: Track =
            serde_json::from_str(&json).map_err(|e| format!("deserialize track: {}", e))?;
        tracks.push(track);
    }

    Ok(tracks)
}
