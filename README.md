# BITS Pilani, Hyderabad Campus in three.js

A walkable, flyable 3D model of the BITS Pilani Hyderabad campus (Jawahar Nagar, Shameerpet).

```
npm install
npm run dev      # then open http://localhost:5173
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Drag (or double-click to lock the pointer) | Look |
| Space / Q | Fly up / down |
| Shift | Move faster |
| F | Toggle flying and walking (walking collides with buildings) |
| T | Midday, golden hour, night |
| M / L / H | Big map, labels, hide the interface |

Click the minimap to teleport, or use the "Jump to" list. A view can be linked directly:
`/?pos=x,y,z&yaw=deg&pitch=deg&time=day|evening|night`.

## How it is built

- `tools/preprocess.py` turns `data/osm.json` (an Overpass export) into `public/campus.json`:
  building footprints with courtyards, roads and paths, pitches, ponds, and the campus boundary,
  all in local metres. It also classifies satellite imagery into canopy, grass and soil, which
  drives tree placement (about 20,000 trees) and the painted ground map `public/ground.jpg`.
  A few buildings missing from OpenStreetMap were digitised by hand from imagery.
- `tools/dem.py` downloads a 30 m elevation grid (SRTM) to `public/dem.json`. `src/terrain.js` smooths it,
  resamples it to 4 m, levels a pad under every building, court and lawn, and grades the roads.
- `src/buildings.js` extrudes every footprint, with procedural facades per building type
  (stone and red sandstone academic blocks, white hostels, housing), parapets, rooftop solar
  arrays and tanks, the library's stepped roof and glass front, and hipped metal roofs.
- `src/world.js` builds terrain, roads with kerbs, sports grounds, water, trees, boulders,
  street lamps, the main gate and the boundary wall.
- `src/main.js` handles sky, lighting, time of day, movement, the minimap and labels.

Map data (c) OpenStreetMap contributors, ODbL. Elevation: NASA SRTM 1 arc-second, via Open Topo Data. Land cover was derived from Esri World Imagery,
which is used as a reference only and is not redistributed.
