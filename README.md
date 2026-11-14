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
- `src/buildings.js` extrudes every footprint, with procedural facades per building type
  (stone and red sandstone academic blocks, white hostels, housing), parapets, rooftop solar
  arrays and tanks, the library's stepped roof and glass front, and hipped metal roofs.
- `src/world.js` builds terrain, roads with kerbs, sports grounds, water, trees, boulders,
  street lamps, the main gate and the boundary wall.
- `src/tree-population.js` preserves the original 25,558 trees and places one additional
  tree near each, keeping new trunks off roads, buildings, water and sports grounds.
  `src/detailed-trees.js` renders these additions with branching foliage, wind and three
  levels of detail. The default total is 51,116 trees; `?trees=original` shows the original
  population for comparison. Run `node --test tools/tree-population.test.mjs` to verify
  the population and placement constraints.
- `src/main.js` handles sky, lighting, time of day, movement, the minimap and labels.

## Woodland and campus perimeter

Choose **Woodland Trail**, **North Boundary Woods**, **East Boundary Woods**,
or **South Boundary Woods** from Jump To. The forest treatment follows existing
planting around the campus wall, approximately 55 metres inside and 15 metres
outside the boundary. The forest follows existing tree positions and preserves the 51,116-tree total; entrances, paved corridors, buildings, water and sports grounds are
excluded from the new ground cover. Cleared stretches remain open.

`src/forest-zone.js` derives coverage from the campus boundary and mapped trees.
`src/forest.js` retains the original woodland trail; `src/perimeter-forest.js`
renders the extended belt using shared tree geometry, spatial distance levels,
and camera-local grass, ferns and shrubs. Inactive undergrowth sections are
released from GPU memory. `src/forest-proxy.js` bakes side and top canopy views
for distant trees, including aerial views. Mist and sky fill blend in locally
at walking height, and vegetation hidden by the mist is culled. Canopy shadows
refresh at 10 Hz inside woodland areas.

The MIT-licensed EZ-Tree generator by Daniel Greenheck is vendored under
`src/vendor/ez-tree/`. Asset sources and licenses are recorded in
`public/forest/TEXTURE-LICENSE.md`; the generator's license is retained with
both the source and the assets.

Map data (c) OpenStreetMap contributors, ODbL. Land cover was derived from Esri World Imagery,
which is used as a reference only and is not redistributed.

## Marine Drive landscaping

The academic-side lawns and hostel-side flowerbeds follow the supplied aerial
reference. Existing trees in the formal planting corridor are relocated to its
woodland edge, maintaining the 51,116-tree total. A single palm row follows the
median. The flowerbeds continue to the southern roundabout's east exit; their
soil, paths and plants are clipped against roads and sidewalks.

`src/marine-drive-layout.js` defines the planting plan, `src/marine-drive.js`
builds the scene, and `src/landscape-paving.js` protects the paved corridors.
