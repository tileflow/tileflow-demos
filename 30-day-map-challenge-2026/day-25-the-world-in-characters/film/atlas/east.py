"""Extend the film's printed sheet into the Po valley from the same 1:10m edition."""
from pathlib import Path
from json import loads, dumps
import sys
here=Path(__file__).resolve().parent
project=here.parents[1]
sys.path.insert(0,str(project/'scripts/world/lib'))
import shapefile
out=here/'enhanced'
out.mkdir(exist_ok=True)
base=loads((project/'public/detail/iberia-middle.json').read_text())
names={'Genoa':'Genova','Turin':'Torino','Venice':'Venezia','Milan':'Milano','Florence':'Firenze'}
important={'Genova','Milano','Venezia'}
regional={'Monaco','Verona','Bologna','Firenze','Parma','Treviso','Grenoble'}
for place in base['cities']:
    place['name']=names.get(place['name'],place['name'])
    if place['name'] in regional:place['rank']=2
existing={p['name'] for p in base['cities']}
for loc in shapefile.Reader(str(project/'scripts/world/route_cities.zip')).iterShapeRecords(bbox=(6.9,42.2,14.1,46.6)):
    f=loc.record.as_dict()
    x,y=loc.shape.points[0]
    if f['adm0_a3']!='ITA' or not 6.9<=x<=14.1 or not 42.2<=y<=46.6:continue
    name=names.get(f['name'],f['name'])
    if name in existing:continue
    p=f['pop_max']
    base['cities'].append({'name':name,'point':[round(x,4),round(y,4)],
        'rank':1 if name in important else 2 if name in regional or p>310000 else 3 if p>65000 else 4,
        'country':'ITA','population':p})
    existing.add(name)
for country in base['labels']['countries']:
    if country['code']=='ITA':
        country.update(name='Italia',point=[11.45,43.3])
wanted={'Po':1,'Adige':2,'Ticino':3,'Mincio':3,'Dora Baltea':3}
for loc in shapefile.Reader(str(project/'scripts/iberia-media/geodata/ne_10m_rivers_lake_centerlines.zip')).iterShapeRecords(bbox=(6.9,42.2,14.1,46.6)):
    n=loc.record['name']
    if n not in wanted:continue
    raw=loc.shape.points;indices=list(loc.shape.parts)+[len(raw)]
    for i,j in zip(indices,indices[1:]):
        if j-i>1:base['rivers'].append({'name':n,'rank':wanted[n],'arr':[[round(x,4),round(y,4)] for x,y in raw[i:j]]})
(out/'iberia-middle.json').write_text(dumps(base,separators=(',',':'),ensure_ascii=False))
