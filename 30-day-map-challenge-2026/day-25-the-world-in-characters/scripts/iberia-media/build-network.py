"""Prepare coastlines, international borders and through roads for the Iberian atlas.

Run from any directory with Python 3 and PyShp. Source archives and hashes originate
in public/detail/natural-earth.json. Coordinates are WGS84, sorted and rounded to 0.001 degree.
"""
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import gzip
import json
import math
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "scripts/world"
OUT = ROOT / "public/detail"
sys.path.insert(0, str(WORLD / "lib"))
import shapefile

BOUNDS = (-35, 18, 24, 62)
# A repeated number in the two countries denotes different roads. These lists
# select routes for display; only the local record provides a road's name.
TRUNKS = {
    "ESP": set("A1 A2 A3 A4 A5 A6 A7 A8 AP1 AP2 AP7 AP8 AP9 A49 A62 A66".split()),
    "PRT": set("A1 A2 A3 A6 A25 A22".split()),
}
CONNECTORS = {
    "ESP": set("A15 A21 A22 A23 A30 A31 A40 A42 A43 A44 A45 A50 A52 A55 A67 A68 A75 A92 AP4 AP6 AP15 AP66 AP68 N120 N330 N634".split()),
    "PRT": set("A4 A7 A8 A13 A23 A24 IP1 IP2 IP3 IP4 IP5 IP8".split()),
}
IBERIAN_ROAD = re.compile(r"^(AP|A|N|IP|IC)(\d+[A-Z]?)$")


def parts(shp):
    starts = [*shp.parts, len(shp.points)]
    for first, end in zip(starts, starts[1:]):
        if end > first + 1:
            yield shp.points[first:end]


def inside(p, ring):
    x, y = p
    hit = False
    a, b = ring[-1]
    for u, v in ring:
        if (b > y) != (v > y) and x < (u - a) * (y - b) / (v - b) + a:
            hit = not hit
        a, b = u, v
    return hit


def crop_segment(first, last):
    # Liang–Barsky line cropping treats the native polygon as a coastline.
    # Clipping polygon interiors would add straight, artificial shorelines.
    x, y = first
    dx, dy = last[0] - x, last[1] - y
    west, south, east, north = BOUNDS
    lo, hi = 0, 1
    for sign, limit in [(-dx, x-west), (dx, east-x), (-dy, y-south), (dy, north-y)]:
        if sign == 0:
            if limit < 0:
                return None
        elif sign < 0:
            lo = max(lo, limit / sign)
        else:
            hi = min(hi, limit / sign)
        if lo >= hi:
            return None
    return ((round(x + lo*dx, 7), round(y + lo*dy, 7)),
            (round(x + hi*dx, 7), round(y + hi*dy, 7)))


def clipped(line):
    result = []
    for a, b in zip(line, line[1:]):
        clipped_segment = crop_segment(a, b)
        if clipped_segment:
            start, end = clipped_segment
            if result and start != result[-1]:
                yield result
                result = []
            if not result:
                result.append(start)
            if end != result[-1]:
                result.append(end)
        elif result:
            yield result
            result = []
    if result:
        yield result


def simplify(line, tolerance):
    keep = {0, len(line)-1}
    stack = [(0, len(line)-1)]
    while stack:
        i, j = stack.pop()
        ax, ay = line[i]
        dx, dy = line[j][0] - ax, line[j][1] - ay
        den = dx*dx + dy*dy
        best, best_index = tolerance*tolerance, None
        for k in range(i+1, j):
            ux, uy = line[k][0]-ax, line[k][1]-ay
            t = max(0, min(1, (ux*dx + uy*dy) / den)) if den else 0
            distance = (ux-t*dx)**2 + (uy-t*dy)**2
            if distance > best:
                best, best_index = distance, k
        if best_index is not None:
            keep.add(best_index)
            stack.extend([(i, best_index), (best_index, j)])
    result = []
    for k in sorted(keep):
        p = tuple(round(n, 3) for n in line[k])
        if not result or p != result[-1]:
            result.append(p)
    return result


def shapes(key):
    return shapefile.Reader(str(WORLD / (key+".zip"))).iterShapeRecords(bbox=BOUNDS)


def traces(key, tolerance):
    result = []
    for feat in shapes(key):
        for line in parts(feat.shape):
            for run in clipped(line):
                arr = simplify(run, tolerance)
                if len(arr) >= 2 and (arr[0] != arr[-1] or len(arr) >= 4):
                    result.append({"arr": arr})
    return result


iberian_shapes = []
for f in shapes("countries"):
    code = f.record.ADM0_A3
    if code in TRUNKS:
        for ring in parts(f.shape):
            xs, ys = zip(*ring)
            iberian_shapes.append((code, (min(xs), min(ys), max(xs), max(ys)), ring))


def iberian_country(line):
    # Classify the reference at the midpoint along the measured geographic path.
    lengths = [math.hypot(b[1]-a[1], (b[0]-a[0])*math.cos(math.radians((a[1]+b[1])/2)))
               for a, b in zip(line, line[1:])]
    remaining = sum(lengths) * .5
    for k, length in enumerate(lengths):
        if length > 0 and remaining <= length:
            ratio = remaining / length
            p = (line[k][0] + ratio*(line[k+1][0]-line[k][0]),
                 line[k][1] + ratio*(line[k+1][1]-line[k][1]))
            for code, (w,s,e,n), ring in iberian_shapes:
                if w <= p[0] <= e and s <= p[1] <= n and inside(p, ring):
                    return code
            return ""
        remaining -= length
    return ""


def classify(record, country):
    raw = str(record.local or "").strip().upper()
    international = str(record.label or "").strip().upper()
    display = raw or international
    if display.startswith("_") or not re.fullmatch(r"[A-Z0-9][A-Z0-9 ./–-]{0,13}", display):
        display = ""
    route = IBERIAN_ROAD.match(display)
    if country == "ESP" and route:
        display = route.group(1) + "-" + route.group(2)
    if record.ignore or "Ferry" in record.type or record.type in ("Trail", "Beltway") or record.level == "U/C":
        return None
    if country and raw in TRUNKS[country]:
        return display, 1
    if country and raw in CONNECTORS[country]:
        return display, 2
    if record.scalerank > 4:
        return None
    if record.type in ("Major Highway", "Secondary Highway") or record.type == "Road" and record.scalerank <= 3:
        if country and raw and not IBERIAN_ROAD.match(raw):
            return None
        # Breaks in local motorway references retain their recorded E-route.
        return display, 1 if (record.scalerank <= 3 and record.type == "Major Highway") else 2
    return None


def joined(lines):
    # Join consecutive records only across unbranched endpoints belonging to
    # the same named road/rank. Never bridge a geographic break in the source.
    edges = defaultdict(list)
    for i, line in enumerate(lines):
        edges[line[0]].append(i)
        edges[line[-1]].append(i)
    unused = set(range(len(lines)))
    def walk(i, p):
        run = []
        while i in unused:
            unused.remove(i)
            piece = lines[i] if lines[i][0] == p else list(reversed(lines[i]))
            run.extend(piece if not run else piece[1:])
            p = run[-1]
            options = [j for j in edges[p] if j in unused]
            if len(edges[p]) != 2 or len(options) != 1:
                break
            i = options[0]
        return run
    for p, neighbors in edges.items():
        if len(neighbors) != 2:
            for i in neighbors:
                if i in unused:
                    yield walk(i, p)
    while unused:
        i = min(unused)
        yield walk(i, lines[i][0])


road_groups = defaultdict(list)
for feat in shapes("roads"):
    for segment in parts(feat.shape):
        for run in clipped(segment):
            if len(run) < 2:
                continue
            country = iberian_country(run)
            road = classify(feat.record, country)
            if road:
                arr = simplify(run, .016)
                if len(arr) >= 2:
                    road_groups[(country, *road)].append(arr)
roads = []
for (_, name, rank), records in sorted(road_groups.items()):
    for arr in (joined(records) if name else records):
        if len(arr) >= 2:
            roads.append({"arr": arr, "name":name, "rank":rank})

files = ["land", "boundaries", "roads", "countries"]
sources = json.loads((OUT/"natural-earth.json").read_text())["meta"]["sources"]
for name in files:
    assert sha256((WORLD/(name+".zip")).read_bytes()).hexdigest() == sources[name]["sha256"]
data = {"coasts":traces("land",.011),"borders":traces("boundaries",.012),"roads":roads}
content = (json.dumps(data, ensure_ascii=False, separators=(",",":"))+"\n").encode()
output = OUT/"iberia-network.json"
output.write_bytes(content)
compressed = gzip.compress(content,compresslevel=9,mtime=0)
output.with_suffix(".json.gz").write_bytes(compressed)
metadata = {"extent":BOUNDS,"coordinates":"Degrees WGS84, [longitude, latitude]",
    "sources":{key:sources[key] for key in files},
    "coastToleranceDegrees":.011,"borderToleranceDegrees":.012,"roadToleranceDegrees":.016,
    "ranks":{"1":"Through motorway or backbone","2":"Regional connector"},
    "records":{key:len(records) for key,records in data.items()},
    "points":{key:sum(len(row["arr"]) for row in records) for key,records in data.items()},
    "bytes":len(content),"gzipBytes":len(compressed)}
(Path(__file__).parent/"network-provenance.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n")
print(metadata["records"],metadata["points"],metadata["bytes"],metadata["gzipBytes"])
