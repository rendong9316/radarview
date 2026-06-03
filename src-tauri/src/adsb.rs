use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use rayon::prelude::*;

use crate::track::{Track, TrackPosition};

type MetaTuple = (String, String, String, String, String, String, String);

pub fn parse_adsb_csv(file_path: &str) -> Result<Vec<Track>, String> {
    let path = PathBuf::from(file_path);
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Collect non‑empty lines (references into `content`)
    let lines: Vec<&str> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    // ── Phase 1: Parallel fold → each thread builds its own partial map ──
    type GroupMap = BTreeMap<String, Vec<TrackPosition>>;
    type MetaMap = BTreeMap<String, MetaTuple>;

    let (groups, metadata): (GroupMap, MetaMap) = lines
        .par_iter()
        .fold(
            || (GroupMap::new(), MetaMap::new()),
            |(mut g, mut m), line| {
                let fields: Vec<&str> = line.split(',').collect();
                if fields.len() < 19 {
                    return (g, m);
                }

                let icao = fields[0].trim().to_string();
                if icao.is_empty() {
                    return (g, m);
                }

                let pos = TrackPosition {
                    latitude:   fields[1].trim().parse().unwrap_or(0.0),
                    longitude:  fields[2].trim().parse().unwrap_or(0.0),
                    heading:    fields[3].trim().parse().unwrap_or(0.0),
                    altitude:   fields[4].trim().parse().unwrap_or(0.0),
                    ground_speed: fields[5].trim().parse().unwrap_or(0.0),
                    vertical_rate: fields[15].trim().parse().unwrap_or(0.0),
                    timestamp:  fields[10].trim().to_string(),
                };

                g.entry(icao.clone()).or_default().push(pos);
                m.entry(icao).or_insert_with(|| (
                    fields[13].trim().to_string(), // flight_no
                    fields[16].trim().to_string(), // icao_flight_no
                    fields[8].trim().to_string(),  // aircraft_type
                    fields[9].trim().to_string(),  // registration
                    fields[18].trim().to_string(), // airline
                    fields[11].trim().to_string(), // origin
                    fields[12].trim().to_string(), // destination
                ));

                (g, m)
            },
        )
        .reduce(
            || (GroupMap::new(), MetaMap::new()),
            |(mut ga, mut ma), (gb, mb)| {
                for (k, v) in gb {
                    ga.entry(k).or_default().extend(v);
                }
                for (k, v) in mb {
                    if !ma.contains_key(&k) {
                        ma.insert(k, v);
                    }
                }
                (ga, ma)
            },
        );

    // ── Phase 2: Parallel sort positions + assemble Track structs ──
    let mut tracks: Vec<Track> = groups
        .into_par_iter()
        .map(|(icao, mut positions)| {
            positions.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            let meta = metadata.get(&icao).cloned().unwrap_or_default();
            Track {
                icao_address: icao,
                flight_no:      meta.0,
                icao_flight_no: meta.1,
                aircraft_type:  meta.2,
                registration:   meta.3,
                airline:        meta.4,
                origin:         meta.5,
                destination:    meta.6,
                source:         "ADS-B".to_string(),
                positions,
            }
        })
        .collect();

    // Stable sorted output
    tracks.sort_by(|a, b| a.icao_address.cmp(&b.icao_address));
    Ok(tracks)
}
