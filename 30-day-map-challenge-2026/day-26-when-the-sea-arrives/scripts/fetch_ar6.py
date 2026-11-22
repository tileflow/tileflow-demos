# Pulls the medium-confidence total sea-level files out of the AR6 regional zip with HTTP range requests.
import sys
from remotezip import RemoteZip
URL = "https://zenodo.org/records/6382554/files/ar6-regional-confidence.zip?download=1"
WANT = [f"medium_confidence/{s}/total_{s}_medium_confidence_values.nc" for s in ("ssp126", "ssp245", "ssp585")]
with RemoteZip(URL) as z:
    for info in z.infolist():
        if any(info.filename.endswith(w) for w in WANT):
            print(info.filename, info.file_size, flush=True)
            z.extract(info, "raw")
