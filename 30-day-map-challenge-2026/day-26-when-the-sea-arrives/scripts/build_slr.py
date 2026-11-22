# AR6 medium-confidence total sea-level change (with vertical land motion) on the 1-degree grid,
# for three scenarios and the 17th/50th/83rd percentiles, as Int16 centimetres:
# [scenario][quantile][year][lat 90..-90][lon -180..179]. Relative to the 1995-2014 mean.
import glob, gzip, json, sys
import h5py, numpy as np
SCEN = ["ssp126", "ssp245", "ssp585"]
QS = [0.17, 0.5, 0.83]
out = None
for si, s in enumerate(SCEN):
    f = h5py.File(glob.glob(f"raw/**/total_{s}_medium_confidence_values.nc", recursive=True)[0])
    lat, lon, loc = f["lat"][:], f["lon"][:], f["locations"][:]
    q = f["quantiles"][:]; yrs = f["years"][:]
    g = loc >= 1_000_000_000
    li = np.round(90 - lat[g]).astype(int); lo = (np.round(lon[g]).astype(int) + 180) % 360
    slc = f["sea_level_change"]
    if out is None:
        out = np.full((len(SCEN), len(QS), len(yrs), 181, 360), -32768, np.int16)
    for qi, qq in enumerate(QS):
        k = int(np.argmin(abs(q - qq))); assert abs(q[k] - qq) < 1e-6, q[k]
        v = slc[k, :, :][:, g].astype(np.float32)
        cm = np.where(v <= -32000, -32768, np.round(v / 10)).astype(np.int16)
        out[si, qi][:, li, lo] = cm
# inland and polar points carry no value: take the nearest one, so interpolation at the coast works
from scipy import ndimage
for si in range(out.shape[0]):
    for qi in range(out.shape[1]):
        for yi in range(out.shape[2]):
            a = out[si, qi, yi]
            m = a == -32768
            if m.any():
                _, (iy, ix) = ndimage.distance_transform_edt(m, return_indices=True)
                out[si, qi, yi] = a[iy, ix]
print("missing", (out == -32768).mean(), "years", list(yrs))
raw = out.tobytes()
print("raw MB", len(raw) / 1e6, "gzip MB", len(gzip.compress(raw, 9)) / 1e6)
d = np.diff(out.astype(np.int32), axis=2, prepend=0).astype(np.int16)
z = gzip.compress(d.tobytes(), 9); open("slr.bin.gz", "wb").write(z)
print("delta gzip MB", len(z) / 1e6)
# check: Valencia, SSP2-4.5 median, 2100
print("Valencia 2100 cm", out[1, 1, 8, 90 - 39, 180 + 0])
json.dump({"scenarios": SCEN, "quantiles": QS, "years": [int(y) for y in yrs], "unit": "cm", "baseline": "1995-2014", "encoding": "int16 delta along years, gzip", "order": "scenario, quantile, year, lat 90..-90, lon -180..179"}, open("slr.json", "w"))
