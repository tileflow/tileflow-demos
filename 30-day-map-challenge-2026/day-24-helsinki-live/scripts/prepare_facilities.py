"""Join mapped amenities to HSL platforms. Run with pyosmium installed and a Helsinki OSM PBF."""
import argparse
import json
from collections import defaultdict
from math import cos, hypot, radians
from pathlib import Path

import osmium

DATA = Path(__file__).resolve().parents[1] / "public/data"


def metres(a, b):
    return 111_320 * hypot((a[0] - b[0]) * cos(radians(b[1])), a[1] - b[1])


def load_amenities(pbf, stops):
    by_code = {s["code"]: (sid, s) for sid, s in stops.items() if s["code"]}
    mapped = {}
    roofs = []
    cells = defaultdict(list)

    def cell(point):
        return (int(point[0] * 2500), int(point[1] * 2500))

    class Survey(osmium.SimpleHandler):
        def node(self, n):
            t = n.tags
            if t.get("highway") != "bus_stop" and not (t.get("public_transport") == "platform" and t.get("bus") == "yes"):
                return
            item = by_code.get(t.get("ref"))
            if not item:
                return
            sid, stop = item
            pt = [n.location.lon, n.location.lat]
            if metres(pt, stop["coordinate"]) > 35:
                return
            attrs = {k: t[k] == "yes" for k in ("shelter", "bench") if t.get(k) in ("yes", "no")}
            if not attrs:
                return
            if sid not in mapped or metres(pt, stop["coordinate"]) < metres(mapped[sid][0], stop["coordinate"]):
                mapped[sid] = (pt, attrs)

        def way(self, w):
            # Streets already extrudes building-tagged shelters; a second roof would intersect it.
            if w.tags.get("building", "no") != "no" or w.tags.get("building:part", "no") != "no":
                return
            if w.tags.get("shelter_type") != "public_transport" or not w.is_closed() or len(w.nodes) < 4:
                return
            ring = [[p.lon, p.lat] for p in w.nodes if p.location.valid()]
            if len(ring) != len(w.nodes) or ring[0] != ring[-1]:
                return
            centre = [sum(p[i] for p in ring[:-1]) / (len(ring) - 1) for i in (0, 1)]
            if max(metres(p, centre) for p in ring) <= 12:
                roofs.append((centre, ring))

    Survey().apply_file(str(pbf), locations=True)
    for sid, (pt, _) in mapped.items():
        cells[cell(pt)].append(sid)
    for centre, ring in roofs:
        x, y = cell(centre)
        candidates = sorted((metres(centre, mapped[sid][0]), sid)
                            for i in range(x - 1, x + 2) for j in range(y - 1, y + 2)
                            for sid in cells[i, j])
        if not candidates or candidates[0][0] > 10:
            continue
        if len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 4:
            continue
        sid = candidates[0][1]
        info = mapped[sid][1]
        if info.get("shelter") and not stops[sid].get("indoorLevel"):
            info.setdefault("roofs", []).append(ring)
    return {sid: attrs for sid, (_, attrs) in sorted(mapped.items())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm_pbf", type=Path)
    args = parser.parse_args()
    result = load_amenities(args.osm_pbf, json.loads((DATA / "network.json").read_text())["stops"])
    (DATA / "stop-facilities.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(len(result), "platforms with surveyed amenities,", sum(len(s.get("roofs", [])) for s in result.values()), "mapped roofs")
