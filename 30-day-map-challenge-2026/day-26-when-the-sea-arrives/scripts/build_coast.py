# Coastal terrain tiles (z0-9, 256 px, Web Mercator) from the reduced DeltaDTM tiles in dtm_lr/.
# One byte per pixel: round((metres + 10) * 5) for -10..+6 m, 254 above 6 m, 255 no value.
import glob, io, math, os, re, sys
import numpy as np
from PIL import Image
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression
ZMAX, TS, N = 9, 256, 400
src = {}
for p in glob.glob("dtm_lr/*.npy"):
    m = re.search(r"([NS])(\d+)([EW])(\d+)", os.path.basename(p))
    lat = int(m[2]) * (1 if m[1] == "N" else -1)
    lon = int(m[4]) * (1 if m[3] == "E" else -1)
    src[(lat, lon)] = p
print("sources", len(src), flush=True)
cache = {}
def grid(key):
    if key not in cache:
        if len(cache) > 400: cache.clear()
        cache[key] = np.load(src[key]).astype(np.float32)
    return cache[key]
n = 2 ** ZMAX
want = set()
for (lat, lon) in src:
    x0 = int((lon + 180) / 360 * n); x1 = int((lon + 1 + 180) / 360 * n - 1e-9)
    ty = lambda la: int((1 - math.log(math.tan(math.radians(la)) + 1 / math.cos(math.radians(la))) / math.pi) / 2 * n)
    for x in range(x0, min(n - 1, x1) + 1):
        for y in range(max(0, ty(min(lat + 1, 85))), min(n - 1, ty(max(lat, -85))) + 1): want.add((x, y))
print("z9 tiles to check", len(want), flush=True)
level = {}
for k, (x, y) in enumerate(sorted(want, key=lambda t: (t[1], t[0]))):
    lons = (x * TS + np.arange(TS) + 0.5) / (n * TS) * 360 - 180
    py = (y * TS + np.arange(TS) + 0.5) / (n * TS)
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py))))
    e = np.full((TS, TS), np.nan, np.float32)
    lat_f = np.floor(lats).astype(int); lon_f = np.floor(lons).astype(int)
    for la in np.unique(lat_f):
        rows = np.where(lat_f == la)[0]
        r = np.clip(((la + 1 - lats[rows]) * N).astype(int), 0, N - 1)
        for lo in np.unique(lon_f):
            if (la, lo) not in src: continue
            cols = np.where(lon_f == lo)[0]
            c = np.clip(((lons[cols] - lo) * N).astype(int), 0, N - 1)
            e[np.ix_(rows, cols)] = grid((la, lo))[np.ix_(r, c)]
    if np.isfinite(e).any(): level[(x, y)] = e
    if k % 2000 == 0: print("z9", k, len(level), flush=True)
def encode(e):
    v = np.full(e.shape, 255, np.uint8)
    ok = np.isfinite(e)
    v[ok] = np.where(e[ok] > 6, 254, np.clip(np.round((e[ok] + 10) * 5), 0, 253)).astype(np.uint8)
    return v
def webp(v):
    b = io.BytesIO(); Image.fromarray(v, "L").save(b, "WEBP", lossless=True, quality=100, method=5); return b.getvalue()
sizes = {}
with open("coastal-terrain.pmtiles", "wb") as f:
    w = Writer(f)
    out = {}
    for z in range(ZMAX, -1, -1):
        for (x, y), e in level.items():
            out[zxy_to_tileid(z, x, y)] = encode(e)
        print("z", z, len(level), flush=True)
        if z == 0: break
        parent = {}
        for (x, y), e in level.items():
            # above 6 m counts as 7 when averaging; no value stays out
            q = np.where(e > 6, 7, e).reshape(TS // 2, 2, TS // 2, 2)
            with np.errstate(all="ignore"):
                half = np.nanmean(q, axis=(1, 3))
            p = parent.setdefault((x >> 1, y >> 1), np.full((TS, TS), np.nan, np.float32))
            ox, oy = (x & 1) * TS // 2, (y & 1) * TS // 2
            p[oy:oy + TS // 2, ox:ox + TS // 2] = half
        level = parent
    for tid in sorted(out):
        d = webp(out[tid]); w.write_tile(tid, d)
        sizes[tid] = len(d)
    w.finalize({"tile_type": TileType.WEBP, "tile_compression": Compression.NONE, "min_zoom": 0, "max_zoom": ZMAX,
                "min_lon_e7": -1800000000, "min_lat_e7": -850000000, "max_lon_e7": 1800000000, "max_lat_e7": 850000000,
                "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0},
               {"name": "Coastal terrain from DeltaDTM v1.1", "attribution": "DeltaDTM v1.1, Pronk et al. 2024 (CC BY 4.0); Copernicus WorldDEM-30",
                "encoding": "metres = v / 5 - 10; 254 above 6 m; 255 no value"})
print("tiles", len(sizes), "MB", sum(sizes.values()) / 1e6)
