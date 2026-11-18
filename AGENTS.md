# AGENTS.md

Vite + three.js walkable campus model. ESM, no TypeScript, no linter, no CI.

## Commands

- `npm install`
- `npm run dev` — then `http://localhost:5173`
- `npm run build` / `npm run preview`
- `node --test tools/tree-population.test.mjs` — run after touching `src/tree-population.js`, `src/plants.js`, `src/roundabout.js`, `src/geo.js`, `src/world.js` (GATE), or regenerating data. Verifies original→companion 1:1 doubling and obstacle exclusion.
- `python3 tools/preprocess.py` (needs `PIL`, `numpy`) — regenerates `public/campus.json` + `public/ground.jpg` from `data/osm.json` + `data/sat17.jpg`/`sat18.jpg`. Run from repo root only; it overwrites checked-in artifacts, so avoid unless changing the data pipeline.

## Screenshot / perf tools (need dev server + macOS Chrome)

`tools/{shot,cost,profile}.mjs` hardcode `localhost:5173` and `/Applications/Google Chrome.app/...`. Start `npm run dev` first.
- `node tools/shot.mjs out_prefix "x,y,z,yaw,pitch[,time]"` — waits on `window.__ready`, uses `?shot=1&ui=0`, `__go`/`__time`/`__info`.
- `node tools/profile.mjs ...` / `node tools/cost.mjs "x,y,..."` — per-group tris/calls breakdown.

## Architecture

- Entry: `index.html` → `src/main.js` (sky, lights, movement, minimap, labels, `?pos=…&time=…` / `?trees=original` / `?shot=1` handling, `window.__*` debug hooks).
- Data flow: `data/osm.json` → `tools/preprocess.py` → `public/campus.json` + `public/ground.jpg` → scene builders in `src/`. Coordinates are local metres: x=east, z=south, origin campus centre.
- `src/world.js` (terrain, roads, water, lamps, gate, wall) + `src/buildings.js` (extrusions/facades) are the core; other `src/*.js` files are per-area builders (`forest*`, `marine-drive*`, `hostels`, `academic-buildings`, `nab`, `sports`, `garden`, `roundabout`, `plants`, `tree-population`, `detailed-trees`, `ground-detail`).
- Vendored: `src/vendor/ez-tree/` (MIT, keep license); forest texture licenses in `public/forest/TEXTURE-LICENSE.md`.

## Gotchas

- Playable area (`src/barrier.js`): the camera is clamped to `REACH` (60 m) outside the campus wall; a painted treeline stands at `BAND` (80 m). `cullOutside` drops every tree, rock, building, area and road segment beyond `BAND` after the `prepare*` steps, and `buildTrees` also filters the distant scrub ring, so only ~22k trees are drawn. Within that, companion trees still double originals (`tree-population.js`, tested on the raw data); forest/marine-drive code relocates rather than adds/removes.
- Visitors always start at the main gate in fly mode (eye height, facing the campus). In `npm run dev` only, the view is saved per tab in `sessionStorage` and restored after Vite reloads/refreshes (title screen skipped); `?place=`, `?pos=` and `?shot=1` bypass it. New trunks must stay off buildings, roads, water, pitches, gate zone, and `noTreeZones`.
- The wind-tunnel parking/site layout is surveyed in `src/bikepark.js`: three white open canopies, a separate ground-level concrete slab, bare earth to the south and a dense tree belt to the west. `prepareBikeParks` replaces the rough OSM canopy outlines with the surveyed polygons and relocates (never adds/removes) affected source trees; call it before tree generation. OSM way `360815484` / the manual `bikepark` block are the source areas, while `360815486` is the small washroom building. The OSM `parking` patch at `~(-150,42)` is intentionally unpaved and skipped at render + minimap (`world.js`, `main.js`).
- `public/campus.json` and `public/ground.jpg` are committed build outputs; `data/tiles`, `data/ref`, `data/*.jpg` are gitignored working files — don't commit those.
- No `vite.config.*`; default Vite behavior. Esri imagery in `data/` is reference-only, not redistributed.
