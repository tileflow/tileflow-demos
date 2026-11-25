import json
import sys
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parent
if len(sys.argv)>1:root=root/sys.argv[1]
reg=json.loads((root/'register.json').read_text())
w,h,r=reg['w'],reg['h'],reg['ratio']
cols,rows=reg['cells']
tw,th=[n*r for n in reg['tile']]
out=Image.new('RGB',(w*r,h*r))
for row in range(rows):
    for col in range(cols):
        with Image.open(root/'tiles'/f'{row}-{col}.png') as part:
            if part.size!=(tw,th):
                raise ValueError(f'Tile {row}/{col} measures {part.size}')
            out.paste(part,(col*tw,row*th))
for level in [8,4,2,1]:
    im=out if level==1 else out.resize((round(out.width/level),round(out.height/level)),Image.Resampling.LANCZOS)
    im.save(root/f'plate-{level}.png',compress_level=3)
print('Registered image',out.size,flush=True)
