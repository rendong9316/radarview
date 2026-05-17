use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use crate::track::{Track, TrackPosition};

pub fn parse_adsb_csv(file_path: &str) -> Result<Vec<Track>, String> {
    let path = PathBuf::from(file_path);
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Group rows by ICAO Address
    let mut groups: BTreeMap<String, Vec<TrackPosition>> = BTreeMap::new();
    let mut metadata: BTreeMap<String, (String, String, String, String, String, String, String)> =
        BTreeMap::new();

    for (line_num, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() < 19 {
            return Err(format!(
                "Line {}: expected 19 fields, got {}",
                line_num + 1,
                fields.len()
            ));
        }

        let icao = fields[0].trim().to_string();
        let lat: f64 = fields[1]
            .trim()
            .parse()
            .map_err(|e| format!("Line {}: invalid latitude: {}", line_num + 1, e))?;
        let lon: f64 = fields[2]
            .trim()
            .parse()
            .map_err(|e| format!("Line {}: invalid longitude: {}", line_num + 1, e))?;
        let heading: f64 = fields[3]
            .trim()
            .parse()
            .unwrap_or(0.0);
        let altitude: f64 = fields[4]
            .trim()
            .parse()
            .unwrap_or(0.0);
        let ground_speed: f64 = fields[5]
            .trim()
            .parse()
            .unwrap_or(0.0);
        // fields[6] reserved
        let timestamp = fields[10].trim().to_string();
        let flight_no = fields[13].trim().to_string();
        let vertical_rate: f64 = fields[15]
            .trim()
            .parse()
            .unwrap_or(0.0);
        let icao_flight_no = fields[16].trim().to_string();
        let airline = fields[18].trim().to_string();
        let aircraft_type = fields[8].trim().to_string();
        let registration = fields[9].trim().to_string();
        let origin = fields[11].trim().to_string();
        let destination = fields[12].trim().to_string();

        groups.entry(icao.clone()).or_default().push(TrackPosition {
            latitude: lat,
            longitude: lon,
            altitude,
            heading,
            ground_speed,
            vertical_rate,
            timestamp: timestamp.clone(),
        });

        metadata
            .entry(icao)
            .or_insert_with(|| {
                (
                    flight_no,
                    icao_flight_no,
                    aircraft_type,
                    registration,
                    airline,
                    origin,
                    destination,
                )
            });
    }

    let mut tracks: Vec<Track> = Vec::new();
    for (icao, mut positions) in groups {
        // Sort positions by timestamp
        positions.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        let (flight_no, icao_flight_no, aircraft_type, registration, airline, origin, destination) =
            metadata.remove(&icao).unwrap_or_default();

        tracks.push(Track {
            icao_address: icao,
            flight_no,
            icao_flight_no,
            aircraft_type,
            registration,
            airline,
            origin,
            destination,
            source: "ADS-B".to_string(),
            positions,
        });
    }

    // Sort tracks by ICAO address for stable output
    tracks.sort_by(|a, b| a.icao_address.cmp(&b.icao_address));

    Ok(tracks)
}
