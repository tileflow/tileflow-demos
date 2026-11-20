"""Prepare a compact, attributed copy of geocoded Paris outdoor filming records."""
import csv,json,re,math,sys,unicodedata
from pathlib import Path
from collections import Counter
kinds=['Long métrage','Série TV','Téléfilm','Série Web']
def tidy(s):
    return ' '.join(unicodedata.normalize('NFC',s).split())
def key(s):
    return tidy(s).replace('’',"'").casefold()
titles=[];titleids={};addresses=[];addressids={};rows=[];ids=set()
validcodes={str(i) for i in range(75001,75021)}|{'75116'}
with open(sys.argv[1],encoding='utf-8-sig') as f:
    for record in csv.DictReader(f,delimiter=';'):
        if record['ardt_lieu'] not in validcodes or record['type_tournage'] not in kinds:continue
        lat,lon=map(float,record['geo_point_2d'].split(','))
        x=(lon+180)/360*16384;y=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*16384
        if not(8292<=x<8306 and 5633<=y<5641) or record['id_lieu'] in ids:continue
        ids.add(record['id_lieu'])
        title=tidy(record['nom_tournage']);kind=kinds.index(record['type_tournage'])
        titlekey=(key(title),kind)
        if titlekey not in titleids:
            titleids[titlekey]=len(titles);titles.append([title,kind])
        elif not title.isupper() and titles[titleids[titlekey]][0].isupper():
            titles[titleids[titlekey]][0]=title
        address=tidy(record['adresse_lieu'])
        if key(address) not in addressids:
            addressids[key(address)]=len(addresses);addresses.append(address)
        rows.append([titleids[titlekey],int(record['annee_tournage']),round(lon*1e6),round(lat*1e6),addressids[key(address)]])
out=Path(__file__).resolve().parents[1]/'public/datos/film.json'
out.write_text(json.dumps(dict(titles=titles,addresses=addresses,records=sorted(rows),licence='ODbL',source='https://opendata.paris.fr/explore/dataset/lieux-de-tournage-a-paris/'),separators=(',',':'),ensure_ascii=False))
print(len(rows),'shoot records,',len(titles),'archive titles,',len(addresses),'address labels;',Counter(row[1] for row in rows))
