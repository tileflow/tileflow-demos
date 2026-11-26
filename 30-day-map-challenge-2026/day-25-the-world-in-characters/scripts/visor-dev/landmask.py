"""Make a sub-degree land lookup used to place geographic characters. Nothing is drawn as imagery."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,base64
work=Path(__file__).resolve().parents[1]; data=json.loads((work.parent/'public/detail/natural-earth.json').read_text())
width,height=1440,720
mask=Image.new('1',(width,height));draw=ImageDraw.Draw(mask)
for key,value in [('land',1),('landHoles',0)]:
    for ring in data[key]:
        draw.polygon([((x+180)*4,(90-y)*4) for x,y in ring],fill=value)
out=work.parent/'public/detail/land-mask.json'
out.write_text(json.dumps(dict(width=width,height=height,bits=base64.b64encode(mask.tobytes()).decode()),separators=(',',':')))
