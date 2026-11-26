"""Make a small importance index for peaks already present in the Tileflow tiles.

Input https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_geography_regions_elevation_points.zip
Run with PyShp. The index does not supply rendered names or locations.
"""
from pathlib import Path
import json
import sys

here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parents[1]/'world/lib'))
import shapefile
from shapely.geometry import shape

source=shapefile.Reader(str(here/'geography_regions_elevation_points.zip'))
coords=[ [round(x*100), round(y*100)] for row in source.iterShapeRecords()
         if row.record['featurecla']=='mountain' for x,y in row.shape.points]
ibercountries={}
for row in shapefile.Reader(str(here.parents[1]/'world/countries.zip')).iterShapeRecords():
    code=row.record['ADM0_A3']
    if code not in {'ESP','PRT'}:
        continue
    country=shape(row.shape.__geo_interface__)
    pieces=getattr(country,'geoms',[country]); mainland=max(pieces,key=lambda p:p.area)
    # Retain only the uncontested interior, away from coastline and frontiers.
    core=mainland.buffer(-.16).simplify(.045,preserve_topology=True)
    ibercountries['es' if code=='ESP' else 'pt']=[[round(x,3),round(y,3)] for x,y in core.exterior.coords]
destination=here.parents[2]/'public/detail/regional-peaks.mjs'
destination.write_text('''// Natural Earth 1:10m elevation points, public domain. Hundredths of a degree.
// Only ranks Tileflow's own surveyed, named summit points at regional scales.
// https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/
const coordinates='''+json.dumps(coords,separators=(',',':'))+''';
const cells=new Map();
for(const [x,y] of coordinates){
  const key=Math.floor(x/200)+','+Math.floor(y/200);
  if(!cells.has(key))cells.set(key,[]);
  cells.get(key).push([x/100,y/100]);
}
export function notablePeak([lon,lat]){
  const cos=Math.max(.14,Math.cos(lat*Math.PI/180));
  for(let x=Math.floor((lon-.045/cos)/2);x<=Math.floor((lon+.045/cos)/2);x++){
    for(let y=Math.floor((lat-.045)/2);y<=Math.floor((lat+.045)/2);y++){
      for(const [px,py] of cells.get(x+','+y)||[]){
        if(((px-lon)*cos)**2+(py-lat)**2<.045**2)return true;
      }
    }
  }
  return false;
}
// These mainland interiors are deliberately inset ~14–18 km from Natural
// Earth's 1:110m boundaries. At a frontier the source's bilingual name stays.
const interiors='''+json.dumps(ibercountries,separators=(',',':'))+''';
function inside(ring,x,y){
  let hit=false;
  for(let i=1;i<ring.length;i++){
    const [ax,ay]=ring[i-1],[bx,by]=ring[i];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;
  }
  return hit;
}
export function localRiverName(properties,station){
  const raw=properties.name||'';
  if(!raw.includes(' - ')||!properties.name_es)return raw;
  const alternatives=raw.split(' - ');
  // Match only a pair explicitly supplied by the map data. Never translate.
  if(!alternatives.includes(properties.name_es)||!alternatives.some(s=>/^Rio /u.test(s)))return raw;
  const [x,y]=station;
  if(x< -9.6||x>3.5||y<35.8||y>44)return raw;
  if(inside(interiors.es,x,y))return properties.name_es;
  if(properties.name_pt&&alternatives.includes(properties.name_pt)&&inside(interiors.pt,x,y))return properties.name_pt;
  return raw;
}
''')
