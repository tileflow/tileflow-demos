"""One continuous camera from the Rialto to the Earth."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).resolve().parent
arrival = root.parent / 'venice' / 'frames'
layers = root / 'layers'
poses = json.loads((root / 'flight.json').read_text())
handover = json.loads((root / 'handover.json').read_text())
ff = os.getenv('FFMPEG','ffmpeg')
width,height = 1920,1080
y,x = np.ogrid[:height,:width]
phase = (.5+.19*np.sin(x/290+y/405)+.16*np.sin(x/385-y/260)+.12*np.cos(x/182+y/310)).astype('float32')
rim = np.clip(1 - np.sqrt(((x-960)/1200)**2+((y-540)/890)**2),0.,1.).astype('float32')
samples = [0,7,20,39,54,66,80,92,104,115,123,128,135,146,160,182]
stats = []
def smooth(p):
    t=np.clip(p,0.,1.)
    return t*t*(3.-2.*t)
def mask(weight,field,scatter=.49):
    return Image.fromarray((255*smooth((weight-scatter*field)/(1-scatter))+.5).astype('uint8'))
def image(name):
    with Image.open(name) as src:
        return src.convert('RGB')
def produce(row):
    i=row['i']
    if i==0:
        return image(arrival/'173.png')
    charts=row['charts']
    if charts:
        k,_=charts[0]
        sheet=image(layers/f'{k}-{i}.png')
        if len(charts)==2:
            k,weight=charts[1]
            sheet=Image.composite(image(layers/f'{k}-{i}.png'),sheet,mask(weight,phase))
    if row['globe']:
        world=image(layers/f'g-{i}.png')
        sheet=Image.composite(world,sheet,mask(row['globe'],rim,.48)) if charts else world
    if i<22:
        meta=handover[i]
        scale=meta['scale']
        source=image(arrival/f"{meta['source']:03d}.png")
        affine=(1/scale,0,960-meta['cx']/scale,0,1/scale,540-meta['cy']/scale)
        a = source.transform((width,height),Image.Transform.AFFINE,affine,Image.Resampling.BICUBIC)
        yy=(y-meta['cy'])/scale+540
        xx=(x-meta['cx'])/scale+960
        edge=np.clip(np.minimum(np.minimum(xx,width-xx),np.minimum(yy,height-yy))/9,0.,1.)
        # Give the fixed native credit its final screen position independently
        # of camera registration. It stays locked as the chart retreats.
        corners=((xx<340)|(xx>width-340))&(yy>height-38)
        edge=np.where(corners,0,edge)
        take=(1-np.asarray(mask(smooth((i-7)/15),phase))/255.)*edge
        pic=Image.composite(a,sheet,Image.fromarray(np.uint8(take*255+.5)))
        lower=Image.blend(source,sheet,float(smooth((i-2)/16)))
        for box in [(0,height-36,330,height),(width-330,height-36,width,height)]:
            pic.paste(lower.crop(box),box)
        sheet=pic
    return sheet
board=Image.new('RGB',(4*360,4*227),'#f6f3ea')
draw=ImageDraw.Draw(board)
cmd=[ff,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-framerate','30','-i','pipe:0','-an','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1','-c:v','libx264','-threads','4','-preset','fast','-crf','12','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',str(root/'departure.next.mp4')]
previous=None
with subprocess.Popen(cmd,stdin=subprocess.PIPE) as encoder:
    for row in poses:
        pic=produce(row)
        i=row['i']
        if i==0:
            assert not ImageChops.difference(pic,image(arrival/'173.png')).getbbox()
            shutil.copyfile(arrival/'173.png',root/'departure-000.png')
        if i in samples:
            j=samples.index(i)
            left,top=j%4*360,j//4*227
            board.paste(pic.resize((360,202),Image.Resampling.LANCZOS),(left,top))
            draw.text((left+6,top+205),f"{row['t']:.2f} s   z{row['z']:.2f}",fill='#3b4a45')
        if i==182:
            pic.save(root/'departure-182.png',compress_level=3)
        signal=np.asarray(pic)[::4,::4,:].astype('int16')
        stats.append({'i':i,'ink':round(float(np.mean(np.min(signal,2)<200)),5),
                      'delta':None if previous is None else round(float(np.abs(signal-previous).mean()),4)})
        previous=signal
        encoder.stdin.write(pic.tobytes())
    encoder.stdin.close()
    if encoder.wait(): raise RuntimeError('Departure encoder failed')
board.save(root/'departure-contact.jpg',quality=92)
(root/'signal.json').write_text(json.dumps(stats))
assert len(poses)==183 and min(r['ink'] for r in stats)>.001
(root/'departure.next.mp4').replace(root/'departure.mp4')
print('departure.mp4',len(poses),'frames, least ink',min(stats,key=lambda r:r['ink']))
