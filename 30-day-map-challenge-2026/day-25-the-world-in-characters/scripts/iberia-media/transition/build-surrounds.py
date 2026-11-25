"""Clip the existing Natural Earth atlas linework around the regional sheets.

Run with Python 3 from any directory. Bounds are west, south, east, north in
WGS84. The continental renderer only needs the Atlantic/Europe/Africa area.
"""
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DETAIL = ROOT / "public/detail"
OUTER = (-110, -40, 100, 84)
SHEET = (-35, 18, 24, 62)
RIVER_SHEET = (-12, 30.5, 8.5, 48.5)


def interval(a, b, box):
    """Return the positive-length interval of a real segment inside the box."""
    low, high = 0.0, 1.0
    for i in range(2):
        delta = b[i] - a[i]
        if not delta:
            if not box[i] <= a[i] <= box[i + 2]:
                return None
            continue
        enter = (box[i] - a[i]) / delta
        leave = (box[i + 2] - a[i]) / delta
        low = max(low, min(enter, leave))
        high = min(high, max(enter, leave))
        if high <= low:
            return None
    return low, high


def segment_pieces(a, b, hole):
    if a == b or abs(b[0] - a[0]) >= 180:
        return
    outer = interval(a, b, OUTER)
    if not outer:
        return
    lo, hi = outer
    inside = interval(a, b, hole)
    spans = ((lo, hi),) if not inside else (
        (lo, min(hi, inside[0])), (max(lo, inside[1]), hi)
    )
    for start, stop in spans:
        if start >= stop:
            continue
        ends = [tuple(round(x + t * (y - x), 6) for x, y in zip(a, b))
                for t in (start, stop)]
        if ends[0] != ends[1]:
            yield ends


def runs(path, hole):
    current = []
    for a, b in zip(path, path[1:]):
        for start, stop in segment_pieces(a, b, hole):
            if current and current[-1] != start:
                yield current
                current = []
            if not current:
                current.append(start)
            current.append(stop)
    if current:
        yield current


def main():
    world = json.loads((DETAIL / "natural-earth.json").read_text())
    result = {}
    for layer, source in (("coasts", "land"), ("borders", "boundaries"),
                          ("rivers", "rivers"), ("roads", "roads")):
        result[layer] = []
        for feature in world[source]:
            if isinstance(feature, dict):
                path = feature["path"]
                properties = {"name": feature["name"], "rank": 1}
            else:
                # These are native coastline/border vertices. Never polygon-clip
                # or close clipped fragments, which would paint the crop box.
                path = feature
                properties = {}
            for arr in runs(path, RIVER_SHEET if layer == "rivers" else SHEET):
                result[layer].append({"arr": arr, **properties})
    target = DETAIL / "iberia-surrounds.gz"
    raw = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
    with target.open("wb") as out:
        with gzip.GzipFile(filename="", fileobj=out, mode="wb", mtime=0) as archive:
            archive.write(raw)
    print(target.name, target.stat().st_size, {k: len(v) for k, v in result.items()})


if __name__ == "__main__":
    main()
