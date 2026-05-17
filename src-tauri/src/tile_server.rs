use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::thread;

use rusqlite::Connection;
use tiny_http::{Header, Method, Response, Server};

static TILE_SERVER_PORT: AtomicU16 = AtomicU16::new(0);

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

pub fn find_mbtiles(base_dir: &PathBuf) -> Result<PathBuf, String> {
    for entry in std::fs::read_dir(base_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("mbtiles") {
            return Ok(path);
        }
    }
    Err("No .mbtiles file found in resource directory".to_string())
}

fn get_tile_data(mbtiles_path: &PathBuf, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    let conn = Connection::open(mbtiles_path).ok()?;
    let tms_y = xyz_to_tms(z, y);
    let mut stmt = conn
        .prepare("SELECT tile_data FROM tiles WHERE zoom_level=?1 AND tile_column=?2 AND tile_row=?3")
        .ok()?;
    stmt.query_row(rusqlite::params![z, x, tms_y], |row| row.get(0))
        .ok()
}

fn handle_tile_request(request: tiny_http::Request, mbtiles_path: &PathBuf) {
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

    match get_tile_data(mbtiles_path, z, x, y) {
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

pub fn start_tile_server(mbtiles_path: PathBuf) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    TILE_SERVER_PORT.store(port, Ordering::SeqCst);
    println!("Tile server started on http://127.0.0.1:{}", port);

    let server = Server::from_listener(listener, None)?;

    thread::spawn(move || {
        for request in server.incoming_requests() {
            if request.method() == &Method::Options {
                let resp = Response::from_string("OK")
                    .with_header(cors_header());
                let _ = request.respond(resp);
            } else {
                handle_tile_request(request, &mbtiles_path);
            }
        }
    });

    Ok(port)
}

#[tauri::command]
pub fn get_tile_server_port() -> u16 {
    TILE_SERVER_PORT.load(Ordering::SeqCst)
}
