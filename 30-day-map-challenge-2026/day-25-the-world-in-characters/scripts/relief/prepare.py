"""Build the world plate's relief from the NOAA ETOPO 2022 ice-surface model.

    python3 prepare.py                    # download the CSV from NOAA
    python3 prepare.py --input etopo.csv  # rebuild from previously downloaded data
"""
import argparse
import base64
import csv
import hashlib
import io
import json
import math
import urllib.request
from pathlib import Path


HERE = Path(__file__).resolve().parent
ERDDAP = "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s"
URL = ERDDAP + ".csv?z%5B30:60:10799%5D%5B30:60:21599%5D"
WIDTH, HEIGHT = 360, 180
WEST, NORTH = -179.5 + 1 / 120, 89.5 + 1 / 120
METERS_PER_UNIT = 32


def build(raw):
    records = csv.reader(io.StringIO(raw.decode("ascii")))
    if next(records) != ["latitude", "longitude", "z"] or next(records) != [
        "degrees_north", "degrees_east", "meters"
    ]:
        raise ValueError("Unexpected NOAA CSV format")
    encoded = bytearray(WIDTH * HEIGHT)
    seen = set()
    for row in records:
        lat, lon, meters = map(float, row)
        if not all(map(math.isfinite, [lat, lon, meters])) or meters == -99999:
            raise ValueError(f"Unexpected missing height at {lat} {lon}")
        lon = (lon + 180) % 360 - 180
        x, y = round(lon - WEST), round(NORTH - lat)
        if not (0 <= x < WIDTH and 0 <= y < HEIGHT and
                abs((WEST + x) - lon) < 0.00001 and abs((NORTH - y) - lat) < 0.00001):
            raise ValueError(f"Coordinate off the expected grid: {lat}, {lon}")
        index = y * WIDTH + x
        if index in seen:
            raise ValueError(f"Duplicate NOAA sample at {lat} {lon}")
        seen.add(index)
        encoded[index] = min(255, math.floor(max(0, meters) / METERS_PER_UNIT + 0.5))
    if len(seen) != WIDTH * HEIGHT:
        raise ValueError(f"Only {len(seen)} samples received")
    return {
        "width": WIDTH, "height": HEIGHT, "west": WEST, "north": NORTH, "step": 1,
        "metersPerUnit": METERS_PER_UNIT, "data": base64.b64encode(encoded).decode("ascii"),
        "source": "NOAA NCEI ETOPO 2022 v1, 60 arc-second ice surface, EPSG:3855",
        "sourceUrl": ERDDAP + ".html", "query": URL,
        "csvSha256": hashlib.sha256(raw).hexdigest(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=HERE / "relief.json")
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=90) as response:
            raw = response.read()
    args.output.write_text(json.dumps(build(raw), separators=(",", ":")) + "\n", encoding="utf-8")
