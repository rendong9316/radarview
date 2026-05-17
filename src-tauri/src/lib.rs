mod adsb;
mod db;
mod radar;
mod tile_server;
mod track;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;
use tile_server::{find_mbtiles, get_tile_server_port, start_tile_server};
use track::Track;

struct DbPath(Mutex<PathBuf>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn import_adsb_file(
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<Track>, String> {
    let tracks = adsb::parse_adsb_csv(&file_path)?;
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !db::batch_exists(&path, &file_name)? {
        db::save_batch(&path, &file_name, "ADS-B", &tracks)?;
    }
    Ok(tracks)
}

#[tauri::command]
fn import_radar_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<Track>, String> {
    let tracks = radar::parse_mat_file(&app_handle, &file_path)?;
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !db::batch_exists(&path, &file_name)? {
        db::save_batch(&path, &file_name, "Radar", &tracks)?;
    }
    Ok(tracks)
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
            load_persisted_tracks,
            load_batch_tracks_cmd,
            get_batches_cmd,
            delete_batch_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
