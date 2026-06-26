mod adsb;
mod db;
mod manage;
mod radar;
mod settings;
mod tile_server;
mod track;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use std::time::Duration;

use rayon::prelude::*;
use tauri::Manager;
use tauri::Emitter;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;
use tile_server::{init_and_start_tile_server, get_tile_server_port, list_tile_sources, set_active_tile_source};
use track::Track;
use track::TrackDto;

struct DbPath(Mutex<PathBuf>);
struct SplashHandle(Mutex<Option<tauri::WebviewWindow>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn import_adsb_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let t0 = Instant::now();
    let mut tracks = adsb::parse_adsb_csv(&file_path).await?;
    let t1 = Instant::now();
    eprintln!("[perf] CSV parse: {:?}", t1 - t0);

    // Clone data for background persistence — user sees tracks immediately
    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Stamp file_name on every track for frontend identity
    for t in &mut tracks {
        t.file_name = file_name.clone();
    }

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "ADS-B", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => {
                    eprintln!("[import_adsb_file] background save failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("ADS-B {}: {}", fname, e));
                }
            }
        });
    } else {
        // Batch exists — check for and re-import any tracks deleted since first import
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::append_missing_tracks(&path_clone, &fname, "ADS-B", &tracks_clone) {
                Ok(added) => {
                    if added > 0 {
                        eprintln!(
                            "[import_adsb_file] appended {} missing track(s) to existing batch",
                            added
                        );
                    }
                    let _ = handle.emit("batch-saved", ());
                }
                Err(e) => {
                    eprintln!("[import_adsb_file] append missing failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("ADS-B append {}: {}", fname, e));
                }
            }
        });
    }

    let dtos: Vec<TrackDto> = tracks.into_par_iter().map(|t| t.to_dto()).collect();
    let t2 = Instant::now();
    eprintln!("[perf] DTO convert: {:?}  |  tracks={}  positions={}",
             t2 - t1, dtos.len(), dtos.iter().map(|d| d.pts.len()).sum::<usize>());

    Ok(dtos)
}

#[tauri::command]
async fn import_radar_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let mut tracks = radar::parse_mat_file(&app_handle, &file_path).await?;

    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    for t in &mut tracks {
        t.file_name = file_name.clone();
    }

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "Radar", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => {
                    eprintln!("[import_radar_file] background save failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("Radar {}: {}", fname, e));
                }
            }
        });
    } else {
        // Batch exists — check for and re-import any tracks deleted since first import
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::append_missing_tracks(&path_clone, &fname, "Radar", &tracks_clone) {
                Ok(added) => {
                    if added > 0 {
                        eprintln!(
                            "[import_radar_file] appended {} missing track(s) to existing batch",
                            added
                        );
                    }
                    let _ = handle.emit("batch-saved", ());
                }
                Err(e) => {
                    eprintln!("[import_radar_file] append missing failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("Radar append {}: {}", fname, e));
                }
            }
        });
    }

    Ok(tracks.into_iter().map(|t| t.to_dto()).collect())
}

#[tauri::command]
async fn import_radar_raw_file(
    app_handle: tauri::AppHandle,
    db_path: tauri::State<'_, DbPath>,
    file_path: String,
) -> Result<Vec<TrackDto>, String> {
    let mut tracks = radar::parse_mat_file_with_source(&app_handle, &file_path, Some("RadarRaw")).await?;

    let db_path_buf = db_path.0.lock().map_err(|e| e.to_string())?.clone();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    for t in &mut tracks {
        t.file_name = file_name.clone();
    }

    if !db::batch_exists(&db_path_buf, &file_name)? {
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::save_batch(&path_clone, &fname, "RadarRaw", &tracks_clone) {
                Ok(_) => { let _ = handle.emit("batch-saved", ()); }
                Err(e) => {
                    eprintln!("[import_radar_raw_file] background save failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("RadarRaw {}: {}", fname, e));
                }
            }
        });
    } else {
        // Batch exists — check for and re-import any tracks deleted since first import
        let tracks_clone = tracks.clone();
        let path_clone = db_path_buf.clone();
        let fname = file_name.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            match db::append_missing_tracks(&path_clone, &fname, "RadarRaw", &tracks_clone) {
                Ok(added) => {
                    if added > 0 {
                        eprintln!(
                            "[import_radar_raw_file] appended {} missing track(s) to existing batch",
                            added
                        );
                    }
                    let _ = handle.emit("batch-saved", ());
                }
                Err(e) => {
                    eprintln!("[import_radar_raw_file] append missing failed: {}", e);
                    let _ = handle.emit("batch-save-failed", format!("RadarRaw append {}: {}", fname, e));
                }
            }
        });
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

// ── Track Management System commands ─────────────────────────────────────

#[tauri::command]
fn query_track_metadata_cmd(
    db_path: tauri::State<'_, DbPath>,
    filter_json: String,
    limit: i64,
    offset: i64,
) -> Result<manage::TrackMetadataResponse, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    let filter: manage::TrackMetaFilter =
        serde_json::from_str(&filter_json).map_err(|e| format!("parse filter: {}", e))?;
    db::query_track_metadata(&path, &filter, limit, offset)
}

#[tauri::command]
fn get_track_statistics_cmd(
    db_path: tauri::State<'_, DbPath>,
) -> Result<manage::TrackStats, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::get_track_statistics(&path)
}

#[tauri::command]
fn get_distinct_options_cmd(
    db_path: tauri::State<'_, DbPath>,
    source: Option<String>,
) -> Result<manage::DistinctOptions, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::get_distinct_options(&path, source.as_deref())
}

#[tauri::command]
fn delete_track_cmd(
    db_path: tauri::State<'_, DbPath>,
    icao_address: String,
    batch_id: i64,
) -> Result<(), String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    db::delete_track(&path, &icao_address, batch_id)
}

#[tauri::command]
fn delete_tracks_bulk_cmd(
    db_path: tauri::State<'_, DbPath>,
    tracks_json: String,
) -> Result<(), String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    let tracks: Vec<(String, i64)> =
        serde_json::from_str(&tracks_json).map_err(|e| format!("parse tracks: {}", e))?;
    db::delete_tracks_bulk(&path, &tracks)
}

#[tauri::command]
fn export_tracks_cmd(
    db_path: tauri::State<'_, DbPath>,
    tracks_json: String,
) -> Result<Vec<Track>, String> {
    let path = db_path.0.lock().map_err(|e| e.to_string())?;
    let tracks: Vec<(String, i64)> =
        serde_json::from_str(&tracks_json).map_err(|e| format!("parse tracks: {}", e))?;
    db::export_tracks(&path, &tracks)
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("write file: {}", e))
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

#[tauri::command]
fn push_splash_log(app: tauri::AppHandle, message: String) -> Result<(), String> {
    let state = app.state::<SplashHandle>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(ref splash) = *guard {
        let escaped = message.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
        splash.eval(&format!("addLog('{}')", escaped))
            .map_err(|e| format!("eval failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn app_ready(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;

    // Close the splash window
    let handle = app.state::<SplashHandle>();
    if let Ok(mut guard) = handle.0.lock() {
        if let Some(splash) = guard.take() {
            splash.close().map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // ① Create main window (hidden until ready)
            let main = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("RadarView")
            .inner_size(1400.0, 900.0)
            .min_inner_size(900.0, 600.0)
            .decorations(false)
            .maximized(true)
            .visible(false)
            .build()
            .expect("Failed to create main window");

            // ② Create splash window — child of main, no taskbar, not closable
            let splash = WebviewWindowBuilder::new(
                &handle,
                "splash",
                WebviewUrl::App("splash.html".into()),
            )
            .inner_size(700.0, 450.0)
            .decorations(false)
            .resizable(false)
            .center()
            .skip_taskbar(true)
            .closable(false)
            .background_color(tauri::window::Color(0x08, 0x0D, 0x16, 255))
            .parent(&main)
            .expect("Failed to set splash parent")
            .build()
            .expect("Failed to create splash window");

            app.manage(SplashHandle(Mutex::new(Some(splash))));

            // Helper: eval log message into splash window
            fn splash_log(app: &tauri::App, msg: &str) {
                let state = app.state::<SplashHandle>();
                let guard = state.0.lock().unwrap();
                if let Some(ref splash) = *guard {
                    let escaped = msg.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
                    let _ = splash.eval(&format!("addLog('{}')", escaped));
                    std::thread::sleep(Duration::from_millis(60));
                }
            }

            splash_log(app, "正在解析资源目录...");

            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to resolve resource directory");

            splash_log(app, &format!("资源目录: {}", resource_dir.display()));
            splash_log(app, "正在扫描 .mbtiles 瓦片文件...");

            init_and_start_tile_server(&resource_dir)
                .expect("Failed to initialize tile server");

            splash_log(app, &format!("瓦片服务已启动 (端口 {})", get_tile_server_port()));
            splash_log(app, "正在解析数据目录...");

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            splash_log(app, &format!("数据目录: {}", data_dir.display()));

            let db_file = db::db_path(&data_dir);

            // Detect version upgrade and reset database if needed
            let current_version = app.package_info().version.to_string();

            match db::check_version_and_reset(&db_file, &current_version) {
                Ok(true) => splash_log(
                    app,
                    &format!("检测到版本更新 (v{})，正在重置数据库...", current_version),
                ),
                Ok(false) => splash_log(
                    app,
                    &format!(
                        "打开数据库: {}",
                        db_file.file_name().unwrap_or_default().to_string_lossy()
                    ),
                ),
                Err(e) => splash_log(app, &format!("版本检查警告: {}", e)),
            }

            splash_log(app, "正在创建 / 检查数据表...");

            db::init_db(&db_file, &current_version).expect("Failed to initialize SQLite database");
            app.manage(DbPath(Mutex::new(db_file)));

            splash_log(app, "数据库初始化完成");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_tile_server_port,
            list_tile_sources,
            set_active_tile_source,
            import_adsb_file,
            import_radar_file,
            import_radar_raw_file,
            load_persisted_tracks,
            load_batch_tracks_cmd,
            get_batches_cmd,
            delete_batch_cmd,
            get_time_range_cmd,
            load_filtered_cmd,
            query_track_metadata_cmd,
            get_track_statistics_cmd,
            get_distinct_options_cmd,
            delete_track_cmd,
            delete_tracks_bulk_cmd,
            export_tracks_cmd,
            save_text_file,
            save_setting,
            load_all_settings,
            push_splash_log,
            app_ready,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
