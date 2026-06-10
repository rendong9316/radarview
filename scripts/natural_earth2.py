"""
Natural Earth 离线瓦片生成脚本(本地已有压缩包版，纯 Pillow，无需 GDAL)
本地数据源：
  D:\\download_edge\\HYP_HR_SR_W_DR.zip
  D:\\download_edge\\GRAY_HR_SR.zip
输出 mbtiles 存放目录：D:\\Desktop\\RadarView_BiuldByTauri\\src-tauri
输出文件：
  HYP_HR_SR_W_DR.mbtiles
  GRAY_HR_SR.mbtiles

依赖: pip install Pillow

使用:
  python natural_earth2.py
  python natural_earth2.py --max-zoom 6
  python natural_earth2.py --keep-temp
"""
import argparse
import io
import math
import shutil
import sqlite3
import zipfile
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

# ===================== 固定绝对路径配置区 =====================
# 本地两个压缩包路径
SOURCE_ZIPS = [
    {
        "zip_path": Path(r"D:\download_edge\HYP_HR_SR_W_DR.zip"),
        "mbtiles_name": "HYP_HR_SR_W_DR6.mbtiles",
        "map_name": "Natural Earth Hypso Shaded Relief"
    },
    {
        "zip_path": Path(r"D:\download_edge\GRAY_HR_SR.zip"),
        "mbtiles_name": "GRAY_HR_SR6.mbtiles",
        "map_name": "Natural Earth Gray Shaded Relief"
    }
]
# 输出mbtiles目标目录
OUTPUT_ROOT = Path(r"D:\Desktop\RadarView_BiuldByTauri\src-tauri")
# 临时文件夹（脚本同目录temp）
SCRIPT_DIR = Path(__file__).parent
TEMP_DIR = SCRIPT_DIR / "temp"
# 瓦片像素尺寸
TILE_SIZE = 256
# ==========================================================


def load_image_from_local_zip(zip_file: Path) -> Image.Image:
    """从本地已存在的zip包读取tif图片，不再联网下载"""
    if not zip_file.exists():
        raise FileNotFoundError(f"压缩包不存在：{zip_file}")
    print(f"[加载] 读取本地压缩包: {zip_file.name}")
    with zipfile.ZipFile(zip_file, "r") as zf:
        for name in zf.namelist():
            if name.lower().endswith(".tif"):
                with zf.open(name) as f:
                    img = Image.open(io.BytesIO(f.read()))
                    img = img.convert("RGB")
                    print(f"  图像尺寸: {img.width} x {img.height}")
                    return img
    raise FileNotFoundError(f"压缩包 {zip_file.name} 内部未找到 .tif 文件")


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


def generate_single_mbtiles(src_img: Image.Image, max_zoom: int, out_mb: Path, map_title: str) -> None:
    """生成单个mbtiles文件"""
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    if out_mb.exists():
        out_mb.unlink()
        print(f"[覆盖] 删除旧文件: {out_mb.name}")

    conn = sqlite3.connect(str(out_mb))
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
        ("name", map_title),
        ("format", "png"),
        ("minzoom", "0"),
        ("maxzoom", str(max_zoom)),
        ("type", "baselayer"),
        ("description", map_title),
    ]
    conn.executemany("INSERT INTO metadata VALUES (?, ?)", metadata)

    total_tiles = 0

    for z in range(max_zoom + 1):
        n_tiles = 2 ** z
        map_size = n_tiles * TILE_SIZE
        print(f"[切片] zoom {z}: {n_tiles}x{n_tiles} = {n_tiles * n_tiles} 张瓦片, 地图 {map_size}x{map_size}px ...")

        mercator = equirect_to_mercator_row(src_img, map_size, map_size)
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
    size_mb = out_mb.stat().st_size / (1024 * 1024)
    print(f"[完成 {out_mb.name}] 共 {total_tiles} 张瓦片, 文件大小: {size_mb:.1f}MB\n")


def cleanup() -> None:
    print("[清理] 删除临时文件夹 temp...")
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR)
    print("[清理完成]")


def verify_mbtiles(mb_path: Path) -> None:
    print(f"[校验] {mb_path.name}")
    conn = sqlite3.connect(str(mb_path))
    tile_count = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
    print(f"  瓦片总数: {tile_count}")
    z_stat = conn.execute(
        "SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level"
    ).fetchall()
    for z, cnt in z_stat:
        print(f"  zoom {z}: {cnt} 张")
    conn.close()
    print(f"  {mb_path.name} 校验正常\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="本地Natural Earth压缩包批量生成mbtiles")
    parser.add_argument("--max-zoom", type=int, default=8, help="最大缩放层级，默认8")
    parser.add_argument("--keep-temp", action="store_true", help="保留临时文件夹temp")
    args = parser.parse_args()

    print("=" * 60)
    print("批量 Natural Earth MBTiles 生成器（本地压缩包版）")
    print(f"输出目录: {OUTPUT_ROOT}")
    print(f"最大层级: 0 ~ {args.max_zoom}")
    print("=" * 60 + "\n")

    # 循环处理两个数据源
    for item in SOURCE_ZIPS:
        zip_src = item["zip_path"]
        out_file = OUTPUT_ROOT / item["mbtiles_name"]
        map_title = item["map_name"]

        print(f"===== 开始处理: {zip_src.name} → {out_file.name} =====")
        img = load_image_from_local_zip(zip_src)
        generate_single_mbtiles(img, args.max_zoom, out_file, map_title)
        verify_mbtiles(out_file)

    # 清理临时目录
    if not args.keep_temp:
        cleanup()

    print("全部任务执行完毕！")
    print(f"生成文件存放目录：{OUTPUT_ROOT}")
    for item in SOURCE_ZIPS:
        print(f" - {item['mbtiles_name']}")


if __name__ == "__main__":
    main()