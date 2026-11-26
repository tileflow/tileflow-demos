"""Photograph a single regional map with inset sheets of progressively finer detail near Venice."""
import argparse
import json
import math
import os
from functools import cached_property
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw
from ink.route import render_route

ROOT = Path(__file__).resolve().parent
OLD = ROOT
SIZE = (1920, 1080)
PAPER = (250, 248, 241)
FF = os.getenv('FFMPEG', 'ffmpeg')
Image.MAX_IMAGE_PIXELS = 180_000_000

def read(path):
    return json.loads(path.read_text())

def smooth(x):
    u = np.clip(x, 0, 1)
    return u*u*(3-2*u)

class Sheet:
    """A georeferenced print. Its one-sided feather is fixed on the ground."""
    def __init__(self, folder, meta):
        self.folder = folder
        self.meta = meta
        self.origin = np.asarray(meta['origin'])
        self.dx = meta['dx']
        self.pyramid = {}

    @cached_property
    def pixels(self):
        return Image.open(self.folder/self.meta['file']).convert('RGB')

    def affine(self, camera):
        scale = self.dx / camera['dx']
        offset = self.origin - scale*np.asarray(camera['origin'])
        return (scale, 0, offset[0], 0, scale, offset[1])

    def inset(self, paper, camera, margin, end=False):
        # Each more detailed survey occupies a physical area of the atlas.
        # Its feather is in sheet pixels: panning never changes the drawing
        # at a geographic location once it has been printed.
        windows={'veneto':(6.09,7.08),'padova':(7.96,9.13),'laguna':(9.59,10.67),'endpoint':(10.53,10.98)}
        start,finish=windows[self.meta['id']]
        progress=(camera['z']-start)/(finish-start)
        if progress<=0:
            return paper
        s, _, ox, _, _, oy = self.affine(camera)
        xs = s*(np.arange(1920, dtype='float32')+.5)+ox
        ys = s*(np.arange(1080, dtype='float32')+.5)+oy
        width, height = self.meta['size']
        x = np.minimum(xs, width-xs)
        y = np.minimum(ys, height-ys)
        if x.max()<=0 or y.max()<=0:
            return paper
        # In the last half-second the arriving native frame reaches the edge
        # of the screen, with an exterior bleed from the surrounding lagoon.
        fringe = margin if not end else max(1.,margin*float(smooth((540-camera['i'])/18)))
        alpha = np.minimum(smooth(x/fringe)[None,:], smooth(y/fringe)[:,None])
        if progress<1:
            # The eastern side carries the first fine marks. Only one narrow
            # part of the field is exchanging its type at any given instant.
            # Every impression is sampled in the same geographic projection.
            phase=.34*(1-np.linspace(0,1,1920,dtype='float32')[None,:])
            phase=phase+.08*np.sin(ys[:,None]/510+xs[None,:]/730)
            alpha*=smooth((progress*1.01-phase-.10)/.51)
        if alpha.max()<.002:
            return paper
        # The innermost paper is visible in the distance as a faint texture.
        # Downsample before mapping so glyphs never alias or glitter on approach.
        factor = next(v for v in [16,8,4,2,1] if s>=v or v==1)
        if factor not in self.pyramid:
            self.pyramid[factor]=self.pixels.reduce(factor)
        source=self.pyramid[factor]
        finer=source.transform(SIZE,Image.Transform.AFFINE,
                               (s/factor,0,ox/factor,0,s/factor,oy/factor),
                               Image.Resampling.BICUBIC,fillcolor=PAPER)
        if alpha.min()>.998:
            return finer
        mask=Image.fromarray(np.uint8(np.round(alpha*255)))
        joined=Image.composite(finer,paper,mask)
        # Dark city names occupy different widths in the two type sizes.
        # Lift their old impression slightly before setting the new one.
        # Coastlines and road alignments retain the simple registered blend.
        if .01<progress<.99:
            a=np.asarray(paper); b=np.asarray(finer)
            old_mask=(a[:,:,0]<140)&(a[:,:,1].astype('int16')>a[:,:,0].astype('int16')+8)
            new_mask=(b[:,:,0]<140)&(b[:,:,1].astype('int16')>b[:,:,0].astype('int16')+8)
            zone=(old_mask|new_mask)&(alpha>.04)&(alpha<.96)
            if np.any(zone):
                out=np.array(joined); al=alpha[zone,None]
                old_ink=(np.array(PAPER)-a[zone])*np.minimum(1, (1-al)*1.5)**2*(1-al)
                new_ink=(np.array(PAPER)-b[zone])*np.minimum(1, al*1.5)**2*al
                out[zone]=np.clip(np.array(PAPER)-old_ink-new_ink,0,255).astype('uint8')
                joined=Image.fromarray(out)
        return joined

class Flight:
    def __init__(self):
        job=read(ROOT/'camera/flight.json')
        self.frames={r['i']:r for r in job['frames']}
        self.old=read(OLD/'med/journey.json')
        self.orbit=read(OLD/'orbit/camera.json')
        self.insets=[Sheet(ROOT/'landing',r) for r in read(ROOT/'landing/registration.json')]
        self.credit=Image.open(ROOT/'camera/credit.png').convert('RGB')
        self.credit_pos=tuple(round(2*job['creditBox'][k]) for k in ['x','y'])
        self.logo=Image.open(ROOT/'landing/wordmark.png').convert('RGBA')
        self.logo_pos=(0,SIZE[1]-self.logo.height)
        from atlas.sheet import from_sample
        self.regional=from_sample

    def map(self,i,inking=True):
        camera=self.frames[i]
        sample={'origin':(np.asarray(camera['origin'])/2).tolist(),'dx':camera['dx']/2}
        paper=self.regional(sample)
        if i>210:
            for sheet,margin in zip(self.insets,[230,185,145,140]):
                paper=sheet.inset(paper,camera,margin,sheet.meta['id']=='endpoint')
        if not inking or i<210:
            return paper
        n = i-210
        t = n/30
        amplitude = float(smooth((t-.12)/.62)*smooth((10.94-t)/.81))
        if amplitude>.0001:
            previous=self.old['samples'][n]
            positions=np.array(read(OLD/'med'/f'route-{n}.json'))
            factor=camera['dx']/(2*previous['dx'])
            positions=(positions-2*np.array(previous['origin']))*factor+np.array(camera['origin'])
            lead=.19*float(smooth(t/1.25)*smooth((11.-t)/.7))
            render_route(paper,positions,(t+lead)*90,amplitude)
        return paper

    def brand(self,paper):
        paper.paste(self.credit,self.credit_pos)
        paper.paste(self.logo,self.logo_pos,self.logo)
        return paper

    def frame(self,i):
        if i>=210:
            paper=self.map(i)
            if i<421:
                return paper
            if i<451:
                return Image.blend(paper,self.brand(paper.copy()),float(smooth((i-421)/30)))
            return self.brand(paper)
        first=self.orbit['firstFlat']
        last=self.orbit['lastGlobe']
        if i<=first:
            return Image.open(OLD/'orbit/frames'/f'sphere-{i:03}.png').convert('RGB')
        row=self.orbit['frames'][i]
        cartography=self.map(i)
        if i>last:
            return cartography
        # The old orbit is untouched until Madrid begins to resolve on the
        # spherical face. Carry the same regional paper out of that reveal.
        sphere=Image.open(OLD/'orbit/frames'/f'sphere-{i:03}.png').convert('RGB')
        flat=np.asarray(row['flat']['points']); globe=np.array(list(row['globe']['points'].values()))
        src,dst=flat-flat.mean(axis=0),globe-globe.mean(axis=0)
        den=np.sum(src*src)
        a=np.sum(src*dst)/den
        b=np.sum(src[:,0]*dst[:,1]-src[:,1]*dst[:,0])/den
        m=np.array([[a,-b],[b,a]])
        d=globe.mean(axis=0)-m@flat.mean(axis=0)
        sphere=sphere.transform(SIZE,Image.Transform.AFFINE,(a,-b,d[0],b,a,d[1]),Image.Resampling.BICUBIC,fillcolor=PAPER)
        x=np.arange(1920,dtype='float32')[None,:]; y=np.arange(1080,dtype='float32')[:,None]
        cx,cy=flat[-1]
        distance=np.hypot(x-cx,(y-cy)*1.16)
        extent=max(np.hypot(x-cx,(y-cy)*1.16) for x in (0,1920) for y in (0,1080))
        radius=(extent+210)*smooth((i-first)/(last-first))-105
        coverage=smooth((radius-distance)/210+.5)
        # Keep the original globe-to-paper aperture at the start of the zoom.
        (l,top),(r,bottom)=row['flat']['corners']
        edges=np.minimum(np.minimum(x-l,r-x),np.minimum(y-top,bottom-y))
        coverage*=smooth(edges/86)
        return Image.composite(cartography,sphere,Image.fromarray(np.uint8(np.round(coverage*255))))

def encode(flight, out, first, count):
    out.parent.mkdir(exist_ok=True)
    temp = out.with_suffix('.next.mp4')
    cmd=[FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-framerate','30','-i','pipe:',
         '-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p','-an','-c:v','libx264','-threads','4','-crf','12','-preset','fast',
         '-color_primaries','bt709','-colorspace','bt709','-color_trc','bt709','-movflags','+faststart',str(temp)]
    with subprocess.Popen(cmd,stdin=subprocess.PIPE) as movie:
        for i in range(first,first+count):
            movie.stdin.write(flight.frame(i).tobytes())
        movie.stdin.close()
        if movie.wait():
            raise RuntimeError(f'Error encoding {out.name}')
    temp.replace(out)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--proof',action='store_true')
    parser.add_argument('--part',choices=['opening','journey','all'],default='all')
    args=parser.parse_args()
    flight=Flight()
    if args.proof:
        chosen=[150,174,191,210,242,261,280,318,356,394,426,443,457,469,478,489,503,514,524,532,539]
        contact=Image.new('RGB',(3*480,math.ceil(len(chosen)/3)*296),PAPER)
        draw=ImageDraw.Draw(contact)
        for j,i in enumerate(chosen):
            frame=flight.frame(i)
            x,y=(j%3)*480,(j//3)*296
            contact.paste(frame.resize((480,270),Image.Resampling.LANCZOS),(x,y))
            draw.text((x+8,y+275),f'{i/30:.2f} s',fill='#314840')
        contact.save(ROOT/'proof.jpg',quality=94)
    else:
        if args.part in ('all','opening'):encode(flight,ROOT/'orbit/opening.mp4',0,210)
        if args.part in ('all','journey'):encode(flight,ROOT/'med/passage.mp4',210,330)
