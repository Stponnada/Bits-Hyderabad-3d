"""Convert raw OSM + satellite-derived land cover into the compact dataset the
three.js scene loads.  Run from the repo root:  python3 tools/preprocess.py

Coordinates: local metres, x = east, z = south (so north is -z), origin at the
campus centre.  OSM data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'public')
os.makedirs(OUT, exist_ok=True)

LAT0, LON0 = 17.5435, 78.5730
MX = 111320 * math.cos(math.radians(LAT0))
MZ = 110574
random.seed(7)


def xz(lat, lon):
    return ((lon - LON0) * MX, -(lat - LAT0) * MZ)


def ring(geom):
    pts = [xz(p['lat'], p['lon']) for p in geom]
    return pts


def rnd(pts):
    return [[round(x, 2), round(z, 2)] for x, z in pts]


def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        a += x1 * z2 - x2 * z1
    return a / 2


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def pip(x, z, pts):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, zi = pts[i]
        xj, zj = pts[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def close_strip(pts):
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 0.01 and abs(pts[0][1] - pts[-1][1]) < 0.01:
        return pts[:-1]
    return pts


def assemble(ways):
    """Join open member ways into closed rings."""
    segs = [list(w) for w in ways]
    rings = []
    while segs:
        cur = segs.pop(0)
        while not (abs(cur[0][0] - cur[-1][0]) < 0.01 and abs(cur[0][1] - cur[-1][1]) < 0.01):
            found = False
            for i, s in enumerate(segs):
                if abs(s[0][0] - cur[-1][0]) < 0.01 and abs(s[0][1] - cur[-1][1]) < 0.01:
                    cur += s[1:]; segs.pop(i); found = True; break
                if abs(s[-1][0] - cur[-1][0]) < 0.01 and abs(s[-1][1] - cur[-1][1]) < 0.01:
                    cur += s[::-1][1:]; segs.pop(i); found = True; break
            if not found:
                break
        rings.append(close_strip(cur))
    return rings


osm = json.load(open(os.path.join(DATA, 'osm.json')))
els = osm['elements']
member_ids = set()
for e in els:
    if e['type'] == 'relation':
        for m in e.get('members', []):
            if m['type'] == 'way':
                member_ids.add(m['ref'])

LIM_X, LIM_Z = 1300, 1100

# manual additions digitised from imagery (pixel coords in the 2x z17 mosaic)
Z = 17; N = 2 ** Z
def tile(lat, lon):
    return ((lon + 180) / 360 * N, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N)
TX0, TY0 = [int(v) for v in tile(17.5500, 78.5650)]
def px2xz(px, py, scale=2):
    tx = TX0 + px / (256 * scale); ty = TY0 + py / (256 * scale)
    lon = tx / N * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / N))))
    return xz(lat, lon)

GRID_ANG = math.radians(23)   # campus grid rotation (clockwise in image space)

# ------------------------------------------------------------------ buildings
buildings = []
for e in els:
    t = e.get('tags', {})
    is_lib = t.get('amenity') == 'library'
    if 'building' not in t and not is_lib:
        continue
    if is_lib:
        # OSM maps the whole wing; the landmark is the stepped octagonal roof at its centre
        cx, cz = px2xz(1565, 1280)
        outer = [(cx + 17.5 * math.cos(GRID_ANG + math.pi / 8 + k * math.pi / 4), cz + 17.5 * math.sin(GRID_ANG + math.pi / 8 + k * math.pi / 4)) for k in range(8)]
        holes = []; outers = [outer]
    elif e['type'] == 'way':
        outer = close_strip(ring(e['geometry']))
        holes = []
        outers = [outer]
    else:
        ow = [ring(m['geometry']) for m in e['members'] if m['type'] == 'way' and m.get('role') != 'inner' and 'geometry' in m]
        iw = [ring(m['geometry']) for m in e['members'] if m['type'] == 'way' and m.get('role') == 'inner' and 'geometry' in m]
        outers = assemble(ow)
        holes = assemble(iw)
    for outer in outers:
        if len(outer) < 3:
            continue
        cx, cz = centroid(outer)
        if abs(cx) > LIM_X or abs(cz) > LIM_Z:
            continue
        buildings.append({
            'id': e['id'], 'name': t.get('name', ''), 'tags': t,
            'outer': outer, 'holes': [h for h in holes if pip(*centroid(h), outer)],
            'area': abs(area(outer)), 'c': (cx, cz), 'lib': is_lib,
        })

def manual(px, py, w, h, kind, levels, name='', ang=GRID_ANG):
    cx, cz = px2xz(px, py)
    m = 0.5 / 0.955 * 1.14  # metres per mosaic pixel (approx)
    w *= m; h *= m
    pts = []
    for dx, dz in [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]:
        pts.append((cx + dx * math.cos(ang) - dz * math.sin(ang), cz + dx * math.sin(ang) + dz * math.cos(ang)))
    buildings.append({'id': -len(buildings), 'name': name, 'tags': {}, 'outer': pts, 'holes': [],
                      'area': w * h, 'c': (cx, cz), 'lib': False, 'kind': kind, 'levels': levels})

# faculty / staff apartment towers on the east edge
manual(2715, 1955, 38, 60, 'apartment', 7, 'Faculty Apartments')
manual(2685, 2032, 40, 56, 'apartment', 7)
manual(2665, 2118, 42, 56, 'apartment', 7)
manual(2678, 2202, 38, 58, 'apartment', 7)
# NE staff housing row (white-roofed blocks between the mapped ones)
manual(2637, 1487, 24, 56, 'housing', 3)
manual(2712, 1522, 24, 56, 'housing', 3)
manual(2786, 1556, 24, 50, 'housing', 3)
manual(2832, 1572, 58, 56, 'housing', 4)
manual(2300, 1376, 50, 30, 'utility', 2)
manual(2535, 2277, 24, 40, 'utility', 1)
# academic-side labs and service buildings
manual(1722, 1258, 22, 72, 'lab', 2, ang=math.radians(23))
manual(1748, 1250, 22, 72, 'lab', 2, ang=math.radians(23))
manual(1265, 1478, 40, 36, 'utility', 2)
manual(1562, 1806, 62, 26, 'bikepark', 2)
manual(1232, 1655, 34, 56, 'utility', 1)

# classify
big = [b for b in buildings if b['area'] > 1500]
def classify(b):
    t = b['tags']; n = b['name']; a = b['area']; cx, cz = b['c']
    if 'kind' in b:
        return b['kind'], b['levels']
    if b['lib']:
        return 'library', 1
    if 'Bhavan' in n or t.get('building') == 'dormitory':
        return 'hostel', int(t.get('building:levels', 4))
    if 'Auditorium' in n:
        return 'auditorium', 4
    if t.get('building') == 'university':
        return 'academic', 4
    if 'Dining' in n:
        return 'mess', 2
    if 'Conaught' in n:
        return 'retail', 2
    if 'Student Activity' in n:
        return 'sac', 3
    if 'Workshop' in n or 'Wind Tunnel' in n:
        return 'workshop', 2
    if 'Medical' in n:
        return 'medical', 2
    if t.get('building') in ('guardhouse', 'kiosk') or a < 45:
        return 'kiosk', 1
    if t.get('building') == 'temple':
        return 'temple', 1
    if cx > 320 and cz < 330:
        return ('housing', 2) if a < 420 else ('housing', 4)
    if cx < -150 and cz > -60:
        return 'workshop', 2
    return 'generic', 2

for b in buildings:
    b['kind'], b['levels'] = classify(b)

# rooftop structures: small footprints sitting on top of a bigger building
for b in buildings:
    b['on'] = None
for b in buildings:
    if b['kind'] in ('kiosk',) or b['area'] > 2600:
        continue
    for p in buildings:
        if p is b or p['area'] < b['area'] * 2.2:
            continue
        cx, cz = b['c']
        if pip(cx, cz, p['outer']) and not any(pip(cx, cz, h) for h in p['holes']):
            inside = sum(1 for q in b['outer'] if pip(q[0], q[1], p['outer'])) / len(b['outer'])
            if inside > 0.6:
                b['on'] = p['id']
                break

# hostel names for the unnamed south-west complexes (best-effort placement)
def nearest_hole_names(b, names):
    hs = sorted([h for h in b['holes'] if abs(area(h)) > 900], key=lambda h: centroid(h)[1])
    return [{'name': n, 'at': [round(v, 1) for v in centroid(h)]} for n, h in zip(names, hs)]

labels = []
for b in buildings:
    if b['id'] == 5372153:
        labels += nearest_hole_names(b, ['Krishna Bhavan', 'Ram Bhavan', 'Budh Bhavan'])
    elif b['id'] == 5372152:
        labels += nearest_hole_names(b, ['Gandhi Bhavan', 'Meera Bhavan', 'Ganga Bhavan'])
    elif b['id'] == 5372151:
        labels.append({'name': 'Academic Blocks', 'at': [round(v, 1) for v in b['c']]})

bout = []
for b in buildings:
    o = b['outer']
    if area(o) < 0:
        o = o[::-1]
    holes = [h if area(h) > 0 else h[::-1] for h in b['holes']]
    bout.append({'id': b['id'], 'name': b['name'], 'kind': b['kind'], 'levels': b['levels'],
                 'outer': rnd(o), 'holes': [rnd(h) for h in holes], 'on': b['on']})

# Site survey: these two OSM footprints are open 2-wheeler parking canopies
# (white canvas roof on poles over a slightly raised concrete slab), not solid
# buildings. Keep them out of the extruded buildings; they are emitted as
# bikepark areas below and modelled as open sheds at runtime (src/bikepark.js).
BIKE_CANOPY_IDS = {360815484}
canopies = [b for b in bout if b['id'] in BIKE_CANOPY_IDS or b['kind'] == 'bikepark']
bout = [b for b in bout if b['id'] not in BIKE_CANOPY_IDS and b['kind'] != 'bikepark']

# Site survey: the northern canopy (OSM 360815486) is actually a small
# washroom block. Model it as a 1-level utility building parallel to the wind
# tunnel and 1/5 of its width, centred on the mapped footprint.
_wt = next(b for b in bout if b['id'] == 1393014936)['outer']
_e1 = (_wt[1][0] - _wt[0][0], _wt[1][1] - _wt[0][1])
_e2 = (_wt[2][0] - _wt[1][0], _wt[2][1] - _wt[1][1])
_long = _e1 if math.hypot(*_e1) >= math.hypot(*_e2) else _e2
_short = _e2 if math.hypot(*_e1) >= math.hypot(*_e2) else _e1
_wt_ang = math.atan2(_long[1], _long[0])
_wt_wid = math.hypot(*_short) / 5
for b in bout:
    if b['id'] == 360815486:
        _cx, _cz = centroid(b['outer'])
        _ux, _uz = math.cos(_wt_ang), math.sin(_wt_ang)
        _proj = sorted((p[0] - _cx) * _ux + (p[1] - _cz) * _uz for p in b['outer'])
        _hl, _hw = (_proj[-1] - _proj[0]) / 2, _wt_wid / 2
        _vx, _vz = -_uz, _ux
        b['outer'] = rnd([[_cx + _ux * u + _vx * v, _cz + _uz * u + _vz * v]
                          for u, v in ((-_hl, -_hw), (_hl, -_hw), (_hl, _hw), (-_hl, _hw))])
        b.update(kind='utility', levels=1, name='', holes=[])

# ---------------------------------------------------------------------- roads
roads = []
for e in els:
    t = e.get('tags', {})
    if 'highway' not in t or e['type'] != 'way':
        continue
    pts = ring(e['geometry'])
    pts = [p for p in pts if abs(p[0]) < LIM_X and abs(p[1]) < LIM_Z]
    if len(pts) < 2:
        continue
    h = t['highway']
    if h in ('footway', 'path', 'steps', 'pedestrian'):
        kind = 'path' if (h == 'path' and t.get('surface') in (None, 'unpaved', 'dirt')) else 'foot'
        w = 2.2
    elif h == 'track' or t.get('surface') == 'unpaved':
        kind = 'track'; w = 3.5
    elif h in ('tertiary', 'unclassified'):
        kind = 'main'; w = 7.5
    elif h == 'residential':
        kind = 'road'; w = 6.5
    else:
        kind = 'service'; w = 5.0
    roads.append({'kind': kind, 'w': w, 'name': t.get('name', ''), 'pts': rnd(pts),
                  'closed': e['geometry'][0] == e['geometry'][-1]})

# ---------------------------------------------------------------------- areas
areas = []
boundary = None
for e in els:
    t = e.get('tags', {})
    if e['type'] == 'relation' and t.get('leisure') == 'track':
        ow = [ring(m['geometry']) for m in e['members'] if m.get('role') != 'inner' and 'geometry' in m]
        iw = [ring(m['geometry']) for m in e['members'] if m.get('role') == 'inner' and 'geometry' in m]
        o = assemble(ow); i = assemble(iw)
        if o:
            areas.append({'kind': 'track', 'name': 'Athletics Track', 'pts': rnd(o[0]), 'holes': [rnd(x) for x in i]})
        continue
    if e['type'] != 'way' or 'building' in t or 'highway' in t:
        continue
    if e['id'] == 475944944:
        boundary = rnd(close_strip(ring(e['geometry'])))
        continue
    g = e['geometry']
    if g[0] != g[-1]:
        continue
    pts = close_strip(ring(g))
    cx, cz = centroid(pts)
    if abs(cx) > LIM_X or abs(cz) > LIM_Z:
        continue
    kind = None
    if t.get('leisure') == 'pitch':
        kind = 'pitch'
    elif t.get('leisure') == 'park':
        kind = 'park'
    elif t.get('natural') == 'water' or t.get('man_made') == 'pond':
        kind = 'water'
    elif t.get('leisure') == 'swimming_pool':
        kind = 'pool'
    elif t.get('natural') == 'grassland' or t.get('landuse') in ('grass', 'recreation_ground'):
        kind = 'grass'
    elif t.get('amenity') == 'parking':
        kind = 'parking'
    elif t.get('leisure') == 'bleachers':
        kind = 'bleachers'
    elif t.get('amenity') == 'fountain':
        kind = 'fountain'
    elif t.get('amenity') == 'stage':
        kind = 'stage'
    elif t.get('amenity') == 'theatre':
        kind = 'amphi'
    elif t.get('leisure') == 'practice_pitch':
        kind = 'nets'
    elif t.get('leisure') == 'outdoor_seating':
        kind = 'seating'
    elif t.get('power') == 'substation':
        kind = 'substation'
    elif t.get('amenity') == 'shelter':
        kind = 'shelter'
    elif t.get('landuse') == 'retail':
        kind = 'plaza'
    elif t.get('leisure') == 'sports_centre':
        kind = 'pooldeck'
    if not kind:
        continue
    if area(pts) < 0:
        pts = pts[::-1]
    areas.append({'kind': kind, 'name': t.get('name', ''), 'sport': t.get('sport', ''),
                  'surface': t.get('surface', ''), 'pts': rnd(pts)})

# open 2-wheeler parking canopies (see BIKE_CANOPY_IDS above): kept as areas so
# the runtime can model them as sheds instead of extruded buildings
for b in canopies:
    areas.append({'kind': 'bikepark', 'name': '', 'pts': b['outer']})

# central academic quad lawn (not mapped as an area)
print('buildings', len(bout), 'roads', len(roads), 'areas', len(areas))

# ------------------------------------------------------- land cover from imagery
sat = Image.open(os.path.join(DATA, 'sat17.jpg')).convert('RGB')
W, H = sat.size
x0, z0 = px2xz(0, 0, 1)
x1, z1 = px2xz(W, H, 1)
extent = [round(x0, 1), round(z0, 1), round(x1, 1), round(z1, 1)]
print('extent', extent)
a = np.asarray(sat.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
bright = (R + G + B) / 3
green = G - (R + B) / 2
canopy = ((green > 4) & (bright < 92)) | ((green > 9) & (bright < 112))
grass = (green > 7) & ~canopy
soil = (R > G + 4) & (bright > 95)
canopy_f = np.asarray(Image.fromarray((canopy * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
grass_f = np.asarray(Image.fromarray((grass * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0))).astype(np.float32) / 255
soil_f = np.asarray(Image.fromarray((soil * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3.0))).astype(np.float32) / 255

# exclusion mask at 1 m: buildings, roads, pitches, water
# (bikepark canopies still exclude trees even though they are open sheds)
SX = (x1 - x0) / W; SZ = (z1 - z0) / H
def topx(p):
    return ((p[0] - x0) / SX, (p[1] - z0) / SZ)
ex = Image.new('L', (W, H), 0)
dr = ImageDraw.Draw(ex)
for b in bout + canopies:
    if b['on'] is None:
        dr.polygon([topx(p) for p in b['outer']], fill=255, outline=255)
bld = ex.copy()
for h_ in [h for b in bout + canopies for h in b['holes']]:
    dr.polygon([topx(p) for p in h_], fill=255)
for r in roads:
    dr.line([topx(p) for p in r['pts']], fill=255, width=max(2, int(round((r['w'] + 3) / SX))))
for ar in areas:
    if ar['kind'] in ('pitch', 'water', 'pool', 'track', 'parking', 'bikepark', 'nets', 'pooldeck', 'stage', 'plaza'):
        dr.polygon([topx(p) for p in ar['pts']], fill=255)
ex = ex.filter(ImageFilter.MaxFilter(5))
exa = np.asarray(ex) > 0
blda = np.asarray(bld.filter(ImageFilter.MaxFilter(3))) > 0

inside_mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(inside_mask).polygon([topx(p) for p in boundary], fill=255)
inside = np.asarray(inside_mask) > 0

# trees ------------------------------------------------------------------
# Canopy density comes from the 0.6 m imagery: tree crowns are green and either dark or
# visibly textured (leaf clumps and self-shadow), whereas lawns are green, bright and smooth.
# The number of trees planted in each cell follows that density, so woodland stays dense,
# avenues stay as lines of trees, and lawns and playing fields stay open.
def box(arr, k):
    c = np.cumsum(np.cumsum(np.pad(arr, ((k + 1, k), (k + 1, k)), mode='edge'), axis=0), axis=1)
    n = 2 * k + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)
hi = np.asarray(Image.open(os.path.join(DATA, 'sat18.jpg')).convert('RGB').filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)
hb = hi.mean(axis=2); hg = hi[..., 1] - (hi[..., 0] + hi[..., 2]) / 2
hstd = np.sqrt(np.maximum(box(hb * hb, 4) - box(hb, 4) ** 2, 0))
cl = lambda v: np.clip(v, 0, 1)
lawn = cl((hg - 24) / 8) * cl((12 - hstd) / 3)                 # vivid, smooth green: turf
open_crowns = cl((hg - 3) / 5) * cl((118 - hb) / 22) * cl((hstd - 9) / 8)   # separate crowns with shadow between
closed = cl((100 - hb) / 12) * cl((hg - 4) / 4)                # closed, dark canopy
score = np.maximum(open_crowns, closed) * (1 - lawn)
dens_hi = box(score.astype(np.float32), 5)
# the z18 mosaic starts one tile east and south of twice the z17 origin
T17 = [int(v) for v in tile(17.5500, 78.5650)]
n18 = 2 ** 18
T18 = [int((78.5650 + 180) / 360 * n18), int((1 - math.asinh(math.tan(math.radians(17.5500))) / math.pi) / 2 * n18)]
ox, oy = (T18[0] - 2 * T17[0]) * 256, (T18[1] - 2 * T17[1]) * 256
canvas = np.zeros((2 * H, 2 * W), np.float32)
hh, ww = dens_hi.shape
canvas[oy:oy + hh, ox:ox + ww] = dens_hi[:2 * H - oy, :2 * W - ox]
density = canvas.reshape(H, 2, W, 2).mean(axis=(1, 3))
Image.fromarray((np.clip(density, 0, 1) * 255).astype(np.uint8)).save(os.path.join(DATA, 'density.png'))
CELL = 5
cells = []
for py in range(0, H - CELL, CELL):
    for px in range(0, W - CELL, CELL):
        f = float(density[py:py + CELL, px:px + CELL].mean())
        base = max(0.0, min(1.0, (f - 0.1) / 0.7)) ** 1.3
        # the open scrubland beyond the wall is low bush; spend most of the budget on campus trees
        if not inside[min(H - 1, py + CELL // 2), min(W - 1, px + CELL // 2)]:
            base *= 0.4
        if base > 0:
            cells.append((px, py, f, base))
TARGET = 21000                                                  # the scene doubles these with companion trees
k = TARGET / sum(c[3] for c in cells) * 1.18                    # allow for trees rejected by roads and buildings
trees = []
n_in = n_out = 0
for px, py, f, base in cells:
        expect = min(2.2, k * base)
        count = int(expect) + (1 if random.random() < expect - int(expect) else 0)
        for _ in range(count):
            jx = px + random.random() * CELL; jy = py + random.random() * CELL
            ix, iy = int(jx), int(jy)
            if exa[iy, ix]:
                continue
            wx = x0 + jx * SX; wz = z0 + jy * SZ
            ins = inside[iy, ix]
            # crowns are a little larger where the canopy is closed
            s = (0.7 + random.random() * 0.6) * (0.85 + 0.35 * f) * (1.0 if ins else 0.85)
            # type: 0 broadleaf, 1 tall/slender, 2 scrub
            if ins:
                ty = 0 if random.random() < 0.72 else 1
            else:
                ty = 2 if random.random() < 0.7 - 0.5 * f else 0
            trees.append([round(wx, 1), round(wz, 1), round(s, 2), ty])
            if ins: n_in += 1
            else: n_out += 1
print('inside campus', n_in, 'outside', n_out)
print('trees', len(trees))

# ground colour map -----------------------------------------------------------
rng = np.random.default_rng(3)
noise = np.asarray(Image.fromarray((rng.random((H // 8, W // 8)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
fine = rng.random((H, W)).astype(np.float32)
soil_c = np.array([168, 132, 92], np.float32)
dry_c = np.array([150, 138, 88], np.float32)
grass_c = np.array([104, 130, 62], np.float32)
forest_c = np.array([84, 94, 54], np.float32)
col = np.zeros((H, W, 3), np.float32)
base = dry_c[None, None, :] * (0.9 + 0.2 * noise[..., None])
col[:] = base
w_s = np.clip(soil_f * 1.3, 0, 1)[..., None]
col = col * (1 - w_s) + soil_c * (0.92 + 0.16 * noise[..., None]) * w_s
w_g = np.clip(grass_f * 1.4, 0, 1)[..., None]
col = col * (1 - w_g) + grass_c * (0.9 + 0.2 * noise[..., None]) * w_g
w_c = np.clip(canopy_f * 1.2, 0, 1)[..., None]
col = col * (1 - w_c) + forest_c * (0.88 + 0.24 * noise[..., None]) * w_c
col *= (0.96 + 0.08 * fine[..., None])
gimg = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).resize((W * 2, H * 2), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.5))
gimg.save(os.path.join(OUT, 'ground.jpg'), quality=86)

# rocks: bright grey-ish blobs outside canopy inside the rock garden + scrub hills
rocks = []
park = next(a_ for a_ in areas if a_['name'] == 'Rock Garden')
for i in range(140):
    for _ in range(40):
        bx = [min(p[0] for p in park['pts']), max(p[0] for p in park['pts'])]
        bz = [min(p[1] for p in park['pts']), max(p[1] for p in park['pts'])]
        x = random.uniform(*bx); z = random.uniform(*bz)
        if pip(x, z, park['pts']):
            # cluster towards the NW half of the garden where the outcrop is
            cx, cz = centroid(park['pts'])
            d = math.hypot(x - (cx - 25), z - (cz - 10))
            if random.random() < math.exp(-(d / 38) ** 2) * 1.2:
                s = random.choice([1, 1.4, 2, 2.6, 3.5, 5]) * random.uniform(0.7, 1.3)
                rocks.append([round(x, 1), round(z, 1), round(s, 2)])
                break
for i in range(900):
    px_ = random.randrange(W); py_ = random.randrange(H)
    if exa[py_, px_]:
        continue
    ins = inside[py_, px_]
    if ins and grass_f[py_, px_] > 0.5:
        continue
    if ins and random.random() < 0.6:
        continue
    s = random.choice([0.6, 0.9, 1.2, 1.8, 2.5, 3.5]) * random.uniform(0.7, 1.3)
    rocks.append([round(x0 + px_ * SX, 1), round(z0 + py_ * SZ, 1), round(s, 2)])
print('rocks', len(rocks))

json.dump({
    'origin': [LAT0, LON0], 'extent': extent, 'boundary': boundary,
    'buildings': bout, 'roads': roads, 'areas': areas, 'labels': labels,
    'trees': trees, 'rocks': rocks,
}, open(os.path.join(OUT, 'campus.json'), 'w'), separators=(',', ':'))
print('wrote', os.path.getsize(os.path.join(OUT, 'campus.json')) // 1024, 'KB')

# debug render
dbg = gimg.copy(); d2 = ImageDraw.Draw(dbg)
def t2(p):
    a_, b_ = topx(p); return (a_ * 2, b_ * 2)
for r in roads:
    d2.line([t2(p) for p in r['pts']], fill=(190, 190, 185) if r['kind'] not in ('foot', 'path', 'track') else (200, 150, 120), width=max(2, int(r['w'] / SX * 2)))
for ar in areas:
    d2.polygon([t2(p) for p in ar['pts']], outline=(255, 255, 255))
for t_ in trees:
    a_, b_ = t2(t_); d2.ellipse([a_ - 3, b_ - 3, a_ + 3, b_ + 3], fill=(30, 70, 30) if t_[3] != 2 else (80, 100, 50))
for r_ in rocks:
    a_, b_ = t2(r_); d2.ellipse([a_ - 2, b_ - 2, a_ + 2, b_ + 2], fill=(150, 150, 150))
colk = {'hostel': (240, 240, 240), 'academic': (230, 200, 160), 'housing': (240, 220, 200), 'apartment': (255, 255, 255)}
for b in bout:
    d2.polygon([t2(p) for p in b['outer']], fill=colk.get(b['kind'], (210, 180, 170)) if b['on'] is None else (255, 120, 120), outline=(60, 40, 40))
    for h_ in b['holes']:
        d2.polygon([t2(p) for p in h_], fill=(110, 140, 80), outline=(60, 40, 40))
d2.line([t2(p) for p in boundary] + [t2(boundary[0])], fill=(255, 0, 0), width=2)
dbg.crop((900, 800, 3100, 2700)).save(os.path.join(DATA, 'debug.jpg'), quality=80)
