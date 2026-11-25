"""The World in Characters, fourth cut. Photograph one regional sheet for the passage from Spain to Italy."""
import os
from pathlib import Path
import struct
import subprocess

here = Path(__file__).resolve().parent
output = here / 'renders'
output.mkdir(exist_ok=True)
original = here
ff = os.environ.get('FFMPEG') or 'ffmpeg'
takes = [
    (here/'orbit/opening.mp4', 210),
    (here/'med/passage.mp4', 330),
    (here/'venice/arrival.mp4', 174),
    (here/'return/departure.mp4', 183),
    (original/'brand/signoff.mp4', 75),
]

def boxes(data):
    pos = 0
    while pos + 8 <= len(data):
        n, name = struct.unpack_from('>I4s', data, pos)
        header = 8
        if n == 1:
            n, = struct.unpack_from('>Q',data,pos+8)
            header = 16
        n = n or len(data)-pos
        yield name, data[pos+header:pos+n]
        pos += n

def frames(path):
    moov = dict(boxes(path.read_bytes()))[b'moov']
    for name, tr in boxes(moov):
        if name == b'trak':
            md = dict(boxes(dict(boxes(tr))[b'mdia']))
            if md[b'hdlr'][8:12] == b'vide':
                sz = dict(boxes(dict(boxes(md[b'minf']))[b'stbl']))[b'stsz']
                return struct.unpack_from('>I', sz, 8)[0]

def run(args):
    subprocess.run([ff,'-hide_banner','-loglevel','error','-y',*args],check=True)

args,graph = [],[]
for i,(take,n) in enumerate(takes):
    assert frames(take) == n, take
    args += ['-i',str(take)]
    graph += [f'[{i}:v]trim=end_frame={n},settb=1/30,setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v{i}]']
for name in ('cover-paper.png','cover-ink.png'):
    args += ['-loop','1','-framerate','30','-i',str(original/'brand'/name)]
graph += [
    '[5:v]format=rgba,fade=t=out:st=2.28:d=1.08:alpha=1[paper]',
    '[6:v]format=rgba,fade=t=out:st=2.45:d=0.55:alpha=1[ink]',
    "[v0][paper]overlay=shortest=1:enable='lt(t,3.4)'[base]",
    "[base][ink]overlay=x='-10*t-1.35*t*t-6*min(1,max(0,(t-2.45)/0.55))':y=0:shortest=1:enable='lt(t,3.1)'[cover]",
    '[cover][v1][v2][v3]concat=n=4:v=1:a=0,settb=1/30[atlas]',
    '[atlas][v4]xfade=transition=fade:duration=0.4:offset=29.5,format=yuv420p[film]',
]
picture = here/'picture.mp4'
run([*args,'-filter_complex_threads','4','-filter_complex',';'.join(graph),'-map','[film]','-an',
     '-frames:v','960','-c:v','libx264','-threads','5','-profile:v','high','-level:v','4.1','-crf','16',
     '-preset','medium','-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',str(picture)])
assert frames(picture) == 960
final = output/'The-World-in-Characters-v4.mp4'
temp = here/'release.mp4'
run(['-i',str(picture),'-i',str(here/'music/typesetters-waltz.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy',
     '-metadata','title=The World in Characters','-metadata',"comment=30DayMapChallenge - Day 25 - Is This a Map? | (c) Tileflow and OpenStreetMap contributors | Natural Earth, NOAA ETOPO 2022 | BDLJE, CC BY 4.0 ign.es | Ayuntamiento de Madrid | Original score: Typesetter's Waltz",'-t','32','-movflags','+faststart',str(temp)])
assert frames(temp) == 960
temp.replace(final)
print(final, flush=True)
