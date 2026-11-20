"""Render a softly bevelled white relief from geographic Tileflow World footprints.
Each output pixel also stores the altitude of the first visible surface. The client
uses it to project the hex material in geographic space, including on facades.
"""
import json
import math
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1280
METRES = 40075016.686 * math.cos(math.radians(48.8566)) / 16384
M_PER_PX = METRES / SIZE
PAD = 56
LEAN = 0.66
DIRECTORY = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[1]/'public/relieve'
TILES = [(x,y) for y in range(5633,5641) for x in range(8292,8306)]

def raw_tile(tile):
    x,y = tile
    data = json.loads((DIRECTORY/f'{x}_{y}.json').read_text())
    heights = Image.new('L',(SIZE,SIZE))
    surface = Image.new('L',(SIZE,SIZE),235)
    hd, sd = ImageDraw.Draw(heights), ImageDraw.Draw(surface)
    def pixels(points):
        return [(round(a*SIZE/4096),round(b*SIZE/4096)) for a,b in points]
    def fill(draw,rings,value,hole):
        draw.polygon(pixels(rings[0]), fill=value)
        for r in rings[1:]:
            draw.polygon(pixels(r), fill=hole)
    for rings in data['parks']:
        fill(sd,rings,214,235)
    for rings in data['water']:
        fill(sd,rings,180,235)
    for width,line in data['roads']:
        if len(line)>1:
            sd.line(pixels(line),fill=230 if width<7 else 222,width=max(1,round(width/M_PER_PX)),joint='curve')
    for h,rings in sorted(data['buildings'],key=lambda b:b[0]):
        # The cap keeps towers within the relief and prevents deep shadows swallowing streets.
        height = min(63, 4+max(1,h)*0.93)
        fill(hd,rings,round(height*4),0)
        fill(sd,rings,250,235)
    h = np.asarray(heights).astype('float32') / 4
    a = np.asarray(surface).copy()
    # Rounded tree crowns in green areas; canopy points and illustrative planting use the same material.
    rng = np.random.default_rng(x*8192+y)
    park_y,park_x = np.where(a[::8,::8]==214)
    trees = [(px*8+rng.integers(6),py*8+rng.integers(6)) for px,py in zip(park_x,park_y) if rng.random()<.19]
    trees.extend(pixels(data['trees']))
    for cx,cy in trees:
        if not (0<=cx<SIZE and 0<=cy<SIZE) or h[cy,cx]>1 or a[cy,cx]==180: continue
        radius = rng.uniform(3.4,6.1)
        x0,x1=max(0,int(cx-radius)),min(SIZE,int(cx+radius+1))
        y0,y1=max(0,int(cy-radius)),min(SIZE,int(cy+radius+1))
        yy,xx = np.ogrid[y0:y1,x0:x1]
        crown=1-((xx-cx)/radius)**2-((yy-cy)/(radius*.9))**2
        region=h[y0:y1,x0:x1]
        np.maximum(region,np.where(crown>0,1.3+np.sqrt(np.maximum(0,crown))*radius*1.35,0),out=region)
        a[y0:y1,x0:x1][crown>0]=240
    packed=np.stack((np.clip(h*4,0,255).astype('uint8'),a),axis=-1)
    Image.fromarray(packed,'LA').save(DIRECTORY/f'raw-{x}-{y}.png', compress_level=2)

def render(tile):
    x,y = tile
    size = SIZE+2*PAD
    raw = np.zeros((size,size,2),dtype='uint8')
    raw[:,:,1]=235
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            file=DIRECTORY/f'raw-{x+dx}-{y+dy}.png'
            if not file.exists(): continue
            ox,oy=PAD+dx*SIZE,PAD+dy*SIZE
            x0,x1=max(0,ox),min(size,ox+SIZE)
            y0,y1=max(0,oy),min(size,oy+SIZE)
            with Image.open(file) as image:
                raw[y0:y1,x0:x1]=np.asarray(image.crop((x0-ox,y0-oy,x1-ox,y1-oy)))
    edge=Image.fromarray(raw[:,:,0])
    def smooth(img,r):
        return np.asarray(img.filter(ImageFilter.GaussianBlur(r))).astype('float32')
    h=(.60*smooth(edge,.85)+.29*smooth(edge,2.05)+.11*smooth(edge,4.8))/4
    albedo=smooth(Image.fromarray(raw[:,:,1]),.55)
    # Light from upper left. Diffuse rolloff and a small satin highlight reveal rounded roofs.
    gz,gx=np.gradient(h/M_PER_PX)
    length=np.sqrt(1+gx*gx+gz*gz)
    dot=(.46*gx+.58*gz+.67)/length
    light=np.clip(.88+.18*dot, .70,1.06)
    shine=np.maximum(0,(.22*gx+.34*gz+.915)/length)**8 * 4
    shade=np.zeros_like(h)
    for d in (2,4,7,11,16,22,29):
        caster=np.roll(h,(d,round(.70*d)),axis=(0,1))
        shade=np.maximum(shade,np.clip((caster-h-d*.83*M_PER_PX)/9,0,1)*math.exp(-d/31))
    shade=smooth(Image.fromarray((shade*255).astype('uint8')),1.45)/255
    ambient=np.maximum(0,(smooth(edge,4.1)/4-h))*.006
    lit=np.clip(albedo*(light-.19*shade-np.clip(ambient,0,.10))+shine,83,255)
    # Orthographic projection: a ray from the south meets each column of relief.
    # Start at the eye and keep the first crossing, then bisect for a sub-pixel intersection.
    yy=np.arange(size)[:,None]
    xx=np.arange(size)[None,:]
    def sample(field,alt):
        where=np.clip(yy+alt*LEAN/M_PER_PX,0,size-1.001)
        lo=where.astype(np.int32); frac=where-lo
        return field[lo,xx]*(1-frac)+field[lo+1,xx]*frac
    top=np.full(h.shape,65,dtype='float32'); open_ray=np.ones(h.shape,dtype=bool)
    for level in np.arange(63,-1,-2):
        row=level*LEAN/M_PER_PX
        near=np.roll(h,-int(row),axis=0)
        far=np.roll(h,-int(row)-1,axis=0)
        hit=open_ray & (near+(far-near)*(row%1)>=level)
        top[hit]=level+2
        open_ray[hit]=False
    top[open_ray]=2
    low=np.maximum(top-2,0)
    for _ in range(4):
        mid=(low+top)/2
        under=sample(h,mid)>=mid
        low=np.where(under,mid,low);top=np.where(under,top,mid)
    height=(low+top)/2
    light_final=sample(lit,height)
    crop=np.s_[PAD:PAD+SIZE,PAD:PAD+SIZE]
    # Lossless two-channel texture: luminance and height of the material at this pixel.
    planes=np.stack([light_final[crop].astype('uint8'),np.round(height[crop]*4).clip(0,255).astype('uint8')],axis=-1)
    gray,depth=Image.fromarray(planes,'LA').split()
    img=Image.merge('RGB',(gray,depth,gray))
    for level,resolution in [('s',448)]:
        folder=OUT/level
        folder.mkdir(parents=True,exist_ok=True)
        result=img if resolution==SIZE else img.resize((resolution,resolution),Image.Resampling.LANCZOS)
        result.save(folder/f'{x}-{y}.webp',lossless=True,method=2)

if __name__=='__main__':
    with ProcessPoolExecutor(max_workers=4) as pool:
        list(pool.map(raw_tile,TILES))
        list(pool.map(render,TILES))
    print(len(TILES),'teselas de relieve')
