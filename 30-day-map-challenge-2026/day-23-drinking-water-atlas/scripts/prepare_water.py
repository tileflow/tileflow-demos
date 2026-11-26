"""Reproduce public/data/agua.json and agua.csv with Python 3 (standard library).

Run from any directory: python3 scripts/prepare_water.py
Use --cache DIRECTORY to keep or reuse the downloaded inputs for an exact rerun.
"""
import argparse
import csv
import hashlib
import html
import json
import math
import re
import struct
import tempfile
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

YEAR = 2024
ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.washdata.org/v1/household/'
M49 = 'https://unstats.un.org/unsd/methodology/m49/overview/'
NE = 'https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_'
SAFE = 'Safely managed service'
COMMON = {'service_type': 'Drinking water', 'residence': 'total', 'format': 'csv'}

def endpoint(scope, **params):
    return API + 'estimates/' + scope + '?' + urlencode({**COMMON, **params})

INPUTS = {
    'current.csv': endpoint('country', year=YEAR),
    'history.csv': endpoint('country', service_level=SAFE, year_to=YEAR),
    'regions.csv': endpoint('region', year=YEAR),
    'groups.csv': API + 'country-regions?format=csv',
    'm49.html': M49,
    'countries.zip': NE + 'countries.zip',
    'map-units.zip': NE + 'map_units.zip',
}

STATES = set('''
AFG AGO ALB AND ARE ARG ARM ATG AUS AUT AZE BDI BEL BEN BFA BGD BGR BHR BHS BIH
BLR BLZ BOL BRA BRB BRN BTN BWA CAF CAN CHE CHL CHN CIV CMR COD COG COL COM CPV
CRI CUB CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESP EST ETH FIN FJI FRA FSM
GAB GBR GEO GHA GIN GMB GNB GNQ GRC GRD GTM GUY HND HRV HTI HUN IDN IND IRL IRN
IRQ ISL ISR ITA JAM JOR JPN KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA
LIE LKA LSO LTU LUX LVA MAR MCO MDA MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MOZ
MRT MUS MWI MYS NAM NER NGA NIC NLD NOR NPL NRU NZL OMN PAK PAN PER PHL PLW PNG
POL PRK PRT PRY PSE QAT ROU RUS RWA SAU SDN SEN SGP SLB SLE SLV SMR SOM SRB SSD
STP SUR SVK SVN SWE SWZ SYC SYR TCD TGO THA TJK TKM TLS TON TTO TUN TUR TUV TZA
UGA UKR URY USA UZB VAT VCT VEN VNM VUT WSM YEM ZAF ZMB ZWE
'''.split())

# Short English labels for the atlas. All other names follow the UN M49 English table.
NAMES = {
    'BOL':'Bolivia','BRN':'Brunei','COG':'Republic of the Congo','FSM':'Federated States of Micronesia',
    'GBR':'United Kingdom','HKG':'Hong Kong','IRN':'Iran','KOR':'South Korea','LAO':'Laos',
    'MAC':'Macao','MAF':'Saint Martin (French part)','MDA':'Moldova','NLD':'Netherlands',
    'NRU':'Nauru','PRK':'North Korea','PSE':'Palestine','RUS':'Russia','SYR':'Syria',
    'TZA':'Tanzania','USA':'United States','VAT':'Vatican City','VEN':'Venezuela','VNM':'Vietnam',
}

def download_inputs(cache):
    cache.mkdir(parents=True, exist_ok=True)
    for filename, url in INPUTS.items():
        out = cache / filename
        if out.exists():
            continue
        request = Request(url, headers={'User-Agent':'Water-Atlas/1.0'})
        with urlopen(request, timeout=120) as response:
            raw = response.read()
        partial = out.with_suffix('.part')
        partial.write_bytes(raw)
        partial.replace(out)

def read_csv(cache, filename):
    with (cache / filename).open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))

def m49_names(page, locale):
    section = re.search(r'<table\s+id\s*=\s*"downloadTable' + locale + r'".*?</table>', page, re.S)[0]
    result = {}
    for row in re.findall(r'<tr>(.*?)</tr>', section, re.S):
        cells = [html.unescape(cell.strip()) for cell in re.findall(r'<td>(.*?)</td>', row, re.S)]
        if cells[0] == '001':
            result[cells[11]] = (cells[8], cells[10], cells[7] or cells[5])
    return result

def label_points(archive):
    with zipfile.ZipFile(archive) as z:
        blob = z.read(next(n for n in z.namelist() if n.endswith('.dbf')))
    count, start, length = struct.unpack_from('<IHH', blob, 4)
    fields = [(blob[o:o+11].rstrip(b'\0').decode(), blob[o+16]) for o in range(32,start-1,32)]
    anchors = {}
    for index in range(count):
        offset = start + index * length + 1
        row = {}
        for name, size in fields:
            row[name] = blob[offset:offset+size].decode().strip(' \x00')
            offset += size
        code = 'XKX' if row['ADM0_A3'] == 'KOS' else row['ISO_A3_EH']
        # Dependencies may share the metropolitan ISO code (e.g. Clipperton, France).
        if code != '-99' and (code not in anchors or code == row['ADM0_A3']):
            anchors[code] = (float(row['LABEL_X']), float(row['LABEL_Y']))
    return anchors

def lookup_levels(rows, keys):
    result = defaultdict(dict)
    for r in rows:
        if r['value'] != '':
            value = float(r['value'])
            assert -0.000001 <= value <= 100.000001
            key = tuple(r[k].lower() for k in keys)
            assert r['service_level'] not in result[key]
            result[key][r['service_level']] = max(0.,min(100.,value))
    return result

def basic_share(levels):
    if 'At least basic' in levels:
        return levels['At least basic']
    if SAFE in levels and 'Basic service' in levels:
        return min(100., levels[SAFE] + levels['Basic service'])

def approximate(levels, peers, area_names):
    # S ⊆ B. Estimate S/B from the most local published comparator available.
    key, ref = next((k,r) for k,r in peers if r.get(SAFE) is not None and basic_share(r))
    ref_name = area_names[key[1]].strip()
    basic = basic_share(levels)
    if basic is None:
        value = ref[SAFE]
        note = f'Atlas approximation using safely managed coverage for the reference group ({ref_name}).'
    else:
        value = basic * ref[SAFE] / basic_share(ref)
        note = (f'Atlas approximation. Local coverage of at least basic drinking water service is scaled by '
                f'the share of people with at least basic service who have safely managed service '
                f'in the reference group ({ref_name}).')
    # Each known national component independently bounds safely managed coverage.
    caps = [levels[k] for k in ('Improved','On premises','Available','Free from contamination') if k in levels]
    if caps and min(caps) < value:
        value = min(caps)
        note += ' The estimate is capped at the lowest available national service component.'
    return int(math.floor(value + 0.5)), note

def compile_atlas(cache, dest):
    en = m49_names((cache/'m49.html').read_text(), 'EN')
    en.update({'XKX':('Kosovo','XK','Southern Europe'),'TWN':('Taiwan','TW','Eastern Asia')})
    labels = label_points(cache/'map-units.zip')
    labels.update(label_points(cache/'countries.zip'))
    groups = {r['iso3']:r for r in read_csv(cache,'groups.csv')}
    groups['TWN'] = {'sdg':'Eastern and South-Eastern Asia','income':''}
    groups['XKX']['sdg'] = 'Europe and Northern America'
    current = lookup_levels(read_csv(cache,'current.csv'), ['country'])
    region_rows = read_csv(cache,'regions.csv')
    regional = lookup_levels(region_rows, ['region_type','region'])
    names = {r['region'].lower():r['region'] for r in region_rows}
    names.update({r[2].lower():r[2] for r in en.values()})
    history = {}
    for r in read_csv(cache,'history.csv'):
        if r['value']:
            code, year = r['country'], int(r['year'])
            if code not in history or history[code][0] < year:
                history[code] = year, float(r['value'])
    countries = []
    assert len(STATES)==195 and STATES <= set(groups)
    for code, group in groups.items():
        levels = current[(code.lower(),)]
        ref_category, ref_group = '', ''
        if code in history:
            year, value = history[code]
            method = 'jmp' if year == YEAR else 'historical'
            note = (f'JMP national estimate for {year}.' if method=='jmp'
                    else f'The latest available JMP national estimate is for {year}.')
            value = round(value, 8)
            if method == 'jmp':
                assert abs(value - levels[SAFE]) < 1e-5
        else:
            year, method = YEAR, 'proxy'
            candidates = [('m49_sub',en[code][2].lower()),('sdg',group['sdg'].lower()),
                          ('income',group['income'].lower()),('world','world')]
            peers = [(k, regional[k]) for k in candidates if k in regional]
            value, note = approximate(levels, peers, names)
            key = next(k for k,r in peers if SAFE in r and basic_share(r))
            ref_category, ref_group = key[0], names[key[1]]
        lon,lat = labels[code]
        assert 0 <= value <= 100 and -180<=lon<=180 and -90<=lat<=90
        countries.append(dict(code=code,iso2=en[code][1],name=NAMES.get(code,en[code][0]),lon=lon,lat=lat,
                              value=value,year=year,method=method,note=note,region=en[code][2],
                              isState=code in STATES,proxyGroup=ref_group,proxyGroupType=ref_category))
    def alpha(row):
        return ''.join(c for c in unicodedata.normalize('NFD',row['name']) if not unicodedata.combining(c)).casefold()
    countries.sort(key=alpha)
    world = {'code':'WLD','iso2':'','name':'World','value':round(regional['world','world'][SAFE],8),
             'year':YEAR,'method':'jmp','note':'Global estimate published by the JMP.',
             'region':'World','proxyGroup':'','proxyGroupType':''}
    assert all(c['method']!='historical' or c['year']<YEAR for c in countries)
    counts = dict(Counter(c['method'] for c in countries))
    summary = {'total':len(countries),'states':len(STATES),'other':len(countries)-len(STATES),**counts,
               'statesByMethod':dict(Counter(c['method'] for c in countries if c['isState']))}
    data = {'year':YEAR,'indicator':'SDG 6.1.1','unit':'Percentage of the population',
            'world':world,'countries':countries,'summary':summary,'sources':[
            {'name':'WHO / UNICEF · JMP','url':'https://washdata.org/data/api'},
            {'name':'JMP · Safely managed drinking water services','url':'https://washdata.org/topics/drinking-water'},
            {'name':'United Nations Statistics Division · M49','url':M49},
            {'name':'Natural Earth · Map label coordinates','url':'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-details/'}],
            'methodology': (
                'Each country or territory uses its most recent national JMP estimate from 2000 to 2024. '
                'Where none is available, the atlas estimates coverage by multiplying local coverage of at least '
                'basic service in 2024 by the ratio of safely managed coverage to at least basic coverage in a '
                'reference group. If the national basic service figure is unavailable, the atlas uses the '
                'safely managed coverage of the group. It selects the first available reference group in this '
                'order: M49 subregion, SDG region, income group, then world. Each available national service '
                'component sets an upper bound. The atlas rounds these approximations to the nearest percentage '
                'point. The JMP provides the global figure directly.'),
            'inputs':{name:{'url':url,'sha256':hashlib.sha256((cache/name).read_bytes()).hexdigest()} for name,url in INPUTS.items()}}
    dest.mkdir(parents=True, exist_ok=True)
    (dest/'agua.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    fields = {'code':'code','iso2':'iso2','name':'name','value':'percentage','year':'year',
              'method':'method','note':'source_note','region':'subregion','proxyGroup':'proxy_reference',
              'proxyGroupType':'reference_type','lon':'longitude','lat':'latitude'}
    with (dest/'agua.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(fields.values())
        for c in [world,*countries]:
            writer.writerow([c.get(k,'') for k in fields])
    print(json.dumps(summary,ensure_ascii=False))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        cache = args.cache or Path(tmp)
        download_inputs(cache)
        compile_atlas(cache, ROOT/'public'/'data')
