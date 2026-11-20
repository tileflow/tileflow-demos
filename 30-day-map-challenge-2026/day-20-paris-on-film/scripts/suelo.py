"""Ground contact light and stylised park tree positions, keyed to Tileflow coordinates."""
import sys,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
p=Path(sys.argv[1]); out=Path(__file__).resolve().parents[1]/'public/maqueta'
size=1280;pad=24
for path in sorted(p.glob('raw-*-*.png')):
    _,x,y=path.stem.split('-');x=int(x);y=int(y)
    field=Image.new('L',(size+2*pad,size+2*pad))
    for dy in [-1,0,1]:
        for dx in [-1,0,1]:
            fn=p/f'raw-{x+dx}-{y+dy}.png'
            if fn.exists():
                with Image.open(fn) as im: field.paste(im.getchannel(0),(pad+dx*size,pad+dy*size))
    h=np.asarray(field,dtype=np.float32)/4
    mask=np.zeros_like(h)
    for offset in (2,4,7,10,15):
        caster=np.roll(h,(offset,round(offset*.72)),axis=(0,1))
        mask=np.maximum(mask,np.clip((caster-h-offset*1.3)/12,0,1)*np.exp(-offset/15))
    img=Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.GaussianBlur(2.0))
    img.crop((pad,pad,size+pad,size+pad)).resize((640,640),Image.Resampling.LANCZOS).save(out/f'{x}-{y}.webp',lossless=True)
    with Image.open(path) as im: raw=np.asarray(im)
    heights=raw[:,:,0];surface=raw[:,:,1];rng=np.random.default_rng(x+y*9000)
    samples=[]
    for j in range(9,size-8,13):
        for i in range(9,size-8,13):
            px=i+int(rng.integers(-5,6));py=j+int(rng.integers(-5,6))
            if surface[py,px] in (214,240) and heights[py,px]<50 and rng.random()<.38:
                samples.append([round(px*4096/size),round(py*4096/size),round(rng.uniform(2.9,5),1)])
    (p/f'trees-{x}-{y}.json').write_text(json.dumps(samples,separators=(',',':')))
