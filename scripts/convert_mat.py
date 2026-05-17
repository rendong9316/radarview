"""Convert MATLAB .mat radar track file to JSON for Rust import.

Reads 'outputPointList' from each entry in 'trackList'.
Timestamps are MATLAB datenum floats → "YYYY-MM-DD HH:MM:SS".
"""
import sys
import json
from datetime import datetime, timedelta

import numpy as np
import scipy.io


def datenum_to_str(dn: float) -> str:
    try:
        dt = datetime.fromordinal(int(dn)) + timedelta(days=dn % 1) - timedelta(days=366)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, OverflowError):
        return ""


def mat_to_json(mat_path: str) -> str:
    data = scipy.io.loadmat(mat_path)

    if "trackList" not in data:
        raise ValueError("No 'trackList' found in .mat file")

    track_list = data["trackList"][0]
    tracks = []

    for i in range(len(track_list)):
        t = track_list[i]
        opl = t["outputPointList"]
        if opl.size == 0 or opl.shape[1] == 0:
            continue

        points = opl[0]
        batch_no = int(t["BatchNo"].flat[0])
        flight_type = int(t["Type"].flat[0])

        positions = []
        for j in range(len(points)):
            pt = points[j]
            ts = datenum_to_str(float(pt["time"].flat[0]))
            lat = float(pt["lat"].flat[0])
            lon = float(pt["lon"].flat[0])
            positions.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "altitude": 0.0,
                    "heading": 0.0,
                    "ground_speed": 0.0,
                    "vertical_rate": 0.0,
                    "timestamp": ts,
                }
            )

        if not positions:
            continue

        tracks.append(
            {
                "icao_address": f"RADAR-{batch_no:04d}",
                "flight_no": f"TGT-{batch_no:04d}",
                "icao_flight_no": "",
                "aircraft_type": "RADAR" if flight_type == 1 else "UNKNOWN",
                "registration": "",
                "airline": "",
                "origin": "",
                "destination": "",
                "source": "Radar",
                "positions": positions,
            }
        )

    return json.dumps(tracks, ensure_ascii=False)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert_mat.py <path_to.mat>", file=sys.stderr)
        sys.exit(1)
    try:
        print(mat_to_json(sys.argv[1]))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
