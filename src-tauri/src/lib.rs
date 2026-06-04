mod adsb;
mod db;
mod radar;
mod settings;
mod tile_server;
mod track;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use rayon::prelude::*;
use tauri::Manager;
use tauri::Emitter;
use tile_server::{find_mbtiles, get_tile_server_port, start_tile_server};
use track::Track;
use track::TrackDto;

struct DbPath(Mutex<PathBuf>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn import_adsb_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let t0 = Instant::now();
    let tracks = adsb::parse_adsb_csv(&file_path)?;
    let t1 = Instant::now();
    eprintln!("[perf] CSV parse: {:?}", t1 - t0);

    // Clone data for background persistence — user sees tracks immediately
    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "ADS-B", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => eprintln!("[import_adsb_file] background save failed: {}", e),
            }
        });
    } else {
        // Already imported — fire event so frontend clears persisting state
        std::thread::spawn(move || { let _ = app_handle.emit("batch-saved", ()); });
    }

    let dtos: Vec<TrackDto> = tracks.into_par_iter().map(|t| t.to_dto()).collect();
    let t2 = Instant::now();
    eprintln!("[perf] DTO convert: {:?}  |  tracks={}  positions={}",
             t2 - t1, dtos.len(), dtos.iter().map(|d| d.pts.len()).sum::<usize>());

    Ok(dtos)
}

#[tauri::command]
fn import_radar_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let tracks = radar::parse_mat_file(&app_handle, &file_path)?;

    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "Radar", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => eprintln!("[import_radar_file] background save failed: {}", e),
            }
        });
    } else {
        std::thread::spawn(move || { let _ = app_handle.emit("batch-saved", ()); });
    }

    Ok(tracks.into_iter().map(|t| t.to_dto()).collect())
}

#[tauri::command]
fn import_radar_raw_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let tracks = radar::parse_mat_file_with_source(&app_handle, &file_path, Some("RadarRaw"))?;

    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "RadarRaw", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => eprintln!("[import_radar_raw_file] background save failed: {}", e),
            }
        });
    } else {
        std::thread::spawn(move || { let _ = app_handle.emit("batch-saved", ()); });
    }

    Ok(tracks.into_iter().map(|t| t.to_dto()).collect())
}

#[tauri::command]
fn load_persisted_tracks(
    db_path: tauri::State<'_, DbPath>,
) -> Result<Vec<Track>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::load_all_tracks(&path)
}

#[tauri::command]
fn get_batches_cmd(
    db_path: tauri::State<'_, DbPath>,
) -> Result<Vec<db::BatchInfo>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::get_batches(&path)
}

#[tauri::command]
fn load_batch_tracks_cmd(
    db_path: tauri::State<'_, DbPath>,
    batch_id: i64,
) -> Result<Vec<Track>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::load_tracks_by_batch(&path, batch_id)
}

#[tauri::command]
fn delete_batch_cmd(
    db_path: tauri::State<'_, DbPath>,
    batch_id: i64,
) -> Result<(), String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::delete_batch(&path, batch_id)
}

#[derive(serde::Serialize)]
struct TimeRange {
    min: i64,
    max: i64,
}

/// Get the global time range across all tracks using indexed metadata (O(1))
#[tauri::command]
fn get_time_range_cmd(
    db_path: tauri::State<'_, DbPath>,
) -> Result<Option<TimeRange>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::get_global_time_range(&path)
        .map(|opt| opt.map(|(min, max)| TimeRange { min, max }))
}

/// Load tracks filtered by time range and per-source point count (uses DB indexes)
#[tauri::command]
fn load_filtered_cmd(
    db_path: tauri::State<'_, DbPath>,
    min_time_ms: Option<i64>,
    max_time_ms: Option<i64>,
    source_filters: Vec<db::SourceFilter>,
) -> Result<Vec<Track>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::load_filtered_tracks(&path, min_time_ms, max_time_ms, &source_filters)
}

#[tauri::command]
fn save_setting(
    db_path: tauri::State<'_, DbPath>,
    key: String,
    value: String,
) -> Result<(), String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    settings::save_setting(&path, &key, &value)
}

#[tauri::command]
fn load_all_settings(
    db_path: tauri::State<'_, DbPath>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    settings::load_all_settings(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to resolve resource directory");
            let mbtiles_path = find_mbtiles(&resource_dir)
                .expect("No .mbtiles file found in resource directory");
            start_tile_server(mbtiles_path).expect("Failed to start tile server");

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let db_file = db::db_path(&data_dir);
            db::init_db(&db_file).expect("Failed to initialize SQLite database");
            app.manage(DbPath(Mutex::new(db_file)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_tile_server_port,
            import_adsb_file,
            import_radar_file,
            import_radar_raw_file,
            load_persisted_tracks,
            load_batch_tracks_cmd,
            get_batches_cmd,
            delete_batch_cmd,
            get_time_range_cmd,
            load_filtered_cmd,
            save_setting,
            load_all_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
