"""Prepare the actual Tileflow symbol style and its static and moving GeoJSON sources."""
import json, pathlib, math
here=pathlib.Path(__file__).resolve().parent
src=here.parent/'tile/native';out=here.parent.parent/'public'
out.mkdir(parents=True,exist_ok=True)
def save(name,data):(out/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
def read(name):return json.loads((src/name).read_text())
base_z=math.log2(1578.4/512)
original=read('glyphs.geojson')
def dynamic(f):return f['properties']['b'] in ('type-5','type-6','type-7','type-8')
for name,want_dynamic in [('geography.geojson',False),('moving.geojson',True)]:
    save(name,{'type':'FeatureCollection','features':[f for f in original['features'] if dynamic(f)==want_dynamic]})
style=read('style.json')
style['name']='Is this a map? · The world in type'
# The map controller selects Equal Earth through its explicit projection option.
style['sources']={key:{'type':'geojson','data':'./'+file,'maxzoom':6,'buffer':128,'tolerance':0} for key,file in [('glyphs','geography.geojson'),('moving','moving.geojson')]}
style['zoom']=base_z
for layer in style['layers']:
    if layer['type']!='symbol':continue
    if layer['id'] in ('type-5','type-6','type-7','type-8'):layer['source']='moving'
    layout=layer['layout']
    layout['text-rotate']=['get','e']
    # Fractions of a cell and letters must scale together throughout a zoom.
    layout['text-size']=['interpolate',['exponential',2],['zoom']]
    for zoom in [-2,-1,0,1,base_z,2,3,4]:
        layout['text-size'] += [zoom,['*',['get','s'],2**(zoom-base_z)]]
    layout['text-pitch-alignment']='viewport'
    layout['text-offset']=[0,-.14]
    layer['paint']['text-opacity']=['*',['get','a'],.91]
    layer['maxzoom']=3.4
    if layer['id'] in ('type-3','type-4'):
        layer['paint']['text-translate']=[0,0]
        layer['paint']['text-translate-anchor']='viewport'
        layer['paint']['text-translate-transition']={'duration':0,'delay':0}
style['transition']={'duration':0,'delay':0}
style['metadata']['world-in-type:viewer']={'runtime':'@tileflow/dom','projection':'equalEarth','loopSeconds':12,'referenceWidth':1578.4}
def typeset_source():return {'type':'geojson','data':{'type':'FeatureCollection','features':[]},'maxzoom':17,'buffer':128,'tolerance':0}
style['sources']['regional']=typeset_source()
style['sources']['local']=typeset_source()
# The cartographic composers choose the real features and avoid overlaps in screen space.
families=[('sea',['water'],'JetBrains Mono'),('relief',['urban','land','bathymetry'],'JetBrains Mono'),('height-type',['terrainName'],'Instrument Serif Italic'),('grounds',['park','coast','building','border','river','road','townDot'],'JetBrains Mono'),
          ('flow',['flow'],'JetBrains Mono'),('flow-1',['flow'],'JetBrains Mono'),('flow-2',['flow'],'JetBrains Mono'),('flow-3',['flow'],'JetBrains Mono'),('water-type',['waterLabel'],'Instrument Serif Italic'),
          ('road-type',['roadLabel'],'JetBrains Mono'),('road-up',['roadLabel'],'JetBrains Mono'),('road-down',['roadLabel'],'JetBrains Mono'),('road-steep',['roadLabel'],'JetBrains Mono'),('town-type',['place','landmark','regionLabel'],'Instrument Serif'),
          ('local-type',['poi','settlement','number','house','housenumber'],'JetBrains Mono')]
for source in ['regional','local']:
    for suffix,roles,face in families:
        style['layers'].append({'id':source+'-'+suffix,'type':'symbol','source':source,
          'filter':['in',['get','b'],['literal',roles]],'layout':{
           'text-field':['get','t'],'text-font':[face],'text-size':['get','s'],'text-rotate':['get','e'],
           'text-pitch-alignment':'viewport','text-rotation-alignment':'viewport','text-anchor':'center',
           'text-offset':[0,-.13],'text-max-width':200,'text-allow-overlap':True,'text-ignore-placement':True,'text-padding':0},
          'paint':{'text-color':['get','c'],'text-opacity':['get','a'],'text-opacity-transition':{'duration':0,'delay':0}}})
# Set each street name in a motion layer nearest to the tangent of its road.
# Text translation is a native paint operation; it does not re-tile the street network.
e=['get','e']; magnitude=['abs',e]
masks={'road-type':['<=',magnitude,22.5],
       'road-up':['all',['<',e,-22.5],['>',e,-67.5]],
       'road-down':['all',['>',e,22.5],['<',e,67.5]],
       'road-steep':['>=',magnitude,67.5]}
for layer in style['layers']:
    src=layer.get('source')
    if src not in ('regional','local'):continue
    family=layer['id'][len(src)+1:]
    # The stations live on the map. An older plate temporarily scales in the
    # same proportion as the distance between its anchors during a gesture.
    size=['interpolate',['exponential',2],['zoom']]
    for z in range(-2,22):
        size += [z,['min',['coalesce',['get','markCeiling'],['*',['get','s'],2.25]],['*',['get','optical'],2**z]]]
    layer['layout']['text-size']=size
    if family=='grounds':layer['layout']['symbol-sort-key']=['coalesce',['get','order'],0]
    layer['paint']['text-opacity']=0
    layer['paint']['text-color']=['get','ink']
    if family.startswith('flow'):
        index=int(family.split('-')[1]) if '-' in family else 0
        layer['filter']=['all',layer['filter'],['==',['%', ['get','q'],4],index]]
    if family in masks:layer['filter']=['all',layer['filter'],masks[family]]
    if family in masks or family in ('sea','water-type'):
        layer['paint'].update({'text-translate':[0,0],'text-translate-anchor':'viewport','text-translate-transition':{'duration':200,'delay':0}})
# New words can appear on their own without fading an entire map or duplicating
# an existing name. Existing ink and incoming text are disjoint feature sets.
from copy import deepcopy
label_families=['water-type','road-type','road-up','road-down','road-steep','town-type','local-type']
word_size=['interpolate',['exponential',2],['zoom']]
for z in range(-2,22):
    word_size.extend([z,['min',['get','wordCeiling'],['*',['get','wordOptical'],2**z]]])
for src in ['regional','local']:
    relevant=[l for l in style['layers'] if l.get('source')==src]
    for fam,roles in [('water-type',['waterLabel']),('town-type',['place','landmark','regionLabel']),('local-type',['poi','settlement','house','housenumber','number']),*[(key,['roadLabel']) for key in masks]]:
        copy=deepcopy(next(l for l in relevant if l['id']==src+'-'+fam))
        copy['id']=src+'-enter-'+fam
        copy['filter']=['all',['==',['get','enter'],True],copy['filter']]
        copy['layout']['text-size']=word_size
        style['layers'].append(copy)
    for l in relevant:
        if l['id'][len(src)+1:] in label_families:
            l['filter']=['all',l['filter'],['!=',['get','enter'],True]]
            l['layout']['text-size']=word_size
# A broader regional chart can be placed while the exact chart and its next
# replacement occupy the two normal sources. Only the shaped words need buckets.
style['sources']['atlas-reserve']=deepcopy(style['sources']['regional'])
for family,roles in [('town-type',['place','regionLabel','landmark']),('water-type',['waterLabel']),('road-type',['roadLabel','poi','house','housenumber','settlement','number']),('height-type',['terrainName'])]:
    layer=deepcopy(next(l for l in style['layers'] if l['id']=='regional-'+family))
    layer.update(id='atlas-reserve-'+family,source='atlas-reserve',filter=['in',['get','b'],['literal',roles]])
    style['layers'].append(layer)
# During enlargement one native bucket holds the optically sized words. Its
# camera-only opacity and the original buckets use opposite sides of one stop.
for src in ['regional','local','atlas-reserve']:
    layer=deepcopy(next(l for l in style['layers'] if l['id']==src+'-town-type'))
    layer.update(id=src+'-close-type',filter=['has','closeSize'])
    layout=layer['layout']
    layout['text-size']=['get','closeSize']
    layout['text-font']=['match',['get','b'],['terrainName','waterLabel'],['literal',['Instrument Serif Italic']],
                         ['place','regionLabel','landmark'],['literal',['Instrument Serif']],['literal',['JetBrains Mono']]]
    style['layers'].append(layer)
# Keep a separate native symbol bucket for the outgoing world's overscaled
# fallback. Its zoom floor prevents old symbol tiles from being painted at Home.
world_fallback=[]
for l in style['layers']:
    if l['id'].startswith('type-'):
        copy=deepcopy(l)
        copy.update(id='world-reserve-'+l['id'], minzoom=3.4, maxzoom=6)
        world_fallback.append(copy)
style['layers'][1:1]=world_fallback
save('style.json',style)
# The two Lambert hemispheres are already projected on a print coordinate plane.
# WebMercator here is a reversible parametrisation of that plane for native symbols.
from copy import deepcopy
plate=deepcopy(style)
plate['name']='Is this a map? · The hemispheres'
empty=lambda:{'type':'geojson','data':{'type':'FeatureCollection','features':[]},'maxzoom':5,'tolerance':0,'buffer':128}
plate['sources']={'glyphs':empty(),'moving':empty()}
plate['projection']={'type':'mercator'}
plate['layers']=[l for l in plate['layers'] if l.get('type')=='background' or l['id'].startswith('type-')]
plate['zoom']=2
for l in plate['layers']:
    if l['type']!='symbol':continue
    l.pop('maxzoom',None)
    val=['interpolate',['exponential',2],['zoom']]
    for z in range(-2,7):val.extend([z,['*',['get','s'],2**(z-2)]])
    l['layout']['text-size']=val
save('portrait-style.json',plate)
manifest=json.loads((out/'manifest.json').read_text())
manifest['maps']['world-in-type']['themes']['paper']['styleUrl']='./style.json?v=approach-2'
manifest['maps']['hemispheres']={'defaultTheme':'paper','themes':{'paper':{'colorScheme':'light','styleUrl':'./portrait-style.json'}}}
manifest['maps']['globe']={'defaultTheme':'paper','themes':{'paper':{'colorScheme':'light','styleUrl':'./globe-style.json?v=touch-orbit-1'}}}
save('manifest.json',manifest)
