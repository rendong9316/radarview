use chrono::{FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use serde::ser::SerializeTuple;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackPosition {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: f64,
    pub heading: f64,
    pub ground_speed: f64,
    pub vertical_rate: f64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub icao_address: String,
    pub flight_no: String,
    pub icao_flight_no: String,
    pub aircraft_type: String,
    pub registration: String,
    pub airline: String,
    pub origin: String,
    pub destination: String,
    pub source: String,
    pub positions: Vec<TrackPosition>,
}

// ── Compact IPC DTO — short field names + epoch‑ms timestamps ──────────────

/// Lightweight IPC transfer struct (~46% smaller JSON than raw `Track`)
#[derive(Debug, Clone, Serialize)]
pub struct TrackDto {
    pub id: String,
    pub src: String,
    pub pts: Vec<PtDto>,
    pub min_ts: i64,
    pub max_ts: i64,
    pub cnt: i64,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub flt: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub icao: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub typ: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub reg: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub aln: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub org: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub dst: String,
}

/// Compact position DTO — serialized as JSON array [ts,lat,lng,alt,hdg,gs,vr]
/// instead of an object, saving ~35% field-name overhead per position.
#[derive(Debug, Clone)]
pub struct PtDto {
    pub ts: i64,
    pub lat: f64,
    pub lng: f64,
    pub alt: f64,
    pub hdg: f64,
    pub gs: f64,
    pub vr: f64,
}

impl Serialize for PtDto {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut t = s.serialize_tuple(7)?;
        t.serialize_element(&self.ts)?;
        t.serialize_element(&self.lat)?;
        t.serialize_element(&self.lng)?;
        t.serialize_element(&self.alt)?;
        t.serialize_element(&self.hdg)?;
        t.serialize_element(&self.gs)?;
        t.serialize_element(&self.vr)?;
        t.end()
    }
}

/// Convert a timestamp string like "2024-06-15 08:30:45" or
/// "2024-06-15 08:30:45.123" to epoch milliseconds.
/// Input is assumed to be Beijing local time (UTC+8).
/// Uses byte-index arithmetic (like JS charCode) + chrono constructors —
/// avoids chrono's slow format-string parsing.
pub fn ts_to_ms(s: &str) -> Result<i64, String> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(0);
    }
    let b = s.as_bytes();
    if b.len() < 19 {
        return Err(format!("timestamp too short: '{}'", s));
    }

    let y = (b[0] - b'0') as i32 * 1000
          + (b[1] - b'0') as i32 * 100
          + (b[2] - b'0') as i32 * 10
          + (b[3] - b'0') as i32;
    let mo = (b[5] - b'0') as u32 * 10 + (b[6] - b'0') as u32;
    let d  = (b[8] - b'0') as u32 * 10 + (b[9] - b'0') as u32;
    let h  = (b[11] - b'0') as u32 * 10 + (b[12] - b'0') as u32;
    let mi = (b[14] - b'0') as u32 * 10 + (b[15] - b'0') as u32;
    let sec = (b[17] - b'0') as u32 * 10 + (b[18] - b'0') as u32;

    // Fractional seconds (optional, positions 19+)
    let ms = if b.len() > 19 && b[19] == b'.' {
        let frac_end = b.len().min(23); // take at most 3 fractional digits
        let mut frac = 0u32;
        for &byte in &b[20..frac_end] {
            frac = frac * 10 + (byte - b'0') as u32;
        }
        // Pad to 3 digits
        let digits = (frac_end - 20) as u32;
        frac * 10u32.pow(3 - digits)
    } else {
        0
    };

    let date = NaiveDate::from_ymd_opt(y, mo, d)
        .ok_or_else(|| format!("invalid date in '{}'", s))?;
    let time = NaiveTime::from_hms_milli_opt(h, mi, sec, ms)
        .ok_or_else(|| format!("invalid time in '{}'", s))?;
    let ndt = NaiveDateTime::new(date, time);
    // Interpret as Beijing local time (UTC+8)
    let china_tz = FixedOffset::east_opt(8 * 3600).unwrap();
    match ndt.and_local_timezone(china_tz) {
        chrono::LocalResult::Single(dt) => Ok(dt.timestamp_millis()),
        _ => Err(format!("invalid local time in '{}'", s)),
    }
}

impl Track {
    /// Convert to compact IPC DTO, pre-computing epoch‑ms timestamps
    /// so the frontend can skip `parseTimestamp()` entirely.
    pub fn to_dto(&self) -> TrackDto {
        let mut min_ts = i64::MAX;
        let mut max_ts = i64::MIN;

        let pts: Vec<PtDto> = self
            .positions
            .iter()
            .map(|p| {
                let ts = ts_to_ms(&p.timestamp).unwrap_or(0);
                if ts > 0 {
                    if ts < min_ts { min_ts = ts; }
                    if ts > max_ts { max_ts = ts; }
                }
                PtDto {
                    ts,
                    lat: p.latitude,
                    lng: p.longitude,
                    alt: p.altitude,
                    hdg: p.heading,
                    gs: p.ground_speed,
                    vr: p.vertical_rate,
                }
            })
            .collect();

        if min_ts == i64::MAX { min_ts = 0; }
        if max_ts == i64::MIN { max_ts = 0; }

        TrackDto {
            id: self.icao_address.clone(),
            src: self.source.clone(),
            pts,
            min_ts,
            max_ts,
            cnt: self.positions.len() as i64,
            flt: self.flight_no.clone(),
            icao: self.icao_flight_no.clone(),
            typ: self.aircraft_type.clone(),
            reg: self.registration.clone(),
            aln: self.airline.clone(),
            org: self.origin.clone(),
            dst: self.destination.clone(),
        }
    }
}
