"""Join mapped amenities to HSL platforms. Run with pyosmium installed and a Uusimaa OSM PBF."""
import argparse
import json
from bisect import bisect_left
from collections import defaultdict
from math import atan2, cos, degrees, hypot, radians
from pathlib import Path

import osmium

DATA = Path(__file__).resolve().parents[1] / "public/data"


def metres(a, b):
    return 111_320 * hypot((a[0] - b[0]) * cos(radians(b[1])), a[1] - b[1])


def curb_bearings(network, mapped):
    """Use only the local directed section of a trip, with the boarding point on its right."""
    candidates = defaultdict(list)
    tracks = {}
    for route in network["routes"].values():
        for pattern in route["patterns"]:
            shape = pattern["shape"]
            line = network["shapes"].get(shape)
            if not line or not pattern.get("stopOffsets"):
                continue
            if shape not in tracks:
                offsets = [0]
                for a, b in zip(line, line[1:]):
                    offsets.append(offsets[-1] + metres(a, b) * (111195 / 111320))
                tracks[shape] = offsets
            offsets = tracks[shape]
            for sid, at in zip(pattern["stops"], pattern["stopOffsets"]):
                if sid not in mapped:
                    continue
                point, info = mapped[sid]
                stop = network["stops"][sid]
                if stop.get("indoorLevel") or stop.get("platform") or info.get("indoor"):
                    continue
                best = None
                for i in range(max(1, bisect_left(offsets, at - 22)),
                               min(len(line), bisect_left(offsets, at + 22) + 1)):
                    a, b = line[i - 1], line[i]
                    sx = 111195 * cos(radians(point[1]))
                    ex, ny = (b[0] - a[0]) * sx, (b[1] - a[1]) * 111195
                    px, py = (point[0] - a[0]) * sx, (point[1] - a[1]) * 111195
                    length = hypot(ex, ny)
                    if length < 0.25:
                        continue
                    t = min(1, max(0, (ex * px + ny * py) / length**2))
                    error = hypot(px - ex * t, py - ny * t)
                    right = (ny * px - ex * py) / length
                    if 0.8 <= right <= 18 and error <= 19:
                        candidate = (error, round(degrees(atan2(ex, ny))) % 360)
                        if best is None or candidate < best:
                            best = candidate
                if best:
                    candidates[sid].append(best)
    for sid, options in candidates.items():
        mapped[sid][1]["bearing"] = min(options)[1]


def load_amenities(pbf, network):
    stops = network["stops"]
    by_code = {s["code"]: (sid, s) for sid, s in stops.items() if s["code"]}
    mapped = {}
    roofs = []
    cells = defaultdict(list)

    def cell(point):
        return (int(point[0] * 2500), int(point[1] * 2500))

    class Survey(osmium.SimpleHandler):
        def node(self, n):
            t = n.tags
            if t.get("public_transport") == "stop_position":
                return
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
            attrs["point"] = pt
            if t.get("indoor") == "yes" or t.get("location") == "underground":
                attrs["indoor"] = True
            if sid not in mapped or metres(pt, stop["coordinate"]) < metres(mapped[sid][0], stop["coordinate"]):
                mapped[sid] = (pt, attrs)

        def way(self, w):
            # Streets already extrudes building-tagged shelters; a second roof would intersect it.
            native = w.tags.get("building", "no") != "no" or w.tags.get("building:part", "no") != "no"
            if w.tags.get("shelter_type") != "public_transport" and w.tags.get("building") not in ("roof", "transportation"):
                return
            if not w.is_closed() or len(w.nodes) < 4:
                return
            ring = [[p.lon, p.lat] for p in w.nodes if p.location.valid()]
            if len(ring) != len(w.nodes) or ring[0] != ring[-1]:
                return
            centre = [sum(p[i] for p in ring[:-1]) / (len(ring) - 1) for i in (0, 1)]
            if max(metres(p, centre) for p in ring) <= 12:
                roofs.append((centre, ring, native))

    Survey().apply_file(str(pbf), locations=True)
    for sid, (pt, _) in mapped.items():
        cells[cell(pt)].append(sid)
    for centre, ring, native in roofs:
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
        if info.get("shelter") and not stops[sid].get("indoorLevel") and not info.get("indoor"):
            if native:
                info["nativeRoof"] = True
            else:
                info.setdefault("roofs", []).append(ring)
    curb_bearings(network, mapped)
    return {sid: attrs for sid, (_, attrs) in sorted(mapped.items())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm_pbf", type=Path)
    args = parser.parse_args()
    result = load_amenities(args.osm_pbf, json.loads((DATA / "network.json").read_text()))
    (DATA / "stop-facilities.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(len(result), "matched boarding points,", sum(len(s.get("roofs", [])) for s in result.values()), "mapped roofs")
