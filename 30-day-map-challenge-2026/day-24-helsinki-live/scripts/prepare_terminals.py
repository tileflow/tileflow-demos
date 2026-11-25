"""Extract real GTFS parent stations for the served bus stops in a matching network catalogue."""
import argparse
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile


def terminals(archive, network):
    def rows(name):
        return csv.DictReader(io.StringIO(archive.read(name + ".txt").decode("utf-8-sig")))

    version = next(rows("feed_info"))["feed_version"]
    if network["version"] != version:
        raise ValueError("The timetable and network catalogue must have the same GTFS feed version.")
    stops = {r["stop_id"]: r for r in rows("stops")}
    parents = {}
    for stop_id in sorted(network["stops"]):
        stop = stops[stop_id]
        parent_id = stop["parent_station"].strip()
        parent = stops.get(parent_id)
        if not parent or parent["location_type"] != "1":
            continue
        group = parents.setdefault(parent_id, {
            "name": parent["stop_name"], "coordinate": [float(parent["stop_lon"]), float(parent["stop_lat"])],
            "stops": [],
        })
        group["stops"].append(stop_id)
    return {"version": version, "stations": {k: v for k, v in parents.items() if len(v["stops"]) >= 2}}


def write_terminals(archive, network, output):
    catalogue = terminals(archive, network)
    output.write_text(json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return catalogue


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("gtfs_zip", type=Path)
    cli.add_argument("network", type=Path)
    cli.add_argument("output", type=Path)
    args = cli.parse_args()
    with ZipFile(args.gtfs_zip) as source:
        catalogue = write_terminals(source, json.loads(args.network.read_text(encoding="utf-8")), args.output)
    print(f'{len(catalogue["stations"])} parent stations with two or more served bus stops')
