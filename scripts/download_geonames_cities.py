"""
Download GeoNames cities5000 and convert it to the offline city label layer.

The output keeps administrative seats globally, not only national capitals:
- capital: PPLC
- regional: PPLA
- prefecture: PPLA2
- major: other populated places above MIN_MAJOR_POPULATION

Usage:
  python scripts/download_geonames_cities.py
"""

from __future__ import annotations

import json
import re
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TEMP_DIR = SCRIPT_DIR / "temp"
OUTPUT_DIR = PROJECT_DIR / "public" / "cities"

DATASET_URL = "http://download.geonames.org/export/dump/cities5000.zip"
ZIP_PATH = TEMP_DIR / "cities5000.zip"
OUTPUT_PATH = OUTPUT_DIR / "cities.geojson"

MIN_MAJOR_POPULATION = 250_000
ADMIN_CODES = {"PPLC", "PPLA", "PPLA2"}
CJK_RE = re.compile(r"[\u3400-\u9fff]")
HAN_ONLY_RE = re.compile(r"^[\u3400-\u9fff·（）() -]+$")
TRADITIONAL_HINTS = {
    "\u9577", "\u5ee3", "\u6771", "\u81fa", "\u7063", "\u9580",
    "\u96f2", "\u967d", "\u9670", "\u9f8d", "\u700b", "\u6fdf",
    "\u912d", "\u6176", "\u5be7", "\u862d", "\u70cf", "\u9f4a",
    "\u723e", "\u6ff1", "\u6a02", "\u8cb4", "\u9435", "\u5ec8",
    "\u611b",
}


def download(target: Path) -> None:
    if target.exists() and zipfile.is_zipfile(target):
        print(f"[skip] {target.name}")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {DATASET_URL}")
    with urllib.request.urlopen(DATASET_URL, timeout=120) as response:
        with target.open("wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)

    if not zipfile.is_zipfile(target):
        raise RuntimeError(f"Downloaded file is not a valid zip: {target}")


def to_int(value: str, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def to_float(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def zh_name(name: str, alternates: str, country_code: str) -> str:
    candidates = [candidate.strip() for candidate in alternates.split(",") if candidate.strip()]
    han_candidates = [candidate for candidate in candidates if CJK_RE.search(candidate) and HAN_ONLY_RE.match(candidate)]
    cjk_candidates = [candidate for candidate in candidates if CJK_RE.search(candidate)]
    pool = han_candidates or cjk_candidates
    if not pool:
        return name

    def score(candidate: str) -> tuple[int, int, int]:
        return (
            1 if candidate.endswith("市") else 0,
            1 if 2 <= len(candidate) <= 5 else 0,
            -sum(1 for char in candidate if char in TRADITIONAL_HINTS),
        )

    best = sorted(pool, key=score, reverse=True)[0]
    if country_code in {"CN", "TW"} and best.endswith("市") and len(best) > 2:
        best = best[:-1]
    return best


def city_level(feature_code: str, population: int) -> str | None:
    if feature_code == "PPLC":
        return "capital"
    if feature_code == "PPLA":
        return "regional"
    if feature_code == "PPLA2":
        return "prefecture"
    if population >= MIN_MAJOR_POPULATION:
        return "major"
    return None


def level_rank(level: str) -> int:
    return {
        "capital": 0,
        "regional": 1,
        "prefecture": 2,
        "major": 3,
    }.get(level, 9)


def convert_to_geojson(zip_path: Path, output_path: Path) -> None:
    features: list[dict[str, Any]] = []

    with zipfile.ZipFile(zip_path, "r") as archive:
        with archive.open("cities5000.txt", "r") as raw:
            for binary_line in raw:
                line = binary_line.decode("utf-8").rstrip("\n")
                parts = line.split("\t")
                if len(parts) < 19:
                    continue

                (
                    geoname_id,
                    name,
                    ascii_name,
                    alternate_names,
                    latitude,
                    longitude,
                    feature_class,
                    feature_code,
                    country_code,
                    cc2,
                    admin1,
                    admin2,
                    admin3,
                    admin4,
                    population_raw,
                    _elevation,
                    _dem,
                    timezone,
                    _modification_date,
                ) = parts[:19]

                if feature_class != "P":
                    continue

                population = to_int(population_raw)
                level = city_level(feature_code, population)
                if level is None:
                    continue

                lon = to_float(longitude)
                lat = to_float(latitude)
                if lon is None or lat is None:
                    continue

                display_en = ascii_name or name
                display_zh = zh_name(name, alternate_names, country_code)
                is_capital = level == "capital"

                features.append({
                    "type": "Feature",
                    "properties": {
                        "id": geoname_id,
                        "name_zh": display_zh,
                        "name_en": display_en,
                        "country": country_code,
                        "country_code": country_code,
                        "population": population,
                        "rank": level_rank(level),
                        "level": level,
                        "feature_code": feature_code,
                        "capital": is_capital,
                        "admin1": admin1,
                        "admin2": admin2,
                        "timezone": timezone,
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(float(lon), 5), round(float(lat), 5)],
                    },
                })

    features.sort(
        key=lambda f: (
            level_rank(str(f["properties"]["level"])),
            -int(f["properties"]["population"]),
            str(f["properties"]["country_code"]),
            str(f["properties"]["name_en"]),
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

    counts: dict[str, int] = {}
    for feature in features:
        level = str(feature["properties"]["level"])
        counts[level] = counts.get(level, 0) + 1

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"[write] {output_path} ({len(features)} cities, {size_mb:.2f} MB)")
    print("[levels] " + ", ".join(f"{key}={counts.get(key, 0)}" for key in ["capital", "regional", "prefecture", "major"]))


def main() -> None:
    download(ZIP_PATH)
    convert_to_geojson(ZIP_PATH, OUTPUT_PATH)


if __name__ == "__main__":
    main()
