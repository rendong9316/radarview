"""
Download Natural Earth administrative boundary line data and convert it to
small GeoJSON files that Cesium can load as offline overlay layers.

Usage:
  python scripts/download_natural_earth_boundaries.py
"""

import json
import math
import zipfile
from pathlib import Path

import requests
import shapefile

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TEMP_DIR = SCRIPT_DIR / "temp" / "natural_earth_boundaries"
OUTPUT_DIR = PROJECT_DIR / "public" / "boundaries"

DATASETS = [
    {
        "name": "admin0",
        "url": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_boundary_lines_land.zip",
        "zip": TEMP_DIR / "ne_10m_admin_0_boundary_lines_land.zip",
        "output": OUTPUT_DIR / "admin0.geojson",
        "tolerance": 0.01,
        "properties": ["FEATURECLA", "NAME", "ADM0_A3_L", "ADM0_A3_R"],
    },
    {
        "name": "admin1",
        "url": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces_lines.zip",
        "zip": TEMP_DIR / "ne_10m_admin_1_states_provinces_lines.zip",
        "output": OUTPUT_DIR / "admin1.geojson",
        "tolerance": 0.015,
        "properties": ["FEATURECLA", "NAME", "ADM0_A3_L", "ADM0_A3_R"],
    },
]


def download(url: str, target: Path) -> None:
    if target.exists():
        print(f"[skip] {target.name}")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {url}")
    response = requests.get(url, stream=True, timeout=90)
    response.raise_for_status()
    with target.open("wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)


def extract(zip_path: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(target_dir)

    shp_files = list(target_dir.glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No .shp file found in {target_dir}")
    return shp_files[0]


def perpendicular_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])

    x0, y0 = point
    x1, y1 = start
    x2, y2 = end
    return abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) / math.hypot(y2 - y1, x2 - x1)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points

    max_distance = 0.0
    index = 0
    start = points[0]
    end = points[-1]
    for i in range(1, len(points) - 1):
        distance = perpendicular_distance(points[i], start, end)
        if distance > max_distance:
            index = i
            max_distance = distance

    if max_distance > tolerance:
        left = simplify(points[: index + 1], tolerance)
        right = simplify(points[index:], tolerance)
        return left[:-1] + right

    return [start, end]


def rounded_line(points: list[tuple[float, float]], tolerance: float) -> list[list[float]]:
    simplified = simplify(points, tolerance)
    result: list[list[float]] = []
    previous: list[float] | None = None
    for lon, lat in simplified:
        coord = [round(lon, 4), round(lat, 4)]
        if coord != previous:
            result.append(coord)
            previous = coord
    return result


def shape_parts(shape: shapefile.Shape) -> list[list[tuple[float, float]]]:
    points = [(float(lon), float(lat)) for lon, lat in shape.points]
    part_indexes = list(shape.parts) + [len(points)]
    return [points[start:end] for start, end in zip(part_indexes, part_indexes[1:]) if end - start >= 2]


def convert_to_geojson(shp_path: Path, output_path: Path, property_names: list[str], tolerance: float) -> None:
    reader = shapefile.Reader(str(shp_path), encoding="latin1")
    fields = [field[0] for field in reader.fields[1:]]
    features = []

    for record, shape in zip(reader.records(), reader.shapes()):
        properties = {
            name.lower(): record[fields.index(name)]
            for name in property_names
            if name in fields and record[fields.index(name)] not in ("", None)
        }
        lines = [rounded_line(part, tolerance) for part in shape_parts(shape)]
        lines = [line for line in lines if len(line) >= 2]
        if not lines:
            continue

        geometry = (
            {"type": "LineString", "coordinates": lines[0]}
            if len(lines) == 1
            else {"type": "MultiLineString", "coordinates": lines}
        )
        features.append({"type": "Feature", "properties": properties, "geometry": geometry})

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"[write] {output_path} ({len(features)} features, {size_mb:.2f} MB)")


def main() -> None:
    for dataset in DATASETS:
        download(dataset["url"], dataset["zip"])
        shp_path = extract(dataset["zip"], TEMP_DIR / dataset["name"])
        convert_to_geojson(
            shp_path,
            dataset["output"],
            dataset["properties"],
            dataset["tolerance"],
        )


if __name__ == "__main__":
    main()
