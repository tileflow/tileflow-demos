"""Trace city-to-city itineraries over the vertices of Natural Earth's roads."""
from collections import defaultdict
from heapq import heappop, heappush
from math import cos, hypot, radians
from shapely.geometry import LineString


itineraries = {
    'Africa': [('Nairobi','KEN','Mombasa','KEN'), ('Cape Town','ZAF','Johannesburg','ZAF'), ('Dakar','SEN','Bamako','MLI'), ('Cairo','EGY','Aswan','EGY')],
    'South America': [('Brasília','BRA','São Paulo','BRA'), ('São Paulo','BRA','Rio de Janeiro','BRA'), ('Buenos Aires','ARG','Santiago','CHL'), ('Lima','PER','Arequipa','PER')],
    'Asia': [('New Delhi','IND','Mumbai','IND'), ('Beijing','CHN','Shanghai','CHN'), ('Bangkok','THA','Chiang Mai','THA')],
    'Oceania': [('Melbourne','AUS','Sydney','AUS'), ('Perth','AUS','Adelaide','AUS')],
}


def distance(a, b):
    return hypot((a[0]-b[0])*cos(radians((a[1]+b[1])/2)),a[1]-b[1])*111.195


def make_routes(reader, pieces, pairs):
    locations = {}
    for loc in reader('route_cities').iterShapeRecords():
        key = (loc.record['name'], loc.record['sov_a3'])
        if key not in locations or locations[key][1] < loc.record['pop_max']:
            locations[key] = (loc.shape.points[0], loc.record['pop_max'])
    graphs = {key:defaultdict(list) for key in itineraries}
    for road in reader('roads').iterShapeRecords():
        group = graphs.get(road.record['continent'])
        if group is None or road.record['featurecla'] == 'Ferry' or 'ferry' in road.record['type'].lower():
            continue
        for line in pieces(road.shape):
            points = [(round(x,4),round(y,4)) for x,y in line]
            for a, b in zip(points,points[1:]):
                if a != b:
                    d = distance(a,b)
                    group[a].append((b,d)); group[b].append((a,d))
    result=[]
    for region, cases in itineraries.items():
        graph=graphs[region]
        for a,ca,b,cb in cases:
            if (a,ca) not in locations or (b,cb) not in locations:
                continue
            p, q = locations[a,ca][0], locations[b,cb][0]
            start, finish = (min(graph,key=lambda node:distance(node,center)) for center in [p,q])
            if distance(start,p)>25 or distance(finish,q)>25:
                continue
            queue=[(0,start)]; seen={start:0}; parent={}
            while queue:
                d, node = heappop(queue)
                if d!=seen[node]:
                    continue
                if node==finish:
                    break
                for nxt, length in graph[node]:
                    candidate=d+length
                    if candidate<seen.get(nxt,float('inf')):
                        seen[nxt]=candidate; parent[nxt]=node; heappush(queue,(candidate,nxt))
            if finish not in parent or seen[finish]>distance(p,q)*2.35:
                continue
            trace=[finish]
            while trace[-1]!=start:
                trace.append(parent[trace[-1]])
            path=pairs(LineString(trace[::-1]).simplify(.08).coords)
            result.append({'name':f'{a}–{b}','kind':'road itinerary','path':path})
            print(region, f'{a}–{b}',round(seen[finish]),'km along source network')
    return result
