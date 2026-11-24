"""Extract the Helsinki bus network from HSL's official GTFS ZIP (Python 3, standard library).

Usage: python3 scripts/prepare_network.py /path/to/hsl.zip
Source: https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip (HSL, CC BY 4.0).
"""

import argparse
import csv
import io
import json
import math
from bisect import bisect_left
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime
from itertools import groupby
from operator import itemgetter
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile


@contextmanager
def table(archive, name):
    with archive.open(f"{name}.txt") as stream:
        with io.TextIOWrapper(stream, encoding="utf-8-sig", newline="") as source:
            yield csv.DictReader(source)


def bus_route(route_type):
    return route_type == 3 or 700 <= route_type < 800


def iso_date(gtfs_date):
    return datetime.strptime(gtfs_date, "%Y%m%d").date().isoformat()


def stop_patterns(archive, trips):
    """Many trips share a pattern. Intern their ordered stops instead of storing 1 GB of rows."""
    sequences = {}
    shared = {}
    with archive.open("stop_times.txt") as stream:
        with io.TextIOWrapper(stream, encoding="utf-8-sig", newline="") as source:
            rows = csv.reader(source)
            header = next(rows)
            trip, stop, sequence = map(header.index, ("trip_id", "stop_id", "stop_sequence"))
            distance = header.index("shape_dist_traveled") if "shape_dist_traveled" in header else None
            for trip_id, batch in groupby(rows, key=itemgetter(trip)):
                if trip_id not in trips:
                    continue
                entries = [(int(row[sequence]), row[stop], row[distance] if distance is not None else "")
                           for row in batch]
                # GTFS permits interleaved trips and unordered stop sequence numbers.
                if trip_id in sequences:
                    entries.extend(sequences[trip_id])
                ordered = tuple(sorted(entries))
                sequences[trip_id] = shared.setdefault(ordered, ordered)

    patterns = defaultdict(Counter)
    for trip_id, sequence in sequences.items():
        route, direction, headsign, shape = trips[trip_id]
        patterns[route][direction, headsign, shape, sequence] += 1
    return patterns


def simplify(points, anchors, tolerance=1.8):
    """Douglas-Peucker in local metres. Preserve bends on city streets and at bridge ramps."""
    if len(points) < 3:
        return list(range(len(points)))
    mean_latitude = (points[0][1] + points[-1][1]) / 2
    x_scale = 111_320 * math.cos(math.radians(mean_latitude))
    xy = [(lng * x_scale, lat * 111_320) for lng, lat in points]
    keep = {0, len(points) - 1, *anchors}
    boundaries = sorted(keep)
    intervals = list(zip(boundaries, boundaries[1:]))
    while intervals:
        start, end = intervals.pop()
        ax, ay = xy[start]
        bx, by = xy[end]
        dx, dy = bx - ax, by - ay
        length_squared = dx * dx + dy * dy
        largest, split = tolerance ** 2, None
        for i in range(start + 1, end):
            x, y = xy[i]
            t = ((x - ax) * dx + (y - ay) * dy) / length_squared if length_squared else 0
            t = max(0, min(1, t))
            distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            if distance > largest:
                largest, split = distance, i
        if split is not None:
            keep.add(split)
            intervals.extend(((start, split), (split, end)))
    return sorted(keep)


def segment_metres(a, b):
    latitude = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(latitude)
    dy = math.radians(b[1] - a[1])
    return 6_371_008.8 * math.hypot(dx, dy)


def valid_distances(values):
    return (bool(values) and all(math.isfinite(v) for v in values)
            and all(a <= b for a, b in zip(values, values[1:])))


def render_shape(entries, visits):
    """Keep the bracketing vertices at each visit, then measure stops on the published geometry."""
    entries.sort()
    points = [point for _, point, _ in entries]
    distances = [distance for _, _, distance in entries]
    anchors = set()
    matched = []
    if valid_distances(distances) and distances[0] < distances[-1]:
        for pattern, stops in visits:
            if not valid_distances(stops) or stops[0] < distances[0] or stops[-1] > distances[-1]:
                continue
            locations = []
            for stop in stops:
                right = bisect_left(distances, stop)
                if distances[right] == stop:
                    left, fraction = right, 0
                else:
                    left = right - 1
                    fraction = (stop - distances[left]) / (distances[right] - distances[left])
                anchors.update((left, right))
                locations.append((left, right, fraction))
            matched.append((pattern, locations))

    indices = simplify(points, anchors)
    coordinates = [points[i] for i in indices]
    metres = {indices[0]: 0.0}
    for previous, current in zip(indices, indices[1:]):
        metres[current] = metres[previous] + segment_metres(points[previous], points[current])
    for pattern, locations in matched:
        # Round down to the nearest decimetre so the final offset is always inside the line.
        pattern["stopOffsets"] = [
            math.floor((metres[left] + fraction * (metres[right] - metres[left])) * 10) / 10
            for left, right, fraction in locations
        ]
    return coordinates


def extract(archive):
    with table(archive, "feed_info") as rows:
        feed = next(rows)
    with table(archive, "routes") as rows:
        routes = {
            row["route_id"]: {"number": row["route_short_name"], "name": row["route_long_name"]}
            for row in rows if bus_route(int(row["route_type"]))
        }
    with table(archive, "trips") as rows:
        trips = {
            row["trip_id"]: (row["route_id"], int(row["direction_id"]), row["trip_headsign"], row["shape_id"])
            for row in rows if row["route_id"] in routes
        }
    patterns = stop_patterns(archive, trips)
    del trips
    stop_ids = set()
    visits = defaultdict(list)
    for route_id, route in routes.items():
        route["patterns"] = []
        # Stable order gives the most frequent pattern in each direction first.
        ordered = sorted(patterns[route_id].items(), key=lambda pair: (pair[0][0], -pair[1], pair[0]))
        for (direction, headsign, shape, sequence), _ in ordered:
            ids = [stop for _, stop, _ in sequence]
            pattern = {"direction": direction, "headsign": headsign, "shape": shape, "stops": ids}
            if any(number != i for i, (number, _, _) in enumerate(sequence, 1)):
                pattern["sequences"] = [number for number, _, _ in sequence]
            route["patterns"].append(pattern)
            stop_ids.update(ids)
            distances = [float(value) if value else math.nan for _, _, value in sequence]
            visits[shape].append((pattern, distances))
    with table(archive, "stops") as rows:
        stops = {
            row["stop_id"]: {
                "name": row["stop_name"], "code": row["stop_code"],
                "coordinate": [float(row["stop_lon"]), float(row["stop_lat"])],
                **({"platform": row["platform_code"].strip()} if row.get("platform_code", "").strip() else {}),
                **({"indoorLevel": "E"} if row["stop_desc"].strip() == "Sisäterminaali E" else {})
            }
            for row in rows if row["stop_id"] in stop_ids
        }
    with table(archive, "shapes") as rows:
        vertices = defaultdict(list)
        for row in rows:
            if row["shape_id"] in visits:
                vertices[row["shape_id"]].append((
                    int(row["shape_pt_sequence"]),
                    (round(float(row["shape_pt_lon"]), 5), round(float(row["shape_pt_lat"]), 5)),
                    float(row["shape_dist_traveled"]) if row.get("shape_dist_traveled") else math.nan,
                ))
    shapes = {}
    for shape_id, entries in vertices.items():
        shapes[shape_id] = render_shape(entries, visits[shape_id])
    if stop_ids != stops.keys() or visits.keys() != shapes.keys():
        raise ValueError("GTFS patterns contain a stop or shape missing from the source tables.")
    return {"version": feed["feed_version"], "validFrom": iso_date(feed["feed_start_date"]),
            "validThrough": iso_date(feed["feed_end_date"]), "routes": routes, "stops": stops, "shapes": shapes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gtfs_zip", type=Path)
    default_output = Path(__file__).resolve().parents[1] / "public/data/network.json"
    parser.add_argument("--output", type=Path, default=default_output)
    args = parser.parse_args()
    with ZipFile(args.gtfs_zip) as archive:
        network = extract(archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # A concurrent build or running map should always see one complete catalogue.
    with TemporaryDirectory(dir=args.output.parent) as directory:
        temporary = Path(directory) / args.output.name
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(network, output, separators=(",", ":"), ensure_ascii=False)
            output.write("\n")
        temporary.replace(args.output)
    print(f'{len(network["routes"])} bus routes, {len(network["stops"])} stops, '
          f'{len(network["shapes"])} shapes, valid through {network["validThrough"]}.')


if __name__ == "__main__":
    main()
