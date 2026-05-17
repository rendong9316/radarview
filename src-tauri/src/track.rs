use serde::{Deserialize, Serialize};

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
