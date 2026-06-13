"""
Download Natural Earth populated places and convert them to a compact
offline GeoJSON city label layer.

Usage:
  python scripts/download_natural_earth_cities.py
"""

import json
import zipfile
from pathlib import Path
from typing import Any

import requests
import shapefile

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TEMP_DIR = SCRIPT_DIR / "temp" / "natural_earth_cities"
OUTPUT_DIR = PROJECT_DIR / "public" / "cities"

DATASET_URLS = [
    "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip",
    "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_populated_places.zip",
]
ZIP_PATH = TEMP_DIR / "ne_10m_populated_places.zip"
OUTPUT_PATH = OUTPUT_DIR / "cities.geojson"

# Keep the offline package focused on cities that are useful at map scale.
MIN_POPULATION = 100_000
MAX_SCALE_RANK = 8


def download(urls: list[str], target: Path) -> None:
    if target.exists():
        print(f"[skip] {target.name}")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in urls:
        try:
            print(f"[download] {url}")
            response = requests.get(url, stream=True, timeout=90)
            response.raise_for_status()
            with target.open("wb") as f:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
            return
        except Exception as exc:
            last_error = exc
            if target.exists():
                target.unlink()
            print(f"[warn] download failed: {exc}")

    raise RuntimeError(f"All download URLs failed: {last_error}")


def extract(zip_path: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(target_dir)

    shp_files = list(target_dir.glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No .shp file found in {target_dir}")
    return shp_files[0]


def first_value(record_map: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = record_map.get(name)
        if value not in ("", None, -99):
            return value
    return None


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def convert_to_geojson(shp_path: Path, output_path: Path) -> None:
    reader = shapefile.Reader(str(shp_path), encoding="utf-8")
    fields = [field[0] for field in reader.fields[1:]]
    features = []

    for record, shape in zip(reader.records(), reader.shapes()):
        record_map = {field: record[i] for i, field in enumerate(fields)}

        pop = to_int(first_value(record_map, "POP_MAX", "POP_MIN", "pop_max", "pop_min"))
        rank = to_int(first_value(record_map, "SCALERANK", "scalerank"), 99)
        is_capital = first_value(record_map, "ADM0CAP", "adm0cap") == 1

        if not is_capital and pop < MIN_POPULATION and rank > MAX_SCALE_RANK:
            continue

        lon = to_float(first_value(record_map, "LONGITUDE", "longitude"))
        lat = to_float(first_value(record_map, "LATITUDE", "latitude"))
        if lon is None or lat is None:
            if not shape.points:
                continue
            lon, lat = shape.points[0]

        name_en = first_value(record_map, "NAME", "NAMEASCII", "name", "nameascii") or ""
        # Natural Earth 10m contains localized name columns in recent releases.
        # Fall back to the English display name if a Chinese label is unavailable.
        name_zh = first_value(
            record_map,
            "NAME_ZH",
            "NAME_ZH_P",
            "NAME_ZH_S",
            "NAME_ZHT",
            "name_zh",
            "name_zht",
        ) or name_en
        country = first_value(record_map, "ADM0NAME", "SOV0NAME", "adm0name", "sov0name") or ""
        feature_class = first_value(record_map, "FEATURECLA", "featurecla") or ""

        features.append({
            "type": "Feature",
            "properties": {
                "name_zh": str(name_zh),
                "name_en": str(name_en),
                "country": str(country),
                "population": pop,
                "rank": rank,
                "capital": bool(is_capital),
                "class": str(feature_class),
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 5), round(float(lat), 5)],
            },
        })

    features.sort(
        key=lambda f: (
            0 if f["properties"]["capital"] else 1,
            f["properties"]["rank"],
            -f["properties"]["population"],
            f["properties"]["name_en"],
        )
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"[write] {output_path} ({len(features)} cities, {size_mb:.2f} MB)")


def main() -> None:
    download(DATASET_URLS, ZIP_PATH)
    shp_path = extract(ZIP_PATH, TEMP_DIR / "populated_places")
    convert_to_geojson(shp_path, OUTPUT_PATH)


if __name__ == "__main__":
    main()
