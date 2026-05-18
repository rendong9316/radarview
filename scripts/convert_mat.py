"""Convert MATLAB .mat radar track file to JSON for Rust import.

Reads 'outputPointList' (default) or 'asscPointList' (--mode raw) from each entry in 'trackList'.
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


def mat_to_json(mat_path: str, mode: str = "smooth") -> str:
    data = scipy.io.loadmat(mat_path)

    if "trackList" not in data:
        raise ValueError("No 'trackList' found in .mat file")

    field = "asscPointList" if mode == "raw" else "outputPointList"

    track_list = data["trackList"][0]
    tracks = []

    for i in range(len(track_list)):
        t = track_list[i]
        if field not in t.dtype.names:
            continue
        opl = t[field]
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

        id_prefix = "RAW" if mode == "raw" else "RADAR"
        tracks.append(
            {
                "icao_address": f"{id_prefix}-{batch_no:04d}",
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
    mode = "smooth"
    mat_path = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--mode":
            i += 1
            if i < len(args):
                mode = args[i]
        elif arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        else:
            mat_path = arg
        i += 1

    if mat_path is None:
        print("Usage: python convert_mat.py [--mode raw] <path_to.mat>", file=sys.stderr)
        sys.exit(1)
    try:
        print(mat_to_json(mat_path, mode))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
