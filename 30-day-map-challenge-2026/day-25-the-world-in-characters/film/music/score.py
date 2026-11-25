"""Typesetter's Waltz, an original score for The World in Characters.

Render with Python 3 and numpy, ffmpeg (environment variable FFMPEG or PATH)
and the Logic/GarageBand Acoustic Guitar and Upright Jazz Bass instruments.
All other sounds, including the press, ribbon and room, are synthesized here.
"""
import argparse
from functools import lru_cache
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import wave
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wordmark', type=float, default=29.8)
parser.add_argument('--duration', type=float, default=32)
parser.add_argument('--out', type=Path, default=Path(__file__).with_name('typesetters-waltz.wav'))
args = parser.parse_args()
if not 1.3 < args.duration-args.wordmark < 4.5:
    parser.error('Allow 1.3 to 4.5 seconds for the final chord.')
sr = 48000
bar = args.wordmark / 15
eighth = bar / 6
samples = round(sr * args.duration)
rng = np.random.default_rng(251125)
library = Path('/Library/Application Support')
bass_dir = library / 'GarageBand/Instrument Library/Sampler/Sampler Files/Upright Jazz Bass'
guitar_exs = library / 'Logic/Sampler Instruments/08 Guitars/Acoustic Guitar.exs'
guitar_caf = library / 'Logic/EXS Factory Samples/07 Guitars/02 Acoustic Guitars/Acoustic Guitar_consolidated.caf'
ff = os.getenv('FFMPEG') or shutil.which('ffmpeg')
if not ff:
    raise SystemExit('Install FFmpeg or set FFMPEG to its path.')

def smooth(x):
    x = np.clip(x, 0, 1)
    return x*x*(3-2*x)

def rms(x):
    return np.sqrt(np.mean(x*x)+1e-16)

def timed(n):
    return np.arange(round(n*sr)) / sr

def soft_end(t, release):
    return smooth((t[-1] - t) / release)

def time_at(i, tick, random_ms=.004):
    # The second note of a pair sits just behind the rebound of the action.
    shuffle = .014 if abs(tick % 1 - .5) < .001 else 0
    return max(0, i*bar + tick*eighth + shuffle + rng.uniform(-random_ms,random_ms))

stems = {name:np.zeros((samples,2),dtype=np.float32) for name in ('guitar','bass','bars','press','air')}
def put(name, audio, at, volume, pan):
    start = round(at*sr)
    n = min(len(audio),samples-start)
    if n<=0: return
    stems[name][start:start+n] += (audio[:n,None]*volume*
                                    np.sqrt([(1-pan)*.5,(1+pan)*.5]))

def colored_noise(n, bands):
    freq = np.fft.rfftfreq(n,1/sr)
    spec = np.fft.rfft(rng.normal(size=n))
    shape = np.zeros_like(freq)
    for center, width, gain in bands:
        shape += gain*np.exp(-.5*((freq-center)/width)**2)
    result = np.fft.irfft(spec*shape,n)
    return result/(rms(result)+.005)

# A quiet open-string and muted family from the installed guitar.
# Offsets come from the instrument zones rather than hand-trimmed sample files.
def guitar_sources():
    zones = {'open':{},'mute':{}}
    data = guitar_exs.read_bytes()
    offset = 0
    while offset < len(data):
        tag,size = struct.unpack_from('<II',data,offset)
        if tag == 0x01000101:
            family = struct.unpack_from('<I',data,offset+172)[0]
            note = data[offset+85]
            if family == 6 or family in (9,10,11,12,13):
                begin,end = struct.unpack_from('<II',data,offset+96)
                zones['open' if family==6 else 'mute'][note] = (begin,end)
        offset += size+84
    with guitar_caf.open('rb') as f:
        f.read(8)
        while chunk:=f.read(12):
            kind, length = struct.unpack('>4sq',chunk)
            if kind==b'data':
                f.read(4)
                return zones,np.memmap(guitar_caf,mode='r',dtype='>i2',offset=f.tell(),shape=((length-4)//2,))
            f.seek(length,1)
    raise ValueError('Acoustic Guitar audio not found')
zones, guitar_pcm = guitar_sources()
bass_notes = {}
for filename in sorted(bass_dir.iterdir()):
    match = re.fullmatch(r'KBLONS[12]([A-G])(#?)([0-5])X0([1-6])',filename.name)
    if match:
        pitch = int(match[3])*12+12+'C D EF G A B'.index(match[1]) + bool(match[2])
        bass_notes.setdefault(pitch,[]).append(filename)

@lru_cache(maxsize=40)
def bass_recording(path):
    data = subprocess.check_output([ff,'-v','error','-i',str(path),'-ar',str(sr),'-ac','1','-f','f32le','-'])
    x = np.frombuffer(data,'<f4')
    early = np.flatnonzero(np.abs(x[:6500]) > np.max(np.abs(x))*.018)
    start = max(0,int(early[0])-40) if len(early) else 0
    return x[start:]

def pluck(pitch,length,mode):
    if mode=='bass':
        key = min(bass_notes,key=lambda n:abs(n-pitch))
        x = bass_recording(bass_notes[key][0])
        release,rate = .13,1.
    else:
        collection = zones[mode]
        key = min(collection,key=lambda n:abs(n-pitch))
        begin,end = collection[key]
        x = guitar_pcm[begin:end]/32768.
        release,rate = (.135 if mode=='mute' else .19),44100/sr
    t = timed(length+release)
    y = np.interp(t*sr*rate*2**((pitch-key)/12),np.arange(len(x)),x,right=0)
    y -= np.mean(y)
    y *= smooth(t/.0012)*soft_end(t,release)
    return y/max(.009,rms(y[:round(.16*sr)]))

def struck_bar(pitch, length, color):
    # Free-free wood tongue with two much shorter upper partials. A tine
    # coupled at the bridge provides the bright reply to the wooden melody.
    f=440*2**((pitch-69)/12)
    t=timed(length)
    if color=='wood':
        modes=[(1,1,.48),(3.01,.25,.20),(4.08,.18,.13),(8.62,.055,.044)]
        attack=.003
    else:
        modes=[(1,1,.63),(2.005,.31,.46),(3.97,.19,.22),(6.69,.115,.12)]
        attack=.006
    y=np.zeros_like(t)
    for mul,amp,decay in modes:
        y+=amp*np.sin(2*np.pi*f*mul*t)*np.exp(-t/(decay*(392/f)**.17))
    hammer=colored_noise(len(t),[(930,430,.6),(2200,800,.32)])
    return (y+.052*hammer*np.exp(-t/.014))*smooth(t/attack)*soft_end(t,.08)

def type_key(soft):
    # Key impact, return spring, and the softer wood/platen resonance.
    t=timed(.14 if soft else .18)
    click=colored_noise(len(t),[(1850,650,.7),(4600,1150,.55),(780,250,.35)])
    y=(.48*click+.35*np.sin(2*np.pi*715*t)+.32*np.sin(2*np.pi*358*t))*np.exp(-t/.014)*smooth(t/.0013)
    gap=.039+rng.uniform(0,.014)
    r=np.maximum(0,t-gap)
    y+=.21*click*np.exp(-r/.009)*smooth(r/.0018)
    return y*(.68 if soft else 1.0)*soft_end(t,.015)

def ribbon(duration):
    t=timed(duration)
    y=colored_noise(len(t),[(1080,650,.68),(3100,930,.30)])
    return y*np.sin(np.pi*t/duration)**1.7*(.78+.13*np.sin(24*t)+.09*np.sin(91*t))

# Written in D, two groups of three eighths per measure. The melody states
# its four-note question twice, trades register with the guitar in the city,
# then returns over the plagal turn into the final signature.
# Each tuple contains bass, guitar voicing, and cue melody (eighth, MIDI, length).
score=[
 (38,[50,57,64,66],[(0,69,1.5),(1.5,74,1.4),(3.5,73,.8),(4.5,69,1.4)]),
 (42,[54,57,62,64],[(.5,66,2.3),(3,64,1),(4.5,62,1.3)]),
 (43,[55,59,62,69],[(0,67,1.1),(1.5,71,1),(3,74,2.3)]),
 (45,[52,57,62,66],[(.5,76,1.1),(2,74,1.2),(4,69,1.5)]),
 (47,[54,57,62,66],[(0,69,1.3),(1.5,74,1),(3,78,1.3),(4.5,76,1.4)]),
 (43,[55,59,62,66],[(0,74,2),(3,71,1),(4.5,67,1.3)]),
 (42,[54,57,62,69],[(1,66,.75),(2,69,.8),(3.5,74,.7),(4.5,78,1.1)]),
 (45,[52,57,61,67],[(0,76,.8),(1.5,73,1),(3,69,.9),(4,67,.7),(5,64,.8)]),
 (43,[55,59,62,69],[(0,71,1.4),(1.5,74,.8),(3,78,1.2),(4.5,76,.9)]),
 (40,[52,55,59,66],[(0,74,1.3),(2,71,1.0),(3.5,67,1),(5,66,.8)]),
 (47,[54,57,62,64],[(0,69,1.1),(1.5,74,.9),(3,73,.8),(4,69,1.5)]),
 (45,[52,57,62,67],[(0,67,.9),(1.5,69,1.6),(4,64,1.3)]),
 (42,[54,57,62,66],[(0,66,1.6),(2,69,1.2),(3.5,74,2.2)]),
 (43,[55,59,62,66],[(0,71,2.1),(3,69,1),(4.5,67,1.2)]),
 (45,[52,57,61,67],[(0,64,1.6),(2,67,1.1),(3.5,69,1.3),(5,73,.80)])]
guitar_patterns=[
 [(0,0),(1,2),(2,1),(3.5,3),(4.5,2)],
 [(0,0),(1.5,1),(2.5,2),(4,3),(5,1)],
 [(0,0),(1,1),(2,3),(3,2),(4.5,3)],
 [(0,1),(1.5,2),(3,0),(4,3),(5,2)]]
for i,(root,voicing,melody) in enumerate(score):
    city=6<=i<=10
    # The first downbeat already sounds underneath the opening title.
    guitar_part=guitar_patterns[i%4]
    if i<2: guitar_part=[(0,0),(1,1),(2.5,2),(4,3)]
    for tick,degree in guitar_part:
        pitch=voicing[degree]
        articulation='mute' if city and tick%1==.5 and degree<3 else 'open'
        volume=.048*(1 if tick in (0,3) else .79)*(1 if i<12 else .90)
        put('guitar',pluck(pitch,(.66 if articulation=='mute' else 2.1)*eighth,articulation),
            time_at(i,tick),volume*rng.uniform(.93,1.07),-.26+.05*degree)
    for line,(tick,pitch,hold) in enumerate(melody):
        volume = .16*(1.08 if line==0 else .91)
        length=min(1.24,hold*eighth+.55)
        put('bars',struck_bar(pitch,length,'wood'),time_at(i,tick),volume,.12)
        if line==0 or (i in (2,4,8,12) and line==2):
            put('bars',struck_bar(pitch+(12 if i in (2,8,12) else 0),length+.19,'tine'),
                time_at(i,tick)+.008,volume*(.22 if i<11 else .17),.34)
    bass_part=[(0,root,2.45,.098),(3.4,root+7,1.45,.062)]
    if i<2: bass_part=[]
    if i==2: bass_part=[(0,root,4.25,.111),(5,45,.7,.057)]
    if city: bass_part=[(0,root,2.1,.104),(2.5,root+12,.76,.050),(4,root+7,1.25,.08)]
    if i==13: bass_part=[(0,root,3.8,.09)]
    if i==14: bass_part=[(0,root,2.35,.083),(3,45,1.2,.057),(5,37,.74,.046)]
    for tick,pitch,hold,volume in bass_part:
        put('bass',pluck(pitch,hold*eighth,'bass'),time_at(i,tick),volume,-.035)
    # The press first replies to the opening motif, then settles into 3 + 3.
    taps=[(1.5,.030),(3,.055),(4.5,.029)] if i>=2 else [(3,.032)]
    if city: taps=[(.5,.036),(2,.042),(3,.076),(4.5,.047),(5.5,.033)]
    if i>=12:taps=[(3,.045),(5,.027)] if i==12 else [(3,.026)]
    for idx,(tick,volume) in enumerate(taps):
        put('press',type_key(idx%2==0),time_at(i,tick,.007),volume*rng.uniform(.89,1.09),[-.30,.17,.37,.02][idx%4])
for at,seconds,level in [(bar*3-.40,.42,.015),(bar*6-.38,.45,.020),(bar*11-.42,.47,.019),(bar*14-.58,.52,.015)]:
    put('air',ribbon(seconds),at,level,.20)

# The closing chord is articulated low to high, like one action of the press.
for j,pitch in enumerate([50,57,62,64,66,69]):
    put('guitar',pluck(pitch,1.32+.055*j,'open'),args.wordmark+.009*j,.052 if j<3 else .036,-.25+.075*j)
put('bass',pluck(38,1.41,'bass'),args.wordmark,.102,-.035)
put('bars',struck_bar(74,1.95,'wood'),args.wordmark+.026,.19,.10)
put('bars',struck_bar(78,1.83,'tine'),args.wordmark+.034,.037,.28)
put('press',type_key(False),args.wordmark+.008,.056,-.08)

def room(stereo):
    # Stereo room response with a dense, rapidly damped tail and early
    # reflections. The direct signal stays in front of the paper-like taps.
    n=2**math.ceil(math.log2(len(stereo)+sr))
    out=np.zeros_like(stereo)
    for ch in range(2):
        t=timed(.86)
        tail=colored_noise(len(t),[(820,600,.69),(2200,980,.37),(4900,1400,.13)])
        impulse=tail*np.exp(-t/.092)*smooth(t/.026)*smooth((.86-t)/.11)
        impulse*=.20/np.sqrt(np.sum(impulse**2))
        for delay,amount in [(16,.115),(29,.078),(43,.12),(69,.057)]:
            impulse[round((delay+ch*5)*sr/1000)]+=amount
        send=stereo[:,ch]*.73+stereo[:,1-ch]*.27
        out[:,ch]=np.fft.irfft(np.fft.rfft(send,n)*np.fft.rfft(impulse,n),n)[:len(send)]
    return out

dry=sum(stems.values())
wet=room(stems['guitar']*.86+stems['bars']+stems['bass']*.20+stems['press']*.52)
master=dry+wet
t=np.arange(samples)/sr
master*=smooth(t/.007)[:,None]*smooth((t[-1]-t)/.29)[:,None]
# One uniform gain, referenced to perceptual programme loudness by ffmpeg.
raw=subprocess.run([ff,'-hide_banner','-f','f32le','-ar',str(sr),'-ac','2','-i','-','-af','ebur128=peak=true','-f','null','-'],
    input=master.astype('<f4').tobytes(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True).stderr.decode()
loud=float(re.findall(r'I:\s+([\-\d.]+) LUFS',raw)[-1])
peak=float(re.findall(r'Peak:\s+([\-\d.]+) dBFS',raw)[-1])
gain_db=min(-16.5-loud,-1.55-peak)
master*=10**(gain_db/20)
with wave.open(str(args.out),'wb') as f:
    f.setparams((2,3,sr,0,'NONE','not compressed'))
    q=np.round(np.clip(master,-1,1-1/2**23)*(2**23)).astype('<i4')
    f.writeframes(q.reshape(-1).view(np.uint8).reshape(-1,4)[:,:3].tobytes())
print(f'{args.out}: {args.duration:.3f}s, 48kHz/24-bit stereo, {loud+gain_db:.1f} LUFS, {peak+gain_db:.1f} dBTP')
