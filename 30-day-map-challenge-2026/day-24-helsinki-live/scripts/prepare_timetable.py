"""Build data/timetable.json: python3 scripts/prepare_timetable.py hsl.zip public/data/timetable.json.

Build this from the same HSL GTFS export as network.json. Dates outside its published
coverage deliberately have no timetable. Rows contain only bus service, and identical
calendar masks, stop patterns and offsets from the first departure are shared.
"""
import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from functools import lru_cache
from itertools import groupby
from operator import itemgetter
from pathlib import Path
from zoneinfo import ZoneInfo


def rows(archive, table):
    with archive.open(table + ".txt") as raw:
        with io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as source:
            yield from csv.DictReader(source)


@lru_cache(maxsize=None)
def clock(text):
    if not text:
        return None
    hours, minutes, seconds = map(int, text.split(":"))
    return (hours * 60 + minutes) * 60 + seconds


def build(archive):
    feed = next(rows(archive, "feed_info"))
    zone = next(rows(archive, "agency"))["agency_timezone"]
    first = datetime.strptime(feed["feed_start_date"], "%Y%m%d").date()
    last = datetime.strptime(feed["feed_end_date"], "%Y%m%d").date()
    days = [first + timedelta(days=i) for i in range((last-first).days+1)]
    dates = [d.strftime("%Y%m%d") for d in days]
    date_index = {d:i for i,d in enumerate(dates)}
    # Static GTFS clocks measure seconds from local noon minus twelve hours,
    # which differs from civil midnight on a DST transition.
    starts = [int(datetime(d.year,d.month,d.day,12,tzinfo=ZoneInfo(zone)).timestamp())-43200 for d in days]
    active = defaultdict(int)
    weekdays = "monday tuesday wednesday thursday friday saturday sunday".split()
    if "calendar.txt" in archive.namelist():
        for row in rows(archive, "calendar"):
            active[row["service_id"]] = sum(1<<i for i,d in enumerate(days)
                if row["start_date"] <= dates[i] <= row["end_date"] and row[weekdays[d.weekday()]]=="1")
    if "calendar_dates.txt" in archive.namelist():
        for row in rows(archive,"calendar_dates"):
            i = date_index.get(row["date"])
            if i is None:
                continue
            if row["exception_type"]=="1":
                active[row["service_id"]] |= 1<<i
            elif row["exception_type"]=="2":
                active[row["service_id"]] &= ~(1<<i)
    routes = {r["route_id"] for r in rows(archive,"routes") if int(r["route_type"])==3 or 700<=int(r["route_type"])<800}
    trips = {r["trip_id"]:(r["route_id"], r["direction_id"], active[r["service_id"]])
             for r in rows(archive,"trips") if r["route_id"] in routes and active[r["service_id"]]}
    # Frequency trips have no unique scheduled start without processing frequencies.txt.
    if "frequencies.txt" in archive.namelist():
        for row in rows(archive,"frequencies"):
            trips.pop(row["trip_id"], None)
    patterns, profiles = {}, {}
    pattern_values, profile_values, trip_rows = [], [], {}
    pending = {}  # Only fragmented trips which began with an untimed row.
    def intern(index, values, value):
        if value not in index:
            index[value] = len(values)
            values.append(value)
        return index[value]
    with archive.open("stop_times.txt") as raw, io.TextIOWrapper(raw,encoding="utf-8-sig",newline="") as source:
        data = csv.reader(source)
        head = next(data)
        tid, seq, stop, arr, dep = map(head.index, ("trip_id","stop_sequence","stop_id","arrival_time","departure_time"))
        for trip_id, group in groupby(data, itemgetter(tid)):
            if trip_id not in trips:
                continue
            batch = [(int(r[seq]),r[stop],clock(r[arr]),clock(r[dep])) for r in group]
            batch.extend(pending.pop(trip_id, ()))
            if trip_id in trip_rows:
                old_start, pattern, profile = trip_rows.pop(trip_id)
                batch.extend((n,s,None if offset is None else old_start+offset,old_start if i==0 else None)
                    for i,((n,s),offset) in enumerate(zip(pattern_values[pattern],profile_values[profile])))
            batch.sort(key=itemgetter(0))
            start = batch[0][3] if batch[0][3] is not None else batch[0][2]
            if start is None:
                pending[trip_id] = batch
                continue
            # Ignore ambiguous, malformed duplicate sequence entries.
            if any(b[0]==a[0] for a,b in zip(batch,batch[1:])):
                trips.pop(trip_id,None)
                trip_rows.pop(trip_id,None)
                continue
            path = tuple((n,s) for n,s,_,_ in batch)
            offsets = tuple(None if seconds is None else seconds-start for _,_,seconds,_ in batch)
            trip_rows[trip_id] = (start,intern(patterns,pattern_values,path),intern(profiles,profile_values,offsets))
    # Merge services sharing all trip coordinates and times. If any service day
    # really has two indistinguishable departures, preserve its ambiguity.
    schedules = {}
    for tid,(start,pattern,profile) in trip_rows.items():
        route,direction,days_mask = trips[tid]
        key = (route,direction,start,pattern,profile)
        prior, overlaps = schedules.get(key,(0,0))
        schedules[key] = (prior|days_mask,overlaps|(prior&days_mask))
    calendars, masks, groups = {}, [], {}
    for (route,direction,start,pattern,profile),(mask,twice) in schedules.items():
        by_start = groups.setdefault(route,{}).setdefault(direction,{})
        output = by_start.setdefault(start,[])
        for applicable in (mask,twice):
            if applicable:
                output.append([intern(calendars,masks,format(applicable,"x")),pattern,profile])
    static_patterns = []
    for visits in pattern_values:
        seq, stops = zip(*visits)
        static_patterns.append([stops,None if seq==tuple(range(1,len(seq)+1)) else seq])
    return {"version":1,"sourceVersion":feed.get("feed_version"),"zone":zone,"first":dates[0],"last":dates[-1],
            "starts":starts,"masks":masks,"patterns":static_patterns,"profiles":profile_values,"routes":groups}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gtfs",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    with zipfile.ZipFile(args.gtfs) as archive:
        table=build(archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as f:
        json.dump(table,f,ensure_ascii=False,separators=(",",":"))
    print(f"{table['first']}–{table['last']}, {len(table['routes'])} bus routes, {args.output.stat().st_size:,} bytes")
