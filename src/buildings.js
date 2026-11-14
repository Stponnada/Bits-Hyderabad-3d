import * as THREE from 'three';
import { Geo, polyArea, centroid, pip, bbox, addFlatPoly } from './geo.js';
import { STYLES, facade, plainTex, rng, curtainTex } from './textures.js';

const KIND_STYLE = {
  academic: 'academic', auditorium: 'auditorium', hostel: 'hostel', housing: 'housing', apartment: 'apartment',
  mess: 'civic', retail: 'civic', sac: 'civic', medical: 'civic', generic: 'civic', lab: 'civic', temple: 'civic',
  utility: 'kiosk', kiosk: 'kiosk', workshop: 'workshop',
};
const ROOF = {
  workshop: 'roof_blue', sac: 'roof_pink', mess: 'metal_pink', auditorium: 'metal_pink', lab: 'roof_white', apartment: 'roof_white',
};

export function buildBuildings(data, scene) {
  const batches = new Map();   // key -> Geo
  const mats = new Map();
  const nightMats = [];
  let curY = 0;                // ground level of the building being built (b.y, set by terrain.js)
  const G = (key) => { if (!batches.has(key)) batches.set(key, new Geo()); const g = batches.get(key); g.yo = curY; return g; };

  const wallMat = (style, levels, windows) => {
    const key = `w_${style}_${levels}_${windows ? 1 : 0}`;
    if (!mats.has(key)) {
      const m = new THREE.MeshStandardMaterial({ map: facade(style, levels, { windows }), roughness: 0.92, metalness: 0 });
      if (windows) {
        m.emissiveMap = facade(style, levels, { windows, emissive: true });
        m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = 0;
        nightMats.push(m);
      }
      mats.set(key, m);
    }
    return key;
  };
  const simple = (key, tex, opts = {}) => {
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ map: tex(), roughness: 0.9, metalness: 0, ...opts }));
    return key;
  };
  simple('roof_concrete', () => plainTex('#b4afa3', 5, 0.1));
  simple('roof_white', () => plainTex('#d9d7d0', 6, 0.08));
  simple('roof_blue', () => plainTex('#6f95c4', 7, 0.05, 8), { roughness: 0.55, metalness: 0.3 });
  simple('roof_pink', () => plainTex('#c79a98', 8, 0.05, 8), { roughness: 0.6, metalness: 0.2 });
  simple('metal_pink', () => plainTex('#c4928c', 9, 0.05, 8), { roughness: 0.55, metalness: 0.25 });
  simple('terracotta', () => plainTex('#b65d3c', 10, 0.07, 6), { roughness: 0.8 });
  simple('glass', () => plainTex('#2f5560', 12, 0.03, 4), { roughness: 0.15, metalness: 0.6 });
  simple('orange', () => plainTex('#d2622c', 13, 0.04));
  if (!mats.has('curtain')) mats.set('curtain', new THREE.MeshStandardMaterial({ map: curtainTex(), roughness: 0.18, metalness: 0.55 }));

  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  const heightOf = (b) => {
    const st = STYLES[KIND_STYLE[b.kind] || 'civic'];
    if (b.h) return b.h;
    let h = b.levels * st.floorH;
    if (b.kind === 'sac') h = 3 * 4.2;
    return h;
  };

  const footprints = [];
  const labels = [];
  const props = { panels: [], tanks: [], heads: [] };
  const r = rng(99);

  function walls(pts, y0, H, par, isHole, style, levels, allowWin = true, skip = null) {
    const st = STYLES[style];
    const n = pts.length;
    const top = H + par;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05 || (skip && skip.has(i))) continue;   // skipped faces are modelled elsewhere
      let nx = dz / len, nz = -dx / len;
      if (isHole) { nx = -nx; nz = -nz; }
      const win = allowWin && len >= st.bayW * 0.62;
      const geo = G(wallMat(style, levels, win));
      const bays = Math.max(1, Math.round(len / st.bayW));
      const u0 = win ? Math.floor(r() * 4) / 4 : 0;
      const u1 = win ? u0 + bays / 4 : len / st.bayW;
      const v0 = y0 / top;
      const a = [p1[0], y0, p1[1]], b = [p1[0], top, p1[1]], c = [p2[0], top, p2[1]], d = [p2[0], y0, p2[1]];
      if (!isHole) geo.quad(a, b, c, d, [nx, 0, nz], [u0, v0], [u0, 1], [u1, 1], [u1, v0]);
      else geo.quad(d, c, b, a, [nx, 0, nz], [u1, v0], [u1, 1], [u0, 1], [u0, v0]);
      // parapet inner face
      if (par > 0.25) {
        const pg = G('roof_concrete');
        const a2 = [p1[0], H, p1[1]], d2 = [p2[0], H, p2[1]];
        if (!isHole) pg.quad(d2, c, b, a2, [-nx, 0, -nz], [0, 0], [0, 0.1], [len / 8, 0.1], [len / 8, 0]);
        else pg.quad(a2, b, c, d2, [-nx, 0, -nz], [0, 0], [0, 0.1], [len / 8, 0.1], [len / 8, 0]);
      }
    }
  }

  function hipRoof(pts, H, rise, matKey, overhang = 1.2) {
    const geo = G(matKey);
    const [cx, cz] = centroid(pts);
    const apex = [cx, H + rise, cz];
    const n = pts.length;
    const out = pts.map((p) => {
      const dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz) || 1;
      return [p[0] + (dx / l) * overhang, p[1] + (dz / l) * overhang];
    });
    for (let i = 0; i < n; i++) {
      const p1 = out[i], p2 = out[(i + 1) % n];
      const a = [p1[0], H - 0.15, p1[1]], b = [p2[0], H - 0.15, p2[1]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]];
      let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
      const len = Math.hypot(e1[0], e1[2]), sl = Math.hypot(...e2);
      if (nn[1] >= 0) geo.tri(a, b, apex, nn, [0, 0], [len / 6, 0], [len / 12, sl / 6]);
      else geo.tri(a, apex, b, nn.map((v) => -v), [0, 0], [len / 12, sl / 6], [len / 6, 0]);
    }
  }

  function frustum(pts, c, y0, y1, s0, s1, matKey) {
    const geo = G(matKey);
    const n = pts.length;
    const S = (p, s, y) => [c[0] + (p[0] - c[0]) * s, y, c[1] + (p[1] - c[1]) * s];
    for (let i = 0; i < n; i++) {
      const a = S(pts[i], s0, y0), b = S(pts[(i + 1) % n], s0, y0), c2 = S(pts[(i + 1) % n], s1, y1), d = S(pts[i], s1, y1);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
      const mid = [(a[0] + b[0]) / 2 - c[0], (a[2] + b[2]) / 2 - c[1]];
      const outward = nn[0] * mid[0] + nn[2] * mid[1] >= 0 || nn[1] > 0.5;
      const len = Math.hypot(e1[0], e1[2]), hh = Math.hypot(...e2);
      if (outward) geo.quad(a, b, c2, d, nn, [0, 0], [len / 4, 0], [len / 4, hh / 4], [0, hh / 4]);
      else geo.quad(b, a, d, c2, nn.map((v) => -v), [len / 4, 0], [0, 0], [0, hh / 4], [len / 4, hh / 4]);
    }
    addFlatPoly(geo, pts.map((p) => { const q = S(p, s1, y1); return [q[0], q[2]]; }), [], y1, 0.25);
  }

  for (const b of data.buildings) {
    const style = KIND_STYLE[b.kind] || 'civic';
    const st = STYLES[style];

    if (b.kind === 'library') {
      // stepped octagonal terracotta roof crowning the library wing
      const parent = data.buildings.find((p) => p.kind === 'academic' && pip(...centroid(b.outer), p.outer));
      const H = parent ? heightOf(parent) : 15.6;
      curY = parent?.y ?? 0;
      const c = centroid(b.outer);
      frustum(b.outer, c, H, H + 2.6, 1.0, 1.0, 'glass');
      frustum(b.outer, c, H + 2.6, H + 3.6, 1.1, 0.86, 'terracotta');
      frustum(b.outer, c, H + 3.6, H + 5.2, 0.72, 0.72, 'glass');
      frustum(b.outer, c, H + 5.2, H + 6.1, 0.8, 0.58, 'terracotta');
      frustum(b.outer, c, H + 6.1, H + 7.2, 0.42, 0.42, 'glass');
      frustum(b.outer, c, H + 7.2, H + 8.2, 0.5, 0.2, 'terracotta');
      labels.push({ name: 'Central Library', at: [c[0], curY + H + 14, c[1]], major: true });
      // glass curtain wall on the wing's north face (the view from the main gate)
      if (parent) {
        // the wing runs along the campus grid; walk from the octagon to the wing's north end
        const ax = [Math.sin(0.4), -Math.cos(0.4)];
        let d = 0;
        while (d < 90 && pip(c[0] + ax[0] * d, c[1] + ax[1] * d, parent.outer)) d += 0.5;
        if (d < 90) G('curtain').box(c[0] + ax[0] * (d + 0.2), c[1] + ax[1] * (d + 0.2), 36, 1.6, 0.5, H + 0.4, Math.atan2(ax[1], ax[0]) + Math.PI / 2, 1 / 9, true);
      }
      continue;
    }

    if (b.on != null && byId.has(b.on)) {
      const p = byId.get(b.on);
      const H0 = heightOf(p);
      curY = p.y ?? 0;
      walls(b.outer, H0, H0 + 3.4, 0.3, false, style, Math.max(1, p.levels), false);
      addFlatPoly(G(p.kind === 'academic' ? 'terracotta' : 'roof_concrete'), b.outer, [], H0 + 3.4);
      continue;
    }

    const H = heightOf(b);
    curY = b.y ?? 0;
    const hip = (b.kind === 'mess' || b.kind === 'auditorium') && b.holes.length === 0;
    const par = hip ? 0 : st.parapet;
    walls(b.outer, 0, H, par, false, style, b.levels, b.kind !== 'utility', b.skipEdges);
    for (const h of b.holes) walls(h, 0, H, par, true, style, b.levels);
    if (hip) {
      hipRoof(b.outer, H, b.kind === 'auditorium' ? 7.5 : 5.5, 'metal_pink');
    } else {
      addFlatPoly(G(ROOF[b.kind] || 'roof_concrete'), b.outer, b.holes, H);
    }
    footprints.push({ outer: b.outer, bb: bbox(b.outer), holes: b.holes, h: curY + H });
    if (b.name) labels.push({ name: b.name, at: [...centroid(b.outer).slice(0, 1), curY + H + 9, centroid(b.outer)[1]], major: Math.abs(polyArea(b.outer)) > 900 });

    // rooftop clutter
    const area = Math.abs(polyArea(b.outer));
    if (!hip && area > 500 && ['academic', 'hostel', 'apartment', 'housing', 'retail', 'medical'].includes(b.kind)) {
      const bb = bbox(b.outer);
      const inside = (x, z) => pip(x, z, b.outer) && !b.holes.some((h) => pip(x, z, h));
      const place = (count, w, d, list, extra) => {
        let tries = 0, placed = 0;
        while (placed < count && tries++ < count * 30) {
          const x = bb[0] + r() * (bb[2] - bb[0]), z = bb[1] + r() * (bb[3] - bb[1]);
          const ang = -0.4;
          const c = Math.cos(ang), s = Math.sin(ang);
          const ok = [[-w, -d], [w, -d], [w, d], [-w, d]].every(([lx, lz]) => inside(x + (lx * c - lz * s) * 0.65, z + (lx * s + lz * c) * 0.65));
          if (!ok) continue;
          list.push({ x, z, y: curY + H, ang, ...extra });
          placed++;
        }
      };
      if (b.kind === 'academic') place(Math.round(area / 260), 6, 4, props.panels);
      if (b.kind === 'hostel') place(Math.round(area / 700), 6, 4, props.panels);
      place(Math.max(1, Math.round(area / 1100)), 2, 2, props.tanks);
      place(Math.max(1, Math.round(area / 1600)), 4.5, 5.5, props.heads, { style });
    }
  }

  // stair head-rooms as real boxes in the blank wall material of their style
  curY = 0;
  for (const h of props.heads) {
    const key = h.style === 'academic' ? 'terracotta' : wallMat(h.style, 1, false);
    G(key).box(h.x, h.z, 4.5, 5.5, h.y, h.y + 2.9, h.ang, 0.2);
  }

  const group = new THREE.Group();
  for (const [key, geo] of batches) {
    const mesh = new THREE.Mesh(geo.build(), mats.get(key));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = key;
    group.add(mesh);
  }

  // instanced solar arrays + water tanks
  const dummy = new THREE.Object3D();
  if (props.panels.length) {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 0.12, 3.6),
      new THREE.MeshStandardMaterial({ map: plainTex('#1c2b4d', 31, 0.03, 6), roughness: 0.25, metalness: 0.6 }), props.panels.length);
    props.panels.forEach((p, i) => {
      dummy.position.set(p.x, p.y + 0.9, p.z); dummy.rotation.set(0, 0, 0);
      dummy.rotateY(-p.ang); dummy.rotateX(0.26); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix);
    });
    pm.castShadow = true; group.add(pm);
  }
  if (props.tanks.length) {
    const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.0, 1.05, 1.9, 12),
      new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.6 }), props.tanks.length);
    props.tanks.forEach((p, i) => { dummy.position.set(p.x, p.y + 1.3, p.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); tm.setMatrixAt(i, dummy.matrix); });
    tm.castShadow = true; group.add(tm);
  }
  scene.add(group);
  return { group, footprints, labels, nightMats, heightOf };
}
