use tauri::AppHandle;
use tauri::Emitter;

use crate::track::{Track, TrackPosition};

/// Emit a progress event to the frontend. Failure is non-fatal.
fn emit_progress(app_handle: &AppHandle, stage: &str, percent: u32) {
    let _ = app_handle.emit(
        "convert-progress",
        serde_json::json!({ "stage": stage, "percent": percent }),
    );
}

/// Convert MATLAB datenum (days since 0000-01-01 00:00:00) to
/// "YYYY-MM-DD HH:MM:SS" string. Returns empty string on invalid input.
fn datenum_to_timestamp(datenum: f64) -> String {
    if datenum <= 0.0 || !datenum.is_finite() {
        return String::new();
    }

    let days = datenum as i64;
    let frac = datenum - (days as f64);

    // MATLAB datenum 1 = 0000-01-01 (year 0 has 366 days in MATLAB)
    // chrono CE ordinal 1 = 0001-01-01
    // → CE ordinal = MATLAB days - 366
    let ce_days = (days - 366) as i32;

    let date = match chrono::NaiveDate::from_num_days_from_ce_opt(ce_days) {
        Some(d) => d,
        None => return String::new(),
    };

    let seconds_in_day = (frac * 86400.0).round() as u64;
    let h = (seconds_in_day / 3600) as u32;
    let m = ((seconds_in_day % 3600) / 60) as u32;
    let s = (seconds_in_day % 60) as u32;

    let time = match chrono::NaiveTime::from_hms_opt(h, m, s) {
        Some(t) => t,
        None => return String::new(),
    };

    chrono::NaiveDateTime::new(date, time)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

pub fn parse_mat_file(app_handle: &AppHandle, file_path: &str) -> Result<Vec<Track>, String> {
    parse_mat_file_with_source(app_handle, file_path, None)
}

pub fn parse_mat_file_with_source(
    app_handle: &AppHandle,
    file_path: &str,
    source_override: Option<&str>,
) -> Result<Vec<Track>, String> {
    emit_progress(app_handle, "loading", 5);

    let mat = matrw::load_matfile(file_path)
        .map_err(|e| format!("无法读取 MAT 文件: {}", e))?;

    emit_progress(app_handle, "parsing", 20);

    let track_list = &mat["trackList"];

    let dims = track_list.dim();
    let num_tracks = if dims.is_empty() {
        return Ok(Vec::new());
    } else if dims.len() >= 2 {
        dims[1]
    } else {
        dims[0]
    };

    // Determine which point list field to read
    let is_raw = source_override.is_some();
    let field_name = if is_raw {
        "asscPointList"
    } else {
        "outputPointList"
    };

    let default_source = match source_override {
        Some("RadarRaw") => "RadarRaw".to_string(),
        _ => "Radar".to_string(),
    };

    let mut tracks: Vec<Track> = Vec::with_capacity(num_tracks);

    for i in 0..num_tracks {
        let track_struct = &track_list[i];

        // All numeric values are stored as f64 (MATLAB default)
        let batch_no = track_struct["BatchNo"].to_f64().unwrap_or(0.0) as i32;
        let flight_type = track_struct["Type"].to_f64().unwrap_or(0.0) as i32;

        let aircraft_type = if flight_type == 1 { "RADAR" } else { "UNKNOWN" };

        let pt_list = &track_struct[field_name];

        let num_pts = match pt_list {
            matrw::MatVariable::StructureArray(_) => {
                let d = pt_list.dim();
                if d.len() >= 2 {
                    d[1]
                } else if d.len() == 1 {
                    d[0]
                } else {
                    0
                }
            }
            _ => 0,
        };

        if num_pts == 0 {
            continue;
        }

        let mut positions = Vec::with_capacity(num_pts);
        for j in 0..num_pts {
            let pt = &pt_list[j];
            let ts = datenum_to_timestamp(pt["time"].to_f64().unwrap_or(0.0));
            let lat = pt["lat"].to_f64().unwrap_or(0.0);
            let lon = pt["lon"].to_f64().unwrap_or(0.0);

            positions.push(TrackPosition {
                latitude: lat,
                longitude: lon,
                altitude: 0.0,
                heading: 0.0,
                ground_speed: 0.0,
                vertical_rate: 0.0,
                timestamp: ts,
            });
        }

        if positions.is_empty() {
            continue;
        }

        let id_prefix = if is_raw { "RAW" } else { "RADAR" };
        let icao_address = format!("{}-{:04}", id_prefix, batch_no);
        let flight_no = format!("TGT-{:04}", batch_no);

        tracks.push(Track {
            icao_address,
            flight_no,
            icao_flight_no: String::new(),
            aircraft_type: aircraft_type.to_string(),
            registration: String::new(),
            airline: String::new(),
            origin: String::new(),
            destination: String::new(),
            source: default_source.clone(),
            positions,
            file_name: String::new(),
        });

        // Emit progress periodically
        if num_tracks > 10 && i % (num_tracks / 10).max(1) == 0 {
            let pct = 20 + ((i as f64 / num_tracks as f64) * 60.0) as u32;
            emit_progress(app_handle, "converting", pct.min(80));
        }
    }

    emit_progress(app_handle, "done", 80);
    Ok(tracks)
}
