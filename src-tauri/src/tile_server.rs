use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;

use rusqlite::Connection;
use tiny_http::{Header, Method, Response, Server};

static TILE_SERVER_PORT: AtomicU16 = AtomicU16::new(0);

/// Active tile source path. Initialized at startup, switchable at runtime via set_active_tile_source.
static ACTIVE_SOURCE: std::sync::OnceLock<Arc<RwLock<PathBuf>>> = std::sync::OnceLock::new();

/// Full list of available tile sources (file_name → path). Initialized at startup, mutable for rescan.
static TILE_SOURCES: RwLock<Vec<InternalTileSource>> = RwLock::new(Vec::new());

/// Stored scan directories so rescan_tile_sources can re-scan later.
static SCAN_DIRS: std::sync::OnceLock<(PathBuf, PathBuf)> = std::sync::OnceLock::new();

/// Recommended directory for users to place .mbtiles files (resource_dir = install directory).
static RECOMMENDED_TILE_DIR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Cached SQLite connection for the active mbtiles file. Reused across tile requests
/// to avoid per-request Connection::open overhead. Invalidated when source changes.
static TILE_DB_CACHE: Mutex<Option<(PathBuf, Connection)>> = Mutex::new(None);

#[derive(serde::Serialize, Clone)]
pub struct TileSource {
    pub file_name: String,
    pub display_name: String,
    pub max_zoom: u32,
}

#[derive(Clone)]
struct InternalTileSource {
    file_name: String,
    display_name: String,
    path: PathBuf,
    max_zoom: u32,
}

/// Read the maximum zoom level from an .mbtiles file.
/// Returns 8 as a safe default if the query fails.
fn read_max_zoom(path: &PathBuf) -> u32 {
    if let Ok(conn) = Connection::open(path) {
        if let Ok(zoom) = conn.query_row(
            "SELECT MAX(zoom_level) FROM tiles",
            [],
            |row| row.get::<_, Option<u32>>(0),
        ) {
            if let Some(z) = zoom {
                return z;
            }
        }
    }
    8 // safe default
}

fn content_type_png() -> Header {
    Header::from_bytes("Content-Type", "image/png")
        .expect("hardcoded Content-Type header should be valid")
}

fn cors_header() -> Header {
    Header::from_bytes("Access-Control-Allow-Origin", "*")
        .expect("hardcoded CORS header should be valid")
}

fn xyz_to_tms(z: u32, y: u32) -> u32 {
    (1u32 << z) - 1 - y
}

/// Map an .mbtiles file name to a human-friendly display name.
fn tile_display_name(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.contains("natural_earth4") {
        "分层设色地貌".to_string()
    } else if lower.contains("gray_hr") || lower.contains("grey_hr") {
        "灰色地貌".to_string()
    } else {
        "原始高分辨地貌".to_string()
    }
}

/// Scan multiple directories for .mbtiles files, deduplicating by file_name
/// (first directory wins). Each directory's results are sorted with natural_earth
/// preferred before merging.
fn collect_tile_sources(dirs: &[&PathBuf]) -> Vec<InternalTileSource> {
    use std::collections::HashSet;
    let mut seen: HashSet<String> = HashSet::new();
    let mut all: Vec<InternalTileSource> = Vec::new();
    for dir in dirs {
        eprintln!("[tile_server] scanning: {}", dir.display());
        if let Ok(mut dir_sources) = scan_mbtiles_internal(dir) {
            // natural_earth sort within each dir (preserve existing behavior)
            dir_sources.sort_by(|a, b| {
                let a_is_ne = a.file_name.starts_with("natural_earth");
                let b_is_ne = b.file_name.starts_with("natural_earth");
                match (a_is_ne, b_is_ne) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.file_name.cmp(&b.file_name),
                }
            });
            for s in dir_sources {
                if seen.insert(s.file_name.clone()) {
                    all.push(s);
                }
            }
        } else {
            eprintln!("[tile_server] failed to read dir: {}", dir.display());
        }
    }
    all
}

/// Scan the resource directory and app data directory for all .mbtiles files,
/// initialize global state, and start the embedded tile HTTP server.
/// Returns the server port.
///
/// This is the single entry point for lib.rs setup().
/// In dev mode, also scans the src-tauri/ directory as a fallback,
/// since newly added .mbtiles may not have been copied to target/debug/.
pub fn init_and_start_tile_server(
    resource_dir: &PathBuf,
    app_data_dir: &PathBuf,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    eprintln!("[tile_server] scanning resource_dir: {}", resource_dir.display());
    eprintln!("[tile_server] scanning app_data_dir: {}", app_data_dir.display());

    let mut dirs: Vec<&PathBuf> = vec![resource_dir, app_data_dir];

    // Fallback: in dev mode (target/debug or target/release), also scan src-tauri/
    // where newly added .mbtiles files reside before being copied by the build system.
    let mut extra_dirs: Vec<PathBuf> = Vec::new();
    if let Some(parent) = resource_dir.parent() {
        let parent_name = parent
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if parent_name == "target" {
            // resource_dir is .../src-tauri/target/debug → grandparent is src-tauri
            if let Some(grandparent) = parent.parent() {
                eprintln!("[tile_server] fallback scanning grandparent: {}", grandparent.display());
                extra_dirs.push(grandparent.to_path_buf());
            }
        }
    }
    let extra_refs: Vec<&PathBuf> = extra_dirs.iter().collect();
    dirs.extend(&extra_refs);

    let mut sources = collect_tile_sources(&dirs);
    eprintln!("[tile_server] total sources before filter: {:?}", sources.iter().map(|s| &s.file_name).collect::<Vec<_>>());

    sources = filter_prefer_zoom6(sources);
    eprintln!("[tile_server] after filter: {:?}", sources.iter().map(|s| &s.file_name).collect::<Vec<_>>());

    // Store dirs for later re-scan
    let _ = SCAN_DIRS.set((resource_dir.clone(), app_data_dir.clone()));
    let _ = RECOMMENDED_TILE_DIR.set(resource_dir.to_string_lossy().to_string());

    start_tile_server(sources)
}

/// Internal scan returning full path info. Cached into TILE_SOURCES static.
fn scan_mbtiles_internal(base_dir: &PathBuf) -> Result<Vec<InternalTileSource>, String> {
    let mut sources: Vec<InternalTileSource> = Vec::new();
    for entry in std::fs::read_dir(base_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("mbtiles") {
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            let display_name = tile_display_name(&file_name);
            let max_zoom = read_max_zoom(&path);
            sources.push(InternalTileSource {
                file_name,
                display_name,
                path,
                max_zoom,
            });
        }
    }
    // Prefer natural_earth (分层设色) as the default tile source.
    // GRAY_HR sorts before natural_earth alphabetically, so a plain
    // alphabetical sort would make gray the default on every fresh start.
    sources.sort_by(|a, b| {
        let a_is_ne = a.file_name.starts_with("natural_earth");
        let b_is_ne = b.file_name.starts_with("natural_earth");
        match (a_is_ne, b_is_ne) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name.cmp(&b.file_name),
        }
    });
    Ok(sources)
}

/// If both `FOO.mbtiles` and `FOO{N}.mbtiles` exist (where N is a digit),
/// keep only the lower-zoom numbered version, e.g. natural_earth4 over natural_earth,
/// GRAY_HR_SR6 over GRAY_HR_SR.
fn filter_prefer_zoom6(sources: Vec<InternalTileSource>) -> Vec<InternalTileSource> {
    // Group files: if multiple numbered variants exist for the same base,
    // keep only the one with the smallest number. Drop unnumbered counterparts.
    // e.g. natural_earth4, natural_earth5, natural_earth6 → keep only natural_earth4

    use std::collections::HashMap;

    // Find the minimum number for each base name
    let mut min_num: HashMap<String, (u32, String)> = HashMap::new();
    for s in &sources {
        let stem = s.file_name.trim_end_matches(".mbtiles");
        if let Some(last) = stem.chars().last() {
            if last.is_ascii_digit() {
                // Extract the trailing number and base name
                let num_str: String = stem.chars().rev()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .chars().rev()
                    .collect();
                let num: u32 = num_str.parse().unwrap_or(99);
                let base = stem.trim_end_matches(|c: char| c.is_ascii_digit()).to_string();
                let entry = min_num.entry(base).or_insert((99, String::new()));
                if num < entry.0 {
                    entry.0 = num;
                    entry.1 = s.file_name.clone();
                }
            }
        }
    }

    // Collect base names that have numbered variants
    let has_numbered: std::collections::HashSet<String> = min_num.keys().cloned().collect();

    sources
        .into_iter()
        .filter(|s| {
            let stem = s.file_name.trim_end_matches(".mbtiles");
            if let Some(last) = stem.chars().last() {
                if last.is_ascii_digit() {
                    // Keep only the smallest-numbered variant for each base
                    let base = stem.trim_end_matches(|c: char| c.is_ascii_digit()).to_string();
                    if let Some((_, keep_name)) = min_num.get(&base) {
                        return &s.file_name == keep_name;
                    }
                }
            }
            // Drop unnumbered files that have a numbered counterpart
            !has_numbered.contains(stem)
        })
        .collect()
}

fn get_tile_data(mbtiles_path: &PathBuf, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    let mut cache = TILE_DB_CACHE.lock().ok()?;
    // Open a new connection only when path changes; reuse cached one otherwise
    let needs_open = match cache.as_ref() {
        Some((cached_path, _)) => cached_path != mbtiles_path,
        None => true,
    };
    if needs_open {
        let new_conn = Connection::open(mbtiles_path).ok()?;
        *cache = Some((mbtiles_path.clone(), new_conn));
    }
    let conn = &cache.as_ref()?.1;
    let tms_y = xyz_to_tms(z, y);
    let mut stmt = conn
        .prepare("SELECT tile_data FROM tiles WHERE zoom_level=?1 AND tile_column=?2 AND tile_row=?3")
        .ok()?;
    stmt.query_row(rusqlite::params![z, x, tms_y], |row| row.get(0))
        .ok()
}

fn handle_tile_request(request: tiny_http::Request) {
    let url = request.url().to_string();
    let parts: Vec<&str> = url.trim_start_matches('/').split('/').collect();

    if parts.len() < 4 || parts[0] != "tiles" {
        let resp = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    let z: u32 = match parts[1].parse() {
        Ok(v) => v,
        Err(_) => {
            let _ = request.respond(Response::from_string("Bad z").with_status_code(400));
            return;
        }
    };
    let x: u32 = match parts[2].parse() {
        Ok(v) => v,
        Err(_) => {
            let _ = request.respond(Response::from_string("Bad x").with_status_code(400));
            return;
        }
    };
    let y_str = parts[3].trim_end_matches(".png");
    let y: u32 = match y_str.parse() {
        Ok(v) => v,
        Err(_) => {
            let _ = request.respond(Response::from_string("Bad y").with_status_code(400));
            return;
        }
    };

    let mbtiles_path = {
        let arc = ACTIVE_SOURCE
            .get()
            .expect("ACTIVE_SOURCE must be initialized at startup");
        arc.read().unwrap_or_else(|e| e.into_inner()).clone()
    };

    match get_tile_data(&mbtiles_path, z, x, y) {
        Some(data) => {
            let resp = Response::from_data(data)
                .with_header(content_type_png())
                .with_header(cors_header());
            let _ = request.respond(resp);
        }
        None => {
            let resp = Response::from_string("Tile not found").with_status_code(404);
            let _ = request.respond(resp);
        }
    }
}

/// Start the embedded tile HTTP server and initialize global state.
fn start_tile_server(
    sources: Vec<InternalTileSource>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let default_path = if let Some(first) = sources.first() {
        first.path.clone()
    } else {
        eprintln!("[tile_server] WARNING: no tile sources found, tiles will return 404");
        PathBuf::new()
    };

    // Cache the full source list (may be empty on first launch)
    {
        let mut lock = TILE_SOURCES
            .write()
            .map_err(|_| "TILE_SOURCES lock poisoned")?;
        *lock = sources;
    }

    // Set default active source
    init_active_source(default_path);

    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    TILE_SERVER_PORT.store(port, Ordering::SeqCst);
    println!("Tile server started on http://127.0.0.1:{}", port);

    let server = Server::from_listener(listener, None)?;

    thread::spawn(move || {
        for request in server.incoming_requests() {
            if request.method() == &Method::Options {
                let resp = Response::from_string("OK").with_header(cors_header());
                let _ = request.respond(resp);
            } else {
                handle_tile_request(request);
            }
        }
    });

    Ok(port)
}

/// Initialize the active tile source. Called once during startup.
fn init_active_source(path: PathBuf) {
    ACTIVE_SOURCE
        .set(Arc::new(RwLock::new(path)))
        .expect("ACTIVE_SOURCE should only be initialized once");
}

// ── Tauri commands ──

#[tauri::command]
pub fn get_tile_server_port() -> u16 {
    TILE_SERVER_PORT.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn list_tile_sources() -> Result<Vec<TileSource>, String> {
    let internal = TILE_SOURCES
        .read()
        .map_err(|e| format!("lock error: {}", e))?;
    let result: Vec<TileSource> = internal
        .iter()
        .map(|s| TileSource {
            file_name: s.file_name.clone(),
            display_name: s.display_name.clone(),
            max_zoom: s.max_zoom,
        })
        .collect();
    eprintln!("[tile_server] list_tile_sources returning {} sources", result.len());
    Ok(result)
}

#[tauri::command]
pub fn set_active_tile_source(file_name: String) -> Result<(), String> {
    let internal = TILE_SOURCES
        .read()
        .map_err(|e| format!("lock error: {}", e))?;
    if internal.is_empty() {
        return Err("No tile sources available".to_string());
    }
    let found = internal
        .iter()
        .find(|s| s.file_name == file_name)
        .ok_or_else(|| format!("Tile source '{}' not found", file_name))?;
    let mut lock = ACTIVE_SOURCE
        .get()
        .ok_or("Active source not initialized")?
        .write()
        .map_err(|e| format!("lock error: {}", e))?;
    *lock = found.path.clone();
    println!("[tile_server] switched active source to: {}", file_name);
    Ok(())
}

#[tauri::command]
pub fn has_tile_sources() -> bool {
    TILE_SOURCES
        .read()
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_recommended_tile_dir() -> String {
    RECOMMENDED_TILE_DIR
        .get()
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
pub fn rescan_tile_sources() -> Result<Vec<TileSource>, String> {
    let (resource_dir, app_data_dir) = SCAN_DIRS
        .get()
        .ok_or("Scan directories not initialized")?;

    let dirs: Vec<&PathBuf> = vec![resource_dir, app_data_dir];
    let sources = collect_tile_sources(&dirs);
    let sources = filter_prefer_zoom6(sources);

    let result: Vec<TileSource> = sources
        .iter()
        .map(|s| TileSource {
            file_name: s.file_name.clone(),
            display_name: s.display_name.clone(),
            max_zoom: s.max_zoom,
        })
        .collect();

    // Remember first path before moving sources into the lock
    let first_path = sources.first().map(|s| s.path.clone());

    // Update global state
    {
        let mut lock = TILE_SOURCES
            .write()
            .map_err(|e| format!("lock error: {}", e))?;
        *lock = sources;
    }

    // If we now have sources, switch active
    if let Some(path) = first_path {
        let arc = ACTIVE_SOURCE
            .get()
            .ok_or("Active source not initialized")?;
        let mut active = arc.write().map_err(|e| format!("lock error: {}", e))?;
        *active = path;
        eprintln!("[tile_server] rescan: active source set to {}", result[0].file_name);
    }

    eprintln!("[tile_server] rescan: {} sources found", result.len());
    Ok(result)
}
