# High-water lines above mean sea level from GTSM-ERA5-E (Deltares, CC BY 4.0) on a 0.25-degree
# grid: layer 0 the level exceeded 5 % of the time (a high tide), layer 1 the 1-in-1-year still water
# level (tide plus surge). Each grid point takes an inverse-distance mean of the four nearest model
# points; inland points take the coast's values, so interpolation at the shore never fades to zero.
# Output: Int16 centimetres [layer][lat 90..-90 (721)][lon -180..179.75 (1440)], gzip.
import gzip
import h5py, numpy as np
from scipy.spatial import cKDTree
f = h5py.File("raw/gtsm-era5-e-stats.nc")
def coord(name):
    v = f[name]
    return v[:] * v.attrs.get("scale_factor", 1.0) + v.attrs.get("add_offset", 0.0)
lon, lat = coord("lon"), coord("lat")
print("lon", lon.min(), lon.max(), "lat", lat.min(), lat.max())
q = list(f["quantile"][:]).index(0.95)
rp = list(f["return_period"][:]).index(1)
layers = [f["wl_quantiles"][q, :], f["wl_extreme_bestfit"][:, rp]]
def xyz(lo, la):
    lo, la = np.radians(lo), np.radians(la)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
glat = 90 - np.arange(721) * 0.25
glon = -180 + np.arange(1440) * 0.25
GL, GA = np.meshgrid(glon, glat)
out = np.zeros((2, 721, 1440), np.int16)
for k, vals in enumerate(layers):
    ok = np.isfinite(vals)
    tree = cKDTree(xyz(lon[ok], lat[ok]))
    d, i = tree.query(xyz(GL.ravel(), GA.ravel()), k=4)
    w = 1 / np.maximum(d, 1e-6) ** 2
    v = (vals[ok][i] * w).sum(1) / w.sum(1)
    out[k] = np.round(v.reshape(721, 1440) * 100).astype(np.int16)
    print(k, np.percentile(vals[ok], [5, 50, 95]).round(2))
for name, (la, lo) in {"Miami": (25.77, -80.13), "Alexandria": (31.2, 29.9), "Mekong mouth": (9.5, 106.6), "Chittagong": (22.2, 91.8), "Venice": (45.4, 12.4), "IJmuiden": (52.46, 4.6)}.items():
    r, c = int(round((90 - la) * 4)), int(round((lo + 180) * 4))
    print(name, out[0, r, c], out[1, r, c])
open("water-lines.bin", "wb").write(gzip.compress(out.tobytes(), 9))
import os; print("MB", os.path.getsize("water-lines.bin") / 1e6)
