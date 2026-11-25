"""Encode 5-arcminute ETOPO 2022 point samples as compact, lazy regional blocks.
Input NOAA ERDDAP netCDF classic (query in the manifest). Runtime reads arrays, never paints pixels.
"""
import gzip,hashlib,json,math,pathlib,struct,sys
import numpy as np
base=pathlib.Path(__file__).resolve().parent
file=base/'topography.nc'
buf=file.read_bytes()
assert buf[:4]==b'CDF\1'
pos=8
def uint():
    global pos
    val=struct.unpack_from('>I',buf,pos)[0];pos+=4;return val
def take(n):
    global pos
    result=buf[pos:pos+n];pos+=(n+3)&~3;return result
def name():return take(uint()).decode()
def series(tag,reader):
    got,count=uint(),uint()
    assert got==tag or (got==0 and count==0)
    return [reader() for _ in range(count)]
def attrs():
    def attr():
        key=name();kind,n=uint(),uint();return key,take(n*{1:1,2:1,3:2,4:4,5:4,6:8}[kind])
    return dict(series(12,attr))
dims=series(10,lambda:(name(),uint()));attrs()
def var():
    key=name();axes=[uint() for _ in range(uint())];attrs();kind,size,offset=uint(),uint(),uint()
    dt={3:'>i2',4:'>i4',5:'>f4',6:'>f8'}[kind]
    return key,np.frombuffer(buf,dtype=dt,count=math.prod(dims[i][1] for i in axes),offset=offset).reshape([dims[i][1] for i in axes])
v=dict(series(11,var))
z=v['z'];lat=v['latitude'];lon=v['longitude']
if lat[0]<lat[-1]:z=z[::-1];lat=lat[::-1]
assert z.shape==(2160,4320) and lon[1]>lon[0] and np.isfinite(z).all() and z.min()>-14000
out=base.parents[1]/'public/detail/terrain';out.mkdir(exist_ok=True)
encoded=np.rint(z/8).astype("<i2")
for row in range(6):
    for col in range(12):
        (out/f'{row}-{col}.gz').write_bytes(gzip.compress(encoded[row*360:(row+1)*360,col*360:(col+1)*360].tobytes(),mtime=0))
manifest=dict(west=float(lon[0]),north=float(lat[0]),step=1/12,tile=360,width=4320,height=2160,metersPerUnit=8,
    source='NOAA NCEI ETOPO 2022 ice surface, sampled every 5 arc-minutes',doi='https://doi.org/10.25921/fd45-gt74',
    url='https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.nc?z%5B2:5:10799%5D%5B2:5:21599%5D',sha256=hashlib.sha256(buf).hexdigest())
(out/'index.json').write_text(json.dumps(manifest,indent=2))
print(manifest, sum(f.stat().st_size for f in out.glob('*.gz')))
