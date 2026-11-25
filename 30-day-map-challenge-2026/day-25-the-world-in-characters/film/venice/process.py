"""Bring in finer printing by locality while the two maps share one exact camera."""
import json
import os
from pathlib import Path
import subprocess
import shutil

import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
ff = os.getenv('FFMPEG','ffmpeg')
route = json.loads((root/'camera.json').read_text())
clips = route['keyClips']
frames = root/'frames'
frames.mkdir(exist_ok=True)
joins = [(left['at']+right['at'])//2 for left,right in zip(clips,clips[1:])]
# Wide, slow variations distribute the redrawing of lettering and paths over
# the screen. Each point stays at precisely its surveyed geographic position.
y,x = np.ogrid[:1080,:1920]
phase = (.5 + .2*np.sin(x/260+y/405) + .16*np.sin(x/385-y/260) + .12*np.cos(x/182+y/310)).astype('float32')
command = [ff,'-nostdin','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-framerate','30',
           '-i','pipe:0','-an','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1','-c:v','libx264','-crf','12',
           '-pix_fmt','yuv420p','-preset','fast','-threads','4','-color_primaries','bt709','-colorspace','bt709','-color_trc','bt709','-movflags','+faststart',str(root/'arrival.next.mp4')]
def printed(k,frame):
    return root/'plates'/str(k)/f'{frame}.png'
def rgb(filename):
    return np.asarray(Image.open(filename).convert('RGB'))
with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
    for i in range(174):
        dest = frames/f'{i:03}.png'
        nearest = int(np.argmin(np.abs(np.array(joins)-i)))
        offset = i-joins[nearest]
        if -3<offset<3:
            a,b=rgb(printed(nearest,i)),rgb(printed(nearest+1,i))
            t = np.clip(((offset+3)/6-phase*.48)/.52,0,1)
            t = (t*t*(3-2*t))[...,None]
            pic=np.rint(a*(1-t)+b*t).astype('uint8')
            Image.fromarray(pic).save(dest,compress_level=2)
        else:
            index = sum(i>=j for j in joins)
            source = printed(index,i)
            shutil.copyfile(source,dest)
            pic = rgb(source)
        encoder.stdin.write(pic.tobytes())
    encoder.stdin.close()
    if encoder.wait(): raise RuntimeError('Video encoding failed')
(root/'arrival.next.mp4').replace(root/'arrival.mp4')
shutil.copyfile(frames/'173.png',root/'arrival-173.png')
assert (frames/'000.png').read_bytes() == (root/'first.png').read_bytes()
samples=[0,17,35,52,69,86,103,120,137,150,163,173]
board=Image.new('RGB',(1200,4*246),'#faf8f1')
draw=ImageDraw.Draw(board)
for j,i in enumerate(samples):
    left,top=j%3*400,j//3*246
    pic=Image.open(frames/f'{i:03}.png').convert('RGB').resize((400,225),Image.Resampling.LANCZOS)
    board.paste(pic,(left,top))
    draw.text((left+6,top+226),f't={18+i/30:.2f}  z={route["camera"][i]["z"]:.2f}',fill='#324c46')
board.save(root/'arrival-contact.jpg',quality=94)
