"""Compose an independent WGS84 Tileflow symbol sheet from the atlas sources.

Only the two GeoJSON point collections and the native style are published.
The land bitmap and elevation samples below are placement masks, never layers.
"""
import base64
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'scripts'
OUT = ROOT / 'public'
def load(p): return json.loads(p.read_text())
def save(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n')
world=load(OUT/'detail/natural-earth.json')
original=load(OUT/'style.json')
relief=load(WORK/'relief/relief.json')
height_data=base64.b64decode(relief['data'])
mask=load(OUT/'detail/land-mask.json')
land_bits=base64.b64decode(mask['bits'])
def is_land(x,y):
    i=int((x+180)/360*mask['width'])%mask['width']
    j=max(0,min(mask['height']-1,int((90-y)/180*mask['height'])))
    k=j*mask['width']+i
    return land_bits[k//8]>>(7-k%8)&1

ink = defaultdict(list)
def mark(kind, char, lon, lat, angle=0, tier=0):
    # GeoJSONSource uses Mercator tile coordinates, including on the sphere.
    # Its polar-cap vertices are singular, so keep all glyphs on valid anchors.
    if abs(lat)>85: return
    angle=(round(angle/5)*5+180)%360-180
    ink[kind,char,angle,tier].append([round((lon+180)%360-180,4),round(lat,4)])

def stations(points,spacing,start=.42):
    remaining=start*spacing
    for a,b in zip(points,points[1:]):
        dx=(b[0]-a[0]+180)%360-180
        dy=b[1]-a[1]
        east=dx*math.cos(math.radians((a[1]+b[1])/2))
        size=math.hypot(east,dy)
        if size<1e-8:continue
        angle=math.degrees(math.atan2(-dy,east))
        while remaining<=size:
            t=remaining/size
            yield (a[0]+t*dx+180)%360-180,a[1]+t*dy,angle
            remaining+=spacing
        remaining-=size

def seam_free(ring):
    run=[]
    for a,b in zip(ring,ring[1:]):
        if (abs(a[0])>179.995 and abs(b[0])>179.995) or (a[1]<-89.98 and b[1]<-89.98):
            if len(run)>1:yield run
            run=[]
        else:
            if not run:run=[a]
            run.append(b)
    if len(run)>1:yield run

for ring in world['land']:
    for coast in seam_free(ring):
        points=list(stations(coast,.74))
        if not points:
            mark('shore','·',*coast[len(coast)//2])
        for i,(x,y,a) in enumerate(points):mark('shore','–',x,y,a,i%2)
for line in world['boundaries']:
    for i,(x,y,a) in enumerate(stations(line,.99)):mark('frontier','·',x,y,a,i%2)
for river in world['rivers']:
    for i,(x,y,a) in enumerate(stations(river['path'],1.01)):mark('river','~',x,y,a,i%2)
for road in world['roads']:
    for i,(x,y,a) in enumerate(stations(road['path'],.94)):
        mark('road-flow' if i%6==2 else 'roads','–',x,y,a,i%2)

# Staggered bands have roughly equal physical spacing at every latitude.
# ETOPO determines whether the mark is a lowland dot or a mountain chevron.
lat_step=1.5
for row in range(114):
    lat=-84.75+row*lat_step
    n=max(6,round(360*math.cos(math.radians(lat))/lat_step))
    for col in range(n):
        seed=(row*104729+col*92821+col*row*8)%1009
        y=lat+((seed*67%1009)/1009-.5)*.46
        x=(col+(row%2)*.48+(seed/1009-.5)*.27)*360/n-180
        if not is_land(x,y):continue
        ix=round((x-relief['west'])/relief['step'])%relief['width']
        iy=max(0,min(relief['height']-1,round((relief['north']-y)/relief['step'])))
        height=height_data[iy*relief['width']+ix]*relief['metersPerUnit']
        if height>2700:char='^'
        elif height>1350:char='∧'
        elif height>620:char='′'
        elif height>230:char=':'
        else:char='·'
        if char in ('·',':') and seed%5<2:continue
        mark('relief',char,x,y,0,seed%2)

# These are the commissioned plate's invented ocean contours, wrapped in
# longitude and clipped against the Natural Earth land mask at each station.
for level,line in load(WORK/'mapamundi/sea.json'):
    band=(level+101)%8
    if band==6:continue
    strong=band in (0,4)
    for i,(x,y,a) in enumerate(stations(line,1.45 if strong else 1.8)):
        if not is_land(x,y):
            mark('tide' if strong else 'water','~',x,y,a,i%2)

features=[]
for (kind,char,rotation,tier),points in sorted(ink.items()):
    features.append({'type':'Feature','properties':{'kind':kind,'char':char,'rot':rotation,'tier':tier},
                     'geometry':{'type':'MultiPoint','coordinates':points}})
save('globe-ink.geojson',{'type':'FeatureCollection','features':features})

words=[]
def word(kind,text,lon,lat,size,priority,angle=0):
    words.append({'type':'Feature','properties':{'kind':kind,'name':text,'size':size,'priority':priority,
         'rot':angle},'geometry':{'type':'Point','coordinates':[lon,lat]}})
for text,lon,lat,priority,size in load(WORK/'mapamundi/names.json'):
    word('country',text if size<17 else text.upper(),lon,lat,size,priority)
for text,lon,lat,size,angle in [
    ('North Atlantic',-39,33,28,-12),('South Atlantic',-24,-29,25,8),
    ('North Pacific',-145,32,29,-8),('South Pacific',-128,-27,29,6),
    ('Indian Ocean',76,-30,30,-6),('Southern Ocean',59,-61,23,4),
    ('Arctic Ocean',43,82,20,0)]:
    word('ocean',text,lon,lat,size,0,angle)
# Longest real route carrying the name supplies the word's anchor.
for name in ['Amazon','Nile','Lena','Congo','Mekong','Paraná River','Amur','Mississippi']:
    routes=[list(stations(r['path'],.5)) for r in world['rivers'] if r['name']==name]
    path=max(routes,key=len,default=[])
    if len(path)<16:continue
    x,y,angle=path[len(path)//2]
    word('river-name',name.replace(' River',''),round(x,4),round(y,4),13,6)
save('globe-words.geojson',{'type':'FeatureCollection','features':words})

style={k:original[k] for k in ('version','font-faces','transition')}
style.update(name='Is this a map? · A globe in type',projection={'type':'globe'},center=[-18,17],zoom=2)
def source(path,max_zoom):return {'type':'geojson','data':path,'buffer':128,'tolerance':0,'maxzoom':max_zoom}
# Keep all 100 place-name anchors in one tile throughout the orbit. Changing
# zoom does not require parsing new word tiles or replacing their placement IDs.
style['sources']={'globe-ink':source('./globe-ink.geojson',5),'globe-words':source('./globe-words.geojson',0)}
style['layers']=[{'id':'globe-paper','type':'background','paint':{'background-color':'#f7f5ee'}}]
families={'mono':'JetBrains Mono','serif':'Instrument Serif','italic':'Instrument Serif Italic'}
def graduated(values):
    return ['interpolate',['linear'],['zoom'],*sum(([z,v] for z,v in values),[])]
def art_layer(kind,id_,color,alpha,small,large,font='mono'):
    # Lighten every second station on a smaller sphere. With globe-aligned type
    # the tangent foreshortens toward the horizon and turns with the real coast.
    fade=graduated([(1.2,['case',['==',['get','tier'],1],alpha*.58,alpha]),
                     (1.8,['case',['==',['get','tier'],1],alpha*.69,alpha]),
                     (2.9,alpha)])
    layout={'symbol-placement':'point','text-field':['get','char'],'text-font':[families[font]],
       'text-size':graduated([(1.2,small),(2.5,large),(5.3,large*1.6)]),
       'text-rotation-alignment':'map','text-pitch-alignment':'map','text-rotate':['get','rot'],
       'text-padding':0,'text-offset':[0,-.10],'text-allow-overlap':True,'text-ignore-placement':True}
    style['layers'].append({'id':'globe-'+id_,'type':'symbol','source':'globe-ink',
       'filter':['==',['get','kind'],kind],'layout':layout,
       'paint':{'text-color':color,'text-opacity':fade,'text-translate-anchor':'viewport'}})
art_layer('relief','relief','#647466',.64,5.8,9.7)
art_layer('water','water','#3b7e89',.50,6.3,10.5)
art_layer('tide','tide','#397e89',.76,6.7,11.7)
art_layer('frontier','frontiers','#97543d',.83,7.2,11.3)
art_layer('river','rivers','#477e88',.78,6.3,9.2)
art_layer('roads','roads','#92543a',.85,5.7,8.5)
art_layer('road-flow','road-flow','#a96743',.92,6.3,9.1)
art_layer('shore','shores','#2d5147',.97,6.3,10.0)

def lettering(kind,id_,font,color,stops,space):
    # A single, upright phrase rests on the tangent plane at its geographic
    # anchor. The native projection foreshortens its type at the horizon.
    layout={'symbol-placement':'point','text-field':['get','name'],'text-font':[families[font]],
      'text-rotation-alignment':'viewport','text-pitch-alignment':'map','text-rotate':['get','rot'],
      'text-padding':3.5,'text-max-width':20,'symbol-sort-key':['get','priority'],
      'text-size':graduated([(z,['max',minimum,['*',['get','size'],factor]]) for z,minimum,factor in stops]),
      'text-allow-overlap':False,'text-ignore-placement':False,'text-letter-spacing':space}
    style['layers'].append({'id':'globe-'+id_,'type':'symbol','source':'globe-words',
      'filter':['==',['get','kind'],kind],'layout':layout,
      'paint':{'text-color':color,'text-halo-color':'#f7f5ee','text-halo-width':1.45}})
lettering('river-name','river-names','italic','#427883',[(.25,8,.55),(1.2,9,.68),(2.5,11,.92),(5.3,13,1.0)],.014)
lettering('country','country-names','serif','#233e36',[(.25,10,.53),(1.2,11.5,.75),(2.5,13,1.0),(5.3,14,1.22)],.064)
lettering('ocean','ocean-names','italic','#306d78',[(.25,12,.53),(1.2,14,.70),(2.5,19,1),(5.3,23,1.14)],.032)
metadata={k:v for k,v in original['metadata'].items() if k.startswith('tileflow:')}
metadata['tileflow:map']='world-in-type-globe'
metadata['tileflow:overlays']={
  'globe-marks':{'layers':[l['id'] for l in style['layers'] if l.get('source')=='globe-ink'],'placement':'above-labels','source':'globe-ink'},
  'globe-names':{'layers':[l['id'] for l in style['layers'] if l.get('source')=='globe-words'],'placement':'above-labels','source':'globe-words'}}
metadata['world-in-type:globe']={'coordinates':'WGS84 longitude, latitude','sphericalTangents':True,
  'worldData':'Natural Earth','elevations':'NOAA ETOPO 2022','oceanRhythms':'Invented lettering contours'}
# Tileflow installs its native, camera-tracked atmospheric rim from this payload.
metadata['tileflow:atmosphere']={
    'version':2, 'skyColor':'#f3f1ea', 'spaceColor':'#f3f1ea',
    'horizonColor':'#d7c8ad', 'fogColor':'#f7f5ee', 'starColor':'#d7c8ad',
    'starCount':0, 'starSize':0, 'starIntensity':0, 'starParallax':0}
style['metadata']=metadata
save('globe-style.json',style)
print(sum(len(v) for v in ink.values()),'marks,', len(words),'whole names,',len(style['layers']),'native layers')
