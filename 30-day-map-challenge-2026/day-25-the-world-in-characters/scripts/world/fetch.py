"""Fetch the exact Natural Earth archives identified by the supplied dataset."""
import hashlib,json,urllib.request
from pathlib import Path
here=Path(__file__).resolve().parent
manifest=json.loads((here.parents[1]/'public/detail/natural-earth.json').read_text())['meta']['sources']
for key,source in manifest.items():
    target=here/(key+'.zip')
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==source['sha256']:
        continue
    with urllib.request.urlopen(source['url'],timeout=90) as response:
        data=response.read()
    if hashlib.sha256(data).hexdigest()!=source['sha256']:
        raise SystemExit('Source changed since the edition was made: '+source['url'])
    target.write_bytes(data)
