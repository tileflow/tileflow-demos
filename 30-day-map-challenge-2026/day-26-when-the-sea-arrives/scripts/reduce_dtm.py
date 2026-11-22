# Every DeltaDTM tile, reduced to 400 x 400 (1/400 degree, mean) and kept as float16 .npy.
# Tiles in countries where Tileflow Terrain (Mapterhorn) already uses a national bare-earth
# model are skipped: the app keeps Tileflow Terrain there.
import os, sys, threading, queue, time
import numpy as np, geopandas as gpd, rasterio
from rasterio.io import MemoryFile
from rasterio.enums import Resampling
from remotezip import RemoteZip
BASE = "https://data.4tu.nl/file/1da2e70f-6c4d-4b03-86bd-b53e789cc629/"
URLS = {"Asia.zip": "672eba4c-1334-44c6-8119-8879ded25912", "Africa.zip": "22ffa027-184b-4f67-9979-c182f3dfb1ab",
        "South_America.zip": "db980f00-63cd-4a07-a4df-55ab06510594", "North_America.zip": "037664c6-1494-4889-9689-a56570728320",
        "Oceania.zip": "de972de1-26bd-4303-afdf-21a90a232cff", "Europe.zip": "cb0b8ee3-b018-4828-a74e-2fb05020b1b6"}
BARE_EARTH = {"Australia", "Belgium", "Bonaire___Sint_Eustatius_and_Saba", "Canada", "Cyprus", "Denmark", "Estonia", "Faroes",
              "Finland", "France", "Germany", "Greenland", "Iceland", "Italy", "Japan", "Latvia", "Luxembourg", "Netherlands",
              "New_Zealand", "Norway", "Poland", "Portugal", "Puerto_Rico", "Romania", "Saint_Pierre_and_Miquelon", "Slovenia",
              "Spain", "Svalbard_and_Jan_Mayen", "Sweden", "United_Kingdom", "United_States", "Us_Virgin_Islands"}
N = 400
g = gpd.read_file("raw/deltadtm_tiles.gpkg")
g["country"] = g.copernicus.str.split("/").str[2]
g = g[g.zipfile.isin(URLS) & ~g.country.isin(BARE_EARTH)]
print("tiles", len(g), flush=True)
done = 0
lock = threading.Lock()
def open_zip(zipname):
    for attempt in range(8):
        try:
            return RemoteZip(BASE + URLS[zipname])
        except Exception as e:
            print("retry open", zipname, e, flush=True)
            time.sleep(15 * (attempt + 1))
    raise RuntimeError(zipname)
def work(zipname, names):
    global done
    with open_zip(zipname) as z:
        index = {os.path.basename(i.filename): i for i in z.infolist()}
        for name in names:
            out = f"dtm_lr/{name[:-4]}.npy"
            if os.path.exists(out) or name not in index: continue
            data = None
            for attempt in range(8):
                try:
                    data = z.read(index[name])
                    break
                except Exception as e:
                    print("retry", name, e, flush=True)
                    time.sleep(10 * (attempt + 1))
            if data is None: continue
            with MemoryFile(data) as mf, mf.open() as s:
                a = s.read(1, out_shape=(N, N), resampling=Resampling.average, masked=True)
                arr = np.where(a.mask, np.nan, a.filled(np.nan)).astype(np.float16)
            np.save(out, arr)
            with lock:
                done += 1
                if done % 50 == 0: print("done", done, flush=True)
jobs = []
for zipname, grp in g.groupby("zipfile"):
    names = grp.tile.tolist()
    # a few connections per archive
    k = 6 if zipname == "Asia.zip" else 2
    for i in range(k): jobs.append(threading.Thread(target=work, args=(zipname, names[i::k])))
for t in jobs: t.start()
for t in jobs: t.join()
print("finished", done, flush=True)
