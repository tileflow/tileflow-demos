# GHSL GHS-POP 2025 (30 arc-seconds) as Web Mercator raster tiles, z0-7, 256 px, in one PMTiles
# archive. Each pixel is the population density, log-encoded in one byte:
#   v = round(log1p(density per km2) / log1p(MAX) * 255), so density = expm1(v / 255 * log1p(MAX)).
import io, math, sys
import numpy as np, rasterio
from PIL import Image
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

MAX = 150000.0
ZMAX = 7
SRC = "raw/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif"
src = rasterio.open(SRC)
W, H = src.width, src.height
t = src.transform
lon0, dlon, lat0, dlat = t.c, t.a, t.f, t.e  # dlat < 0
print(W, H, lon0, lat0, dlon, dlat, src.nodata, flush=True)

R = 6371.0088
def cell_km2(lat):
    # area of one 30" cell at latitude lat (deg)
    return (math.radians(dlon) * R) * (math.radians(-dlat) * R) * math.cos(math.radians(lat))

# only the coastal strip is ever counted (the sea reaches nowhere else): population further than
# COAST_KM from the sea is left out, which keeps the archive small
COAST_KM = 120
import geopandas as gpd
from rasterio import features
from rasterio.transform import from_origin
from scipy import ndimage
RES = 1 / 30
land = gpd.read_file("raw/ne/ne_10m_land.shp")
mask_t = from_origin(-180, 90, RES, RES)
landmask = features.rasterize(((g, 1) for g in land.geometry), out_shape=(int(180 / RES), int(360 / RES)), transform=mask_t, fill=0, dtype="uint8").astype(bool)
km_per_px = RES * 111.32
coast_dist = ndimage.distance_transform_edt(landmask) * km_per_px
near = coast_dist <= COAST_KM
print("coastal share of land", near[landmask].mean(), flush=True)
mask_cols = np.clip(((np.arange(43200) + 0.5) / 43200 * 360 / RES).astype(np.int64), 0, near.shape[1] - 1)

N = 2 ** ZMAX
TS = 256
SS = 2  # supersampling per target pixel and axis
tiles = {}
cols = (np.arange(N * TS * SS) + 0.5) / (N * TS * SS) * 360 - 180
src_col = np.clip(((cols - lon0) / dlon).astype(np.int64), 0, W - 1)
for ty in range(N):
    py = (ty * TS * SS + np.arange(TS * SS) + 0.5) / (N * TS * SS)
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py))))
    src_row = ((lat - lat0) / dlat).astype(np.int64)
    ok = (src_row >= 0) & (src_row < H)
    if not ok.any():
        continue
    r0, r1 = src_row[ok].min(), src_row[ok].max() + 1
    block = src.read(1, window=((r0, r1), (0, W))).astype(np.float32)
    block[~np.isfinite(block) | (block < 0)] = 0
    area = np.array([cell_km2(lat0 + (r + 0.5) * dlat) for r in range(r0, r1)], np.float32)
    dens = block / np.maximum(area[:, None], 1e-6)
    rows = np.where(ok, src_row - r0, 0)
    sampled = dens[rows][:, src_col]  # (TS*SS, N*TS*SS)
    sampled[~ok] = 0
    mrow = np.clip(((90 - lat) / RES).astype(np.int64), 0, near.shape[0] - 1)
    keep = near[mrow][:, np.clip(((cols + 180) / RES).astype(np.int64), 0, near.shape[1] - 1)]
    sampled[~keep] = 0
    full = sampled.reshape(TS, SS, N * TS, SS).mean(axis=(1, 3))
    for tx in range(N):
        tile = full[:, tx * TS:(tx + 1) * TS]
        if tile.max() > 0.05:
            tiles[(ZMAX, tx, ty)] = tile.astype(np.float32)
    if ty % 16 == 0:
        print("row", ty, "tiles", len(tiles), flush=True)

for z in range(ZMAX - 1, -1, -1):
    parents = {}
    for (cz, x, y), tile in tiles.items():
        if cz != z + 1:
            continue
        p = parents.setdefault((z, x >> 1, y >> 1), np.zeros((TS, TS), np.float32))
        half = tile.reshape(TS // 2, 2, TS // 2, 2).mean(axis=(1, 3))
        ox, oy = (x & 1) * TS // 2, (y & 1) * TS // 2
        p[oy:oy + TS // 2, ox:ox + TS // 2] = half
    tiles.update(parents)

    print("z", z, len(parents), flush=True)

def encode(tile):
    v = np.round(np.log1p(np.minimum(tile, MAX)) / math.log1p(MAX) * 255).astype(np.uint8)
    b = io.BytesIO()
    Image.fromarray(v, "L").save(b, "WEBP", lossless=True, quality=100, method=6)
    return b.getvalue()

total = 0
with open("population.pmtiles", "wb") as f:
    w = Writer(f)
    for (z, x, y) in sorted(tiles, key=lambda k: zxy_to_tileid(*k)):
        data = encode(tiles[(z, x, y)])
        total += len(data)
        w.write_tile(zxy_to_tileid(z, x, y), data)
    w.finalize(
        {"tile_type": TileType.WEBP, "tile_compression": Compression.NONE, "min_zoom": 0, "max_zoom": ZMAX,
         "min_lon_e7": -1800000000, "min_lat_e7": -850000000, "max_lon_e7": 1800000000, "max_lat_e7": 850000000,
         "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0},
        {"name": "GHS-POP 2025 density", "attribution": "GHS-POP R2023A, European Commission JRC (CC BY 4.0)",
         "encoding": f"density per km2 = expm1(v / 255 * log1p({MAX:g}))"},
    )
print("tiles", len(tiles), "MB", total / 1e6)
for z in range(ZMAX + 1):
    print(z, sum(len(encode(t)) for k, t in tiles.items() if k[0] == z) / 1e6)
