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

// ── Sync implementation (runs on blocking thread) ─────────────────────

fn parse_mat_sync(
    app_handle: &AppHandle,
    file_path: &str,
    source_override: Option<&str>,
) -> Result<Vec<Track>, String> {
    emit_progress(app_handle, "loading", 5);

    let mat = matrw::load_matfile(file_path)
        .map_err(|e| format!("无法读取 MAT 文件: {}", e))?;

    emit_progress(app_handle, "parsing", 20);

    let track_list = &mat["trackList"];

    let is_single_track_struct = matches!(track_list, matrw::MatVariable::Structure(_));
    let dims = track_list.dim();
    let num_tracks = if is_single_track_struct {
        1
    } else if dims.is_empty() {
        return Ok(Vec::new());
    } else {
        dims.iter().product()
    };

    let is_raw = source_override.is_some();
    let point_list_fields: &[&str] = if is_raw {
        &["asscPointList"]
    } else {
        &["smoothPointList", "outputPointList"]
    };

    let default_source = match source_override {
        Some("RadarRaw") => "RadarRaw".to_string(),
        _ => "Radar".to_string(),
    };

    let id_prefix = if is_raw { "RAW" } else { "RADAR" };

    let mut tracks: Vec<Track> = Vec::with_capacity(num_tracks);

    for i in 0..num_tracks {
        let track_struct = if is_single_track_struct {
            track_list
        } else {
            &track_list[i]
        };

        let batch_no = track_struct["BatchNo"].to_f64().unwrap_or(0.0) as i32;
        let flight_type = track_struct["Type"].to_f64().unwrap_or(0.0) as i32;

        let aircraft_type = if flight_type == 1 { "RADAR" } else { "UNKNOWN" };

        let mut selected_pt_list: Option<(&str, &matrw::MatVariable, usize)> = None;
        for field_name in point_list_fields {
            let candidate = &track_struct[*field_name];
            let num_pts = match candidate {
                matrw::MatVariable::StructureArray(_) => {
                    let d = candidate.dim();
                    if d.is_empty() {
                        0
                    } else {
                        d.iter().product()
                    }
                }
                matrw::MatVariable::Structure(_) => 1,
                _ => 0,
            };
            if num_pts > 0 {
                selected_pt_list = Some((field_name, candidate, num_pts));
                break;
            }
        }

        let Some((_field_name, pt_list, num_pts)) = selected_pt_list else {
            continue;
        };

        if num_pts == 0 {
            continue;
        }

        let mut positions = Vec::with_capacity(num_pts);
        for j in 0..num_pts {
            let pt = &pt_list[j];
            positions.push(TrackPosition {
                latitude: pt["lat"].to_f64().unwrap_or(0.0),
                longitude: pt["lon"].to_f64().unwrap_or(0.0),
                altitude: 0.0,
                heading: 0.0,
                ground_speed: 0.0,
                vertical_rate: 0.0,
                timestamp: datenum_to_timestamp(pt["time"].to_f64().unwrap_or(0.0)),
            });
        }

        if positions.is_empty() {
            continue;
        }

        tracks.push(Track {
            icao_address: format!("{}-{:04}", id_prefix, batch_no),
            flight_no: format!("TGT-{:04}", batch_no),
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

        if num_tracks > 10 && i % (num_tracks / 10).max(1) == 0 {
            let pct = 20 + ((i as f64 / num_tracks as f64) * 60.0) as u32;
            emit_progress(app_handle, "converting", pct.min(80));
        }
    }

    emit_progress(app_handle, "done", 80);
    Ok(tracks)
}

// ── Async wrappers (public API for Tauri commands) ────────────────────

/// Parse a radar MAT file (smooth mode — reads `outputPointList`).
/// Runs on a blocking thread to avoid freezing the UI.
pub async fn parse_mat_file(
    app_handle: &AppHandle,
    file_path: &str,
) -> Result<Vec<Track>, String> {
    parse_mat_file_with_source(app_handle, file_path, None).await
}

/// Parse a radar MAT file with optional source override.
/// `source_override = Some("RadarRaw")` switches to raw mode
/// (reads `asscPointList` instead of `outputPointList`).
/// Runs on a blocking thread to avoid freezing the UI.
pub async fn parse_mat_file_with_source(
    app_handle: &AppHandle,
    file_path: &str,
    source_override: Option<&str>,
) -> Result<Vec<Track>, String> {
    let handle = app_handle.clone();
    let path = file_path.to_string();
    let src = source_override.map(|s| s.to_string());

    tauri::async_runtime::spawn_blocking(move || {
        parse_mat_sync(&handle, &path, src.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
