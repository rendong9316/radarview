"""
Natural Earth 离线瓦片生成脚本 (纯 Pillow，无需 GDAL)

依赖: pip install requests Pillow

使用:
  python download_natural_earth.py
  python download_natural_earth.py --max-zoom 6
  python download_natural_earth.py --keep-temp
"""

import argparse
import io
import math
import shutil
import sqlite3
import zipfile
from pathlib import Path

import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TILES_DIR = PROJECT_DIR / "tiles"
TEMP_DIR = SCRIPT_DIR / "temp"

NE_URL = "https://naciscdn.org/naturalearth/10m/raster/NE1_HR_LC_SR_W_DR.zip"
NE_ZIP = TEMP_DIR / "NE1_HR_LC_SR_W_DR.zip"
MBTILES_PATH = TILES_DIR / "natural_earth.mbtiles"

TILE_SIZE = 256


def download_natural_earth() -> None:
    if NE_ZIP.exists():
        print(f"[跳过] 已存在: {NE_ZIP}")
        return

    print("[下载] Natural Earth 栅格数据...")
    print(f"  URL: {NE_URL}")
    print("  文件约 270MB，请耐心等待")

    resp = requests.get(NE_URL, stream=True, timeout=60)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    with open(NE_ZIP, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
            downloaded += len(chunk)
            if total > 0:
                pct = downloaded * 100 // total
                mb = downloaded // (1024 * 1024)
                print(f"\r  进度: {pct}% ({mb}MB)", end="", flush=True)
    print("\n[完成] 下载完成")


def load_image_from_zip() -> Image.Image:
    print("[加载] 从 zip 读取栅格图...")
    with zipfile.ZipFile(NE_ZIP, "r") as zf:
        for name in zf.namelist():
            if name.lower().endswith(".tif"):
                with zf.open(name) as f:
                    img = Image.open(io.BytesIO(f.read()))
                    img = img.convert("RGB")
                    print(f"  图像尺寸: {img.width} x {img.height}")
                    return img
    raise FileNotFoundError("zip 中未找到 .tif 文件")


def equirect_to_mercator_row(src_img: Image.Image, map_width: int, map_height: int) -> Image.Image:
    """将等经纬度投影图转换为 Web Mercator 投影，按行映射"""
    src_w, src_h = src_img.size
    # 先水平缩放到目标宽度
    stretched = src_img.resize((map_width, src_h), Image.BILINEAR)

    mercator = Image.new("RGB", (map_width, map_height))

    for dst_y in range(map_height):
        # dst_y → Mercator 纬度
        lat = math.degrees(
            math.atan(math.sinh(math.pi * (1 - 2 * dst_y / map_height)))
        )
        # 纬度 → 源图 y (等经纬度: 90°=top, -90°=bottom)
        src_y = (90.0 - lat) / 180.0 * src_h
        src_y = max(0, min(int(src_y), src_h - 1))

        row = stretched.crop((0, src_y, map_width, src_y + 1))
        mercator.paste(row, (0, dst_y))

    return mercator


def generate_mbtiles(img: Image.Image, max_zoom: int) -> None:
    TILES_DIR.mkdir(parents=True, exist_ok=True)

    if MBTILES_PATH.exists():
        MBTILES_PATH.unlink()

    conn = sqlite3.connect(str(MBTILES_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
    conn.execute(
        "CREATE TABLE tiles ("
        "zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX idx_tiles ON tiles (zoom_level, tile_column, tile_row)"
    )

    metadata = [
        ("name", "Natural Earth"),
        ("format", "png"),
        ("minzoom", "0"),
        ("maxzoom", str(max_zoom)),
        ("type", "baselayer"),
        ("description", "Natural Earth I with Shaded Relief, Water, and Drainages"),
    ]
    conn.executemany("INSERT INTO metadata VALUES (?, ?)", metadata)

    total_tiles = 0

    for z in range(max_zoom + 1):
        n_tiles = 2 ** z
        map_size = n_tiles * TILE_SIZE

        print(f"[切片] zoom {z}: {n_tiles}x{n_tiles} = {n_tiles * n_tiles} 张瓦片, 地图 {map_size}x{map_size}px ...")

        # 将源图转为当前 zoom 级别的 Mercator 投影图
        mercator = equirect_to_mercator_row(img, map_size, map_size)

        zoom_tiles = 0
        for tx in range(n_tiles):
            for ty in range(n_tiles):
                x1 = tx * TILE_SIZE
                y1 = ty * TILE_SIZE
                tile_img = mercator.crop((x1, y1, x1 + TILE_SIZE, y1 + TILE_SIZE))

                buf = io.BytesIO()
                tile_img.save(buf, format="PNG")
                tile_data = buf.getvalue()

                tms_y = (2 ** z - 1) - ty
                conn.execute(
                    "INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)",
                    (z, tx, tms_y, tile_data),
                )
                zoom_tiles += 1

        total_tiles += zoom_tiles
        conn.commit()
        print(f"  zoom {z}: {zoom_tiles} 张完成")

        del mercator

    conn.close()
    size_mb = MBTILES_PATH.stat().st_size / (1024 * 1024)
    print(f"[完成] 共 {total_tiles} 张瓦片, 文件大小: {size_mb:.1f}MB")


def cleanup() -> None:
    print("[清理] 删除临时文件...")
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR)
    print("[完成] 清理完毕")


def verify() -> None:
    print("[验证] 检查 MBTiles...")
    conn = sqlite3.connect(str(MBTILES_PATH))

    row = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()
    print(f"  瓦片总数: {row[0]}")

    rows = conn.execute(
        "SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level"
    ).fetchall()
    for z, count in rows:
        print(f"  zoom {z}: {count} 张")

    conn.close()
    print("[验证] MBTiles 文件正常")


def main() -> None:
    parser = argparse.ArgumentParser(description="Natural Earth 离线瓦片生成")
    parser.add_argument("--max-zoom", type=int, default=8, help="最大 zoom 级别 (默认 8)")
    parser.add_argument("--keep-temp", action="store_true", help="保留临时文件")
    args = parser.parse_args()

    print("=" * 50)
    print("Natural Earth 离线瓦片生成工具")
    print(f"目标: zoom 0-{args.max_zoom}")
    print(f"输出: {MBTILES_PATH}")
    print("=" * 50)

    download_natural_earth()
    img = load_image_from_zip()

    print(f"[信息] 源图加载完成，开始切片...")
    generate_mbtiles(img, args.max_zoom)

    if not args.keep_temp:
        cleanup()

    verify()
    print(f"\n全部完成! MBTiles 文件位于:\n  {MBTILES_PATH}")


if __name__ == "__main__":
    main()
