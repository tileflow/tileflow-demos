"""Match HSL approaches and exits to directed OpenStreetMap roundabouts during catalogue preparation."""
import json
import math
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring
from shapely.strtree import STRtree

# Fixed local projection for spatial queries. Published stop offsets are measured separately in WGS84.
X, Y = 111195 * math.cos(math.radians(60.25)), 111195
ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
         "living_street", "service", "road", "busway", "bus_guideway"}


def local(pt):
    return (pt[0] - 25) * X, (pt[1] - 60) * Y


def geographic(pt):
    return [round(pt[0] / X + 25, 7), round(pt[1] / Y + 60, 7)]


def drivable(tags):
    return (tags.get("highway", "").removesuffix("_link") in ROADS
            and (tags.get("access") not in ("no", "private") or tags.get("bus") in ("yes", "designated")))


def direction(tags):
    one = tags.get("oneway", "")
    return -1 if one == "-1" else 1 if one in ("yes", "1", "true") or (not one and tags.get("junction") == "roundabout") else 0


def survey(pbf):
    """Join split ring ways by node ID. Arms retain allowed travel directions and their actual geometry."""
    import osmium

    point, following, previous = {}, defaultdict(set), defaultdict(set)

    class Rings(osmium.SimpleHandler):
        def way(self, way):
            if way.tags.get("junction") not in ("roundabout", "circular") or not drivable(way.tags):
                return
            travel = direction(way.tags)
            if not travel or not all(n.location.valid() for n in way.nodes):
                return
            ids = [n.ref for n in way.nodes][::travel]
            point.update((n.ref, [n.lon, n.lat]) for n in way.nodes)
            for a, b in zip(ids, ids[1:]):
                if a != b:
                    following[a].add(b)
                    previous[b].add(a)

    Rings().apply_file(str(pbf), locations=True)
    arms = defaultdict(list)
    bypasses = []

    class Connections(osmium.SimpleHandler):
        def way(self, way):
            if way.tags.get("junction") in ("roundabout", "circular") or not drivable(way.tags):
                return
            nodes = way.nodes
            touches = [i for i, n in enumerate(nodes) if n.ref in point]
            separated = way.tags.get("bridge", "no") != "no" or way.tags.get("tunnel", "no") != "no"
            if not (touches or separated) or not all(n.location.valid() for n in nodes):
                return
            coords = [local((n.lon, n.lat)) for n in nodes]
            if len(coords) < 2:
                return
            if separated or len(touches) > 1:
                bypasses.append(LineString(coords))
            travel = direction(way.tags)
            for i in touches:
                for step in (-1, 1):
                    indices = range(i, len(nodes) if step == 1 else -1, step)
                    side = []
                    for j in indices:
                        side.append(coords[j])
                        if j != i and (nodes[j].ref in point or math.dist(side[0], side[-1]) >= 27):
                            break
                    if len(side) >= 2:
                        seg = LineString(side)
                        if seg.length > 3:
                            arms[nodes[i].ref].append((0 if not travel else travel * step,
                                                     substring(seg, 0, min(27, seg.length))))
    Connections().apply_file(str(pbf), locations=True)
    bypass_index = STRtree(bypasses)
    rings = []
    visited = set()
    for start in sorted(point):
        if start in visited:
            continue
        ids, n = [], start
        while n not in visited and len(following[n]) == 1 and len(previous[n]) == 1:
            ids.append(n)
            visited.add(n)
            n = next(iter(following[n]))
        if n != start or len(ids) < 3:
            continue
        ring = [point[n] for n in ids]
        polygon = Polygon([local(p) for p in ring])
        if not polygon.is_valid or polygon.area < 9:
            continue
        gates = [[i, travel, [geographic(p) for p in line.coords]] for i, n in enumerate(ids)
                 for travel, line in arms[n] if not polygon.contains(line.interpolate(min(6, line.length)))]
        if len(gates) < 2:
            continue
        inside = polygon.buffer(-2)
        crossing = []
        for j in bypass_index.query(inside, predicate="intersects"):
            for cut in line_parts(bypasses[j].intersection(polygon.buffer(6))):
                if cut.length >= 4:
                    crossing.append([geographic(p) for p in cut.coords])
        rings.append([ring, gates, crossing])
    return rings


def line_parts(geom):
    if geom.geom_type == "LineString" and not geom.is_empty:
        yield geom
    elif hasattr(geom, "geoms"):
        for part in geom.geoms:
            yield from line_parts(part)


def running_lengths(points, measure=math.dist):
    out = [0.]
    for a, b in zip(points, points[1:]):
        out.append(out[-1] + measure(a, b))
    return out


def read_ring(record):
    coords, gates, bypass = record
    ring = [local(p) for p in coords]
    polygon = Polygon(ring)
    return (ring, polygon, polygon.buffer(7),
            [(i, sign, LineString([local(p) for p in pts])) for i, sign, pts in gates],
            [LineString([local(p) for p in pts]) for pts in bypass])


def gate_match(gates, on_edge, outside, entering):
    choices = []
    for i, sign, arm in gates:
        if sign == (1 if entering else -1):
            continue
        at = arm.project(on_edge)
        near_error, far_error = arm.distance(on_edge), arm.distance(outside)
        if near_error > 11 or far_error > 14:
            continue
        # Divided approaches can put the two one-way arms either side of an
        # undivided GTFS centreline. Check outgoing direction even on a short OSM way.
        back = arm.interpolate(max(0, at - 4))
        front = arm.interpolate(min(arm.length, at + 4))
        dx, dy = front.x - back.x, front.y - back.y
        span = math.hypot(dx, dy)
        advance = ((outside.x - on_edge.x) * dx + (outside.y - on_edge.y) * dy) / (span or 1)
        if advance < 3.2:
            continue
        choices.append((near_error + far_error + max(0, 7 - advance), i, arm, at))
    choices.sort(key=lambda v: v[0])
    if not choices:
        return None
    best = choices[0]
    if any(i != best[1] and score < best[0] + (3.5 if best[0] > 10 else 1.5) for score, i, _, _ in choices[1:]):
        return None
    return best[1:]


def contact_intervals(segments, tree, offsets, area):
    # Preserve multiple visits to the same circle and intersections between two sparse GTFS vertices.
    intervals = []
    for i in sorted(tree.query(area, predicate="intersects")):
        segment = segments[i]
        for part in line_parts(segment.intersection(area)):
            a, b = sorted(segment.project(Point(p)) + offsets[i] for p in (part.coords[0], part.coords[-1]))
            if b - a > .01:
                if intervals and a - intervals[-1][1] < .02:
                    intervals[-1][1] = b
                else:
                    intervals.append([a, b])
    return intervals


def mapped_pass(line, start, end, ring):
    pts, polygon, _, gates, bypass = ring
    if start < 6 or end + 6 > line.length or end - start < 7:
        return None
    a, b = line.interpolate(start), line.interpolate(end)
    enter = gate_match(gates, a, line.interpolate(start - 8), True)
    leave = gate_match(gates, b, line.interpolate(end + 8), False)
    if not enter or not leave:
        return None
    i, arm_in, d_in = enter
    j, arm_out, d_out = leave
    original = substring(line, start, end)
    # A slip lane or an overpass may pass very close to the same two arms.
    if any(original.intersection(road.buffer(3)).length > .65 * original.length for road in bypass):
        return None
    # A same-arm round trip needs evidence on the far side, to distinguish it from a near miss.
    if i == j and original.hausdorff_distance(polygon.exterior) > 9:
        return None
    arc = pts[i:j + 1] if i < j else pts[i:] + pts[:j + 1]
    road = LineString(arc)
    if (not original.intersects(polygon.buffer(-1.5))
            and road.difference(original.buffer(6)).length > .2 * road.length):
        return None
    # Reject an implausibly long way round when the original shape takes a short tangential bypass.
    if road.length > 2.5 * original.length + 8:
        return None
    def side(arm, distance, inward):
        result = substring(arm, distance, 0) if inward else substring(arm, 0, distance)
        return list(result.coords)
    return [*side(arm_in, d_in, True), *arc, *side(arm_out, d_out, False)]


def corrected_shape(points, ring_ids, rings, measure):
    xy = [local(p) for p in points]
    line = LineString(xy)
    segments = [LineString(pair) for pair in zip(xy, xy[1:])]
    tree = STRtree(segments)
    offsets = running_lengths(xy)
    edits, unknown = [], []
    for k in ring_ids:
        ring = rings[k]
        for start, end in contact_intervals(segments, tree, offsets, ring[2]):
            path = mapped_pass(line, start, end, ring)
            if path:
                edits.append((start, end, path))
            elif end - start >= 5:
                original = substring(line, start, end)
                if (original.intersects(ring[1].buffer(-3))
                        and not any(original.intersection(road.buffer(4)).length > .5 * original.length
                                    for road in ring[4])):
                    unknown.append((start, end))
    if not edits and not unknown:
        return None
    old_metres = running_lengths(points, measure)
    def at_metres(at):
        i = min(len(xy) - 2, bisect_right(offsets, at) - 1)
        frac = (at - offsets[i]) / (offsets[i + 1] - offsets[i] or 1)
        return old_metres[i] + frac * (old_metres[i + 1] - old_metres[i])
    result, spans, changes = [], [], []
    index, new_length, last = 0, 0., -1.
    def add(p):
        nonlocal new_length
        if not result or result[-1] != p:
            if result:
                new_length += measure(result[-1], p)
            result.append(p)
    edits.sort(key=lambda e: e[0])
    for visit, (start, end, path) in enumerate(edits):
        if start < last:
            unknown.append((start, end))
            continue
        # Join the observed approach gradually, avoiding a lateral step where its centreline
        # is offset from OSM. Share available road between successive roundabouts.
        following = edits[visit + 1][0] if visit + 1 < len(edits) else offsets[-1]
        start -= min(7, (start - max(last, 0)) / 2)
        end += max(0, min(7, (following - end) / 2))
        while index < len(points) and offsets[index] < start:
            add(points[index])
            index += 1
        add(geographic(line.interpolate(start).coords[0]))
        before = new_length
        begin = len(result) - 1
        for p in path:
            add(geographic(p))
        add(geographic(line.interpolate(end).coords[0]))
        spans.append([begin, len(result) - 1])
        changes.append((at_metres(start), at_metres(end), before, new_length))
        index = bisect_right(offsets, end)
        last = end
    for p in points[index:]:
        add(p)
    gaps = []
    for a, b in sorted(unknown):
        start, end = [round(remap(at_metres(at), changes), 2) for at in (a, b)]
        if gaps and start <= gaps[-1][1]:
            gaps[-1][1] = max(gaps[-1][1], end)
        else:
            gaps.append([start, end])
    return result, spans, changes, gaps


def remap(m, edits):
    delta = 0.
    for a, b, c, d in edits:
        if m <= a:
            break
        if m < b:
            return c + (m - a) / (b - a) * (d - c)
        delta = d - b
    return m + delta


def apply_roundabouts(network, records, measure):
    rings = [read_ring(r) for r in records]
    tree = STRtree([r[2] for r in rings])
    changes = {}
    protected, unknown = {}, {}
    for shape, points in network["shapes"].items():
        line = LineString([local(p) for p in points])
        ids = tree.query(line, predicate="intersects")
        if len(ids):
            correction = corrected_shape(points, ids, rings, measure)
            if correction:
                network["shapes"][shape], spans, changes[shape], gaps = correction
                if spans:
                    protected[shape] = spans
                if gaps:
                    unknown[shape] = gaps
    for route in network["routes"].values():
        for p in route["patterns"]:
            edits = changes.get(p["shape"])
            if not edits or not p.get("stopOffsets"):
                continue
            p["stopOffsets"] = [math.floor(remap(m, edits) * 10) / 10 for m in p["stopOffsets"]]
    network["roundabouts"] = protected
    network["roundaboutGaps"] = unknown
    return sum(map(len, protected.values()))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Extract directed roundabouts and their connecting roads from OSM.")
    parser.add_argument("pbf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = survey(args.pbf)
    args.output.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(len(data), "mapped roundabouts")
