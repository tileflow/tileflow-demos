"""Cache Tileflow World from the Paris model out to the national map."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import sys, subprocess, json, math, os
work=Path(sys.argv[1]);root=Path(__file__).resolve().parents[1]/'public/datos'
meta=json.loads((work/'world.json').read_text());template=meta['tiles'][0]
extents={};jobs=[]
for z in range(2,15):
    n=2**z;cx=int((180+2.349)/360*n);cy=int((1-math.asinh(math.tan(math.radians(48.857)))/math.pi)/2*n)
    box=[max(0,cx-2),max(0,cy-2),min(n-1,cx+2),min(n-1,cy+2)]
    if z==14:box=[8292,5633,8305,5640]
    extents[z]=box
    folder=root/'teselas'/str(z);folder.mkdir(exist_ok=True)
    for x in range(box[0],box[2]+1):
        for y in range(box[1],box[3]+1):jobs.append((z,x,y,folder/f'{x}-{y}.pbf'))
def get(item):
    z,x,y,target=item
    if not target.exists():
        subprocess.run(['curl','-fLsS','--compressed','--retry','2','--max-time','40',template.format(z=z,x=x,y=y),'-o',str(target)],check=True)
    dest=work/f'{x}_{y}.pbf'
    if z==14 and not dest.exists():os.link(target,dest)
with ThreadPoolExecutor(max_workers=6) as ex:list(ex.map(get, reversed(jobs)))
(root/'contexto.json').write_text(json.dumps(dict(template=template,ranges=extents),separators=(',',':')))
meta['tiles']=['/atlas/{z}/{x}/{y}.pbf'];meta['maxzoom']=14;meta['minzoom']=2
(root/'world.json').write_text(json.dumps(meta,separators=(',',':')))
print(len(jobs),'cached geographic tiles')
