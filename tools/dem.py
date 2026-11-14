"""Download a 30 m elevation grid for the campus and write public/dem.json.
Run from the repo root:  python3 tools/dem.py

Heights are SRTM 1-arc-second (NASA), fetched from the public Open Topo Data API, on the same
local grid as campus.json: x = east, z = south, metres from the campus centre.
"""
import json, math, os, subprocess, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT0, LON0 = 17.5435, 78.5730
MX = 111320 * math.cos(math.radians(LAT0))
MZ = 110574
X0, X1, Z0, Z1, STEP = -1320, 1320, -1260, 1020, 30

nx = (X1 - X0) // STEP + 1
nz = (Z1 - Z0) // STEP + 1
pts = [(LAT0 - (Z0 + j * STEP) / MZ, LON0 + (X0 + i * STEP) / MX) for j in range(nz) for i in range(nx)]
h = []
for k in range(0, len(pts), 100):
    loc = '|'.join(f'{la:.6f},{lo:.6f}' for la, lo in pts[k:k + 100])
    for attempt in range(5):
        try:
            # curl rather than urllib: python.org builds on macOS ship without a CA bundle
            out = subprocess.run(['curl', '-sf', '--max-time', '30', 'https://api.opentopodata.org/v1/srtm30m?locations=' + loc], capture_output=True, check=True).stdout
            res = json.loads(out)['results']
            break
        except Exception as e:
            print('retry', k, e); time.sleep(3 + attempt * 3)
    else:
        raise SystemExit('failed at ' + str(k))
    h += [r['elevation'] for r in res]
    print(len(h), '/', len(pts), flush=True)
    time.sleep(1.1)
if any(v is None for v in h):
    raise SystemExit('missing elevations')
json.dump({'source': 'SRTM 1 arc-second via opentopodata.org', 'x0': X0, 'z0': Z0, 'step': STEP, 'nx': nx, 'nz': nz, 'h': [round(v) for v in h]},
          open(os.path.join(ROOT, 'public', 'dem.json'), 'w'), separators=(',', ':'))
print('wrote dem.json', nx, 'x', nz, 'min', min(h), 'max', max(h))
