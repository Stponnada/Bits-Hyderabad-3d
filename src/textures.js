import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTex(w, h, draw, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(g, w, h, r, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------- facades
export const STYLES = {
  academic: {
    bayW: 4.0, floorH: 3.9, parapet: 1.0, wall: '#d3c6a4', grid: 0.65,
    ground: { wall: '#a64b30' }, band: '#a64b30', bandH: 0.28,
    win: { w: 3.0, h: 1.55, sill: 1.0, panes: 3 }, shadeBar: true, top: '#cfc4a8',
  },
  auditorium: {
    bayW: 4.0, floorH: 3.9, parapet: 0.2, wall: '#d3c6a4', grid: 0.65,
    ground: { wall: '#a64b30' }, band: '#a64b30', bandH: 0.28,
    win: { w: 1.2, h: 2.2, sill: 0.8, panes: 1 }, top: '#cfc4a8', sparse: true,
  },
  hostel: {
    bayW: 3.2, floorH: 3.2, parapet: 0.9, wall: '#f0ede5', band: '#b8564a', bandH: 0.09,
    win: { w: 1.25, h: 1.3, sill: 1.0, panes: 2 }, lintelLine: '#b8564a', top: '#ebe7de', vent: true,
  },
  housing: {
    bayW: 3.6, floorH: 3.1, parapet: 0.9, wall: '#eee3cb', band: '#b96d48', bandH: 0.16,
    win: { w: 1.5, h: 1.35, sill: 0.95, panes: 2 }, balcony: true, top: '#e6dac0',
  },
  apartment: {
    bayW: 3.6, floorH: 3.1, parapet: 1.0, wall: '#f1efe9', band: '#a9b0b3', bandH: 0.14,
    win: { w: 1.6, h: 1.4, sill: 0.9, panes: 2 }, balcony: true, top: '#e3e0d8',
  },
  civic: {
    bayW: 4.0, floorH: 4.2, parapet: 0.9, wall: '#ece4d1', band: '#d2713a', bandH: 0.22,
    win: { w: 2.6, h: 1.9, sill: 0.9, panes: 3 }, top: '#e4dcc8',
  },
  workshop: {
    bayW: 5.0, floorH: 4.6, parapet: 0.6, wall: '#e7e3d7', band: '#6f8fb3', bandH: 0.2,
    win: { w: 3.4, h: 1.1, sill: 2.9, panes: 4 }, top: '#dedacd',
  },
  kiosk: {
    bayW: 3.0, floorH: 3.0, parapet: 0.3, wall: '#e9e1cf', band: '#d2713a', bandH: 0.18,
    win: { w: 1.4, h: 1.2, sill: 0.9, panes: 2 }, top: '#e1d8c4',
  },
};

export function facade(key, levels, { windows = true, emissive = false } = {}) {
  const st = STYLES[key];
  const BAYS = windows ? 4 : 1;
  const PX = emissive ? 96 : 224;
  const pxm = PX / st.bayW;
  const fh = Math.round(st.floorH * pxm);
  const ph = Math.round(st.parapet * pxm);
  const W = BAYS * PX, H = levels * fh + ph;
  const r = rng(key.length * 97 + levels * 13 + (windows ? 1 : 0));
  return canvasTex(W, H, (g) => {
    if (emissive) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = st.wall; g.fillRect(0, 0, W, H);
    }
    for (let f = 0; f < levels; f++) {
      const y0 = H - (f + 1) * fh;            // top of this floor in canvas
      const isG = f === 0 && st.ground;
      if (!emissive) {
        g.fillStyle = isG ? st.ground.wall : st.wall;
        g.fillRect(0, y0, W, fh);
        // stone / tile grid
        if (st.grid) {
          g.strokeStyle = isG ? 'rgba(60,20,10,0.28)' : 'rgba(90,75,50,0.22)';
          g.lineWidth = 1;
          const gs = st.grid * pxm;
          for (let y = y0; y < y0 + fh; y += gs * 0.5) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
          let row = 0;
          for (let y = y0; y < y0 + fh; y += gs * 0.5, row++) {
            for (let x = (row % 2) * gs * 0.5; x < W; x += gs) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + gs * 0.5); g.stroke(); }
          }
          // slight per-slab tone variation
          row = 0;
          for (let y = y0; y < y0 + fh; y += gs * 0.5, row++) {
            for (let x = (row % 2) * gs * 0.5 - gs; x < W; x += gs) {
              g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 240},${r() < 0.5 ? 0 : 200},${r() * 0.05})`;
              g.fillRect(x, y, gs, gs * 0.5);
            }
          }
        }
      }
      for (let b = 0; b < BAYS; b++) {
        const x0 = b * PX;
        if (!windows) continue;
        if (st.sparse && (b + f) % 2 === 1) continue;
        const ww = st.win.w * pxm, wh = st.win.h * pxm;
        const wx = x0 + (PX - ww) / 2;
        const wy = y0 + fh - (st.win.sill + st.win.h) * pxm;
        if (emissive) {
          const lit = r() < 0.42;
          if (lit) {
            const cols = ['#ffd79a', '#ffe7b8', '#fff3d8', '#ffc980', '#e6efff'];
            g.fillStyle = cols[Math.floor(r() * cols.length)];
            g.globalAlpha = 0.55 + r() * 0.45;
            g.fillRect(wx, wy, ww, wh);
            g.globalAlpha = 1;
          }
          continue;
        }
        if (isG) {
          // tall recessed opening between red sandstone piers
          const ow = PX * 0.56, ox = x0 + (PX - ow) / 2;
          const oy = y0 + fh * 0.1, oh = fh * 0.82;
          g.fillStyle = 'rgba(40,10,5,0.45)'; g.fillRect(ox - 3, oy - 3, ow + 6, oh + 6);
          g.fillStyle = '#efe9da'; g.fillRect(ox, oy, ow, oh);
          const grd = g.createLinearGradient(0, oy, 0, oy + oh);
          grd.addColorStop(0, '#1c2a33'); grd.addColorStop(1, '#3a4d59');
          g.fillStyle = grd; g.fillRect(ox + ow * 0.14, oy + oh * 0.12, ow * 0.72, oh * 0.6);
          g.fillStyle = '#efe9da'; g.fillRect(ox + ow * 0.49, oy + oh * 0.12, ow * 0.02, oh * 0.6);
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox, oy, ow, 5);
          continue;
        }
        // frame + glass
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(wx - 2, wy - 2, ww + 4, wh + 7);
        g.fillStyle = '#f4f1ea'; g.fillRect(wx, wy, ww, wh);
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        grd.addColorStop(0, '#18242c'); grd.addColorStop(0.6, '#2d404b'); grd.addColorStop(1, '#41596a');
        const n = st.win.panes, gap = 3;
        for (let p = 0; p < n; p++) {
          g.fillStyle = grd;
          g.fillRect(wx + gap + (p * (ww - gap)) / n, wy + gap, (ww - gap) / n - gap, wh - gap * 2);
          if (r() < 0.3) { // curtain / reflection
            g.fillStyle = `rgba(${200 + r() * 40},${190 + r() * 40},${170 + r() * 40},0.25)`;
            g.fillRect(wx + gap + (p * (ww - gap)) / n, wy + gap, (ww - gap) / n - gap, (wh - gap * 2) * (0.3 + r() * 0.5));
          }
        }
        // sill + chajja
        g.fillStyle = shade(st.wall, 0.82); g.fillRect(wx - 5, wy + wh, ww + 10, 4);
        g.fillStyle = shade(st.wall, 1.04); g.fillRect(wx - 7, wy - 7, ww + 14, 5);
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(wx - 7, wy - 2, ww + 14, 4);
        // weather streak
        const sg = g.createLinearGradient(0, wy + wh, 0, wy + wh + fh * 0.3);
        sg.addColorStop(0, 'rgba(70,60,45,0.13)'); sg.addColorStop(1, 'rgba(70,60,45,0)');
        g.fillStyle = sg; g.fillRect(wx, wy + wh + 4, ww, fh * 0.3);
        if (st.shadeBar) { g.fillStyle = '#a64b30'; g.fillRect(wx - 8, wy + wh + 5, ww + 16, 3); }
        if (st.vent) { g.fillStyle = '#35424a'; g.fillRect(wx + ww + PX * 0.07, wy + 2, PX * 0.08, wh * 0.22); }
        if (st.lintelLine) { g.fillStyle = st.lintelLine; g.fillRect(x0, wy - 12, PX, 2); }
        if (st.balcony && b % 2 === 0) {
          const by = y0 + fh - 1.05 * pxm;
          g.fillStyle = shade(st.wall, 0.93); g.fillRect(x0 + 6, by, PX - 12, 1.05 * pxm - 3);
          g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x0 + 6, by + 1.05 * pxm - 5, PX - 12, 4);
          g.fillStyle = shade(st.wall, 0.78); g.fillRect(x0 + 6, by, PX - 12, 3);
        }
      }
      if (!emissive) {
        // slab band
        g.fillStyle = st.band; g.fillRect(0, y0 + fh - st.bandH * pxm * (f === 0 ? 0 : 1), W, f === 0 ? 0 : st.bandH * pxm);
        if (isG) { g.fillStyle = shade(st.ground.wall, 0.8); g.fillRect(0, y0, W, 5); }
        if (f === 0) { // plinth
          g.fillStyle = 'rgba(60,50,40,0.35)'; g.fillRect(0, H - 0.35 * pxm, W, 0.35 * pxm);
        }
      }
    }
    if (!emissive) {
      g.fillStyle = st.top; g.fillRect(0, 0, W, ph);
      g.fillStyle = st.band; g.fillRect(0, ph - 3, W, 4);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, 3);
      // grime
      const gg = g.createLinearGradient(0, 0, 0, H);
      gg.addColorStop(0, 'rgba(60,50,30,0.10)'); gg.addColorStop(0.15, 'rgba(60,50,30,0)');
      gg.addColorStop(0.9, 'rgba(60,50,30,0)'); gg.addColorStop(1, 'rgba(70,50,30,0.16)');
      g.fillStyle = gg; g.fillRect(0, 0, W, H);
      speckle(g, W, H, r, W * H / 90, 0.05);
    }
  }, { aniso: 8 });
}

// ---------------------------------------------------------------- surfaces
export function noiseTex(size = 512, seed = 1) {
  return canvasTex(size, size, (g) => {
    const r = rng(seed);
    const id = g.createImageData(size, size);
    // layered value noise, tileable by construction (random lattice wrapped)
    const layers = [8, 16, 32, 64, 128].map((n) => ({ n, v: Float32Array.from({ length: n * n * 3 }, () => r()) }));
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let s = 0, wsum = 0;
        layers.forEach((L, li) => {
          if ((ch === 2) && li > 1) return;
          const fx = (x / size) * L.n, fy = (y / size) * L.n;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = sm(fx - x0), ty = sm(fy - y0);
          const at = (ix, iy) => L.v[(((iy % L.n) * L.n) + (ix % L.n)) * 3 + ch];
          const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
          const w = ch === 0 ? 1 / (li + 1) : 1 / (5 - li);
          s += v * w; wsum += w;
        });
        id.data[o + ch] = Math.max(0, Math.min(255, (s / wsum) * 255));
      }
      id.data[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, { srgb: false });
}

export function roadTex(kind) {
  // u across the road (0..1), v along (one tile = 8 m)
  return canvasTex(256, 512, (g, w, h) => {
    const r = rng(kind.length + 5);
    const base = { main: '#96948c', road: '#93918a', service: '#8f8d86', asphalt: '#4b4c50' }[kind] || '#aaa';
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 9000, 0.09);
    // tyre-darkened lanes
    for (const cx of [0.3, 0.7]) {
      const gr = g.createLinearGradient((cx - 0.16) * w, 0, (cx + 0.16) * w, 0);
      gr.addColorStop(0, 'rgba(40,40,40,0)'); gr.addColorStop(0.5, 'rgba(40,40,40,0.10)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    if (kind === 'asphalt') {
      for (let i = 0; i < 26; i++) { const v = r() < 0.5 ? 20 : 130; g.fillStyle = `rgba(${v},${v},${v},${r() * 0.07})`; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 70, 20 + r() * 90, 0, 0, 7); g.fill(); }
      return;
    }
    // concrete panel joints
    g.strokeStyle = 'rgba(50,50,45,0.45)'; g.lineWidth = 2;
    for (const y of [0, h / 2]) { g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke(); }
    if (kind === 'main' || kind === 'road') { g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke(); }
    // cracks
    g.strokeStyle = 'rgba(40,40,40,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

export function kerbTex() {
  // v along the kerb: one tile = 2 m = one yellow block + one black block
  return canvasTex(64, 256, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = '#d9b23c'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#2a2a2c'; g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h / 2, w, 3);
    for (let i = 0; i < 500; i++) { const v = r() < 0.5 ? 255 : 40; g.fillStyle = `rgba(${v},${v},${v},${r() * 0.18})`; g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 4); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(200,200,195,${0.1 + r() * 0.25})`; g.beginPath(); g.ellipse(r() * w, h / 2 + r() * h / 2, 3 + r() * 9, 2 + r() * 6, 0, 0, 7); g.fill(); }
  });
}

export function paverTex(color = '#b98f72') {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(21);
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = -32; x < w; x += 64) {
      const xx = x + ((y / 32) % 2) * 32;
      const v = r() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.8},${r() * 0.09})`;
      g.fillRect(xx, y, 64, 32);
      g.strokeStyle = 'rgba(60,30,25,0.42)'; g.lineWidth = 1.5;
      // zig-zag joints, as on interlocking pavers
      g.beginPath(); g.moveTo(xx, y);
      for (let k = 0; k <= 4; k++) g.lineTo(xx + k * 16, y + (k % 2 ? 4 : 0));
      g.moveTo(xx, y); g.lineTo(xx + 3, y + 16); g.lineTo(xx, y + 32); g.stroke();
    }
    speckle(g, w, h, r, 3000, 0.08);
  });
}

export function plainTex(color, seed = 3, amt = 0.07, lines = 0) {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 7000, amt);
    for (let i = 0; i < 14; i++) {
      const v = r() < 0.5 ? 20 : 240;
      g.fillStyle = `rgba(${v},${v},${v - 8},${r() * 0.05})`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 20 + r() * 60, 0, 0, 7); g.fill();
    }
    if (lines) {
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2;
      for (let x = 0; x < w; x += w / lines) { g.beginPath(); g.moveTo(x + 1, 0); g.lineTo(x + 1, h); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      for (let x = 0; x < w; x += w / lines) { g.beginPath(); g.moveTo(x + 4, 0); g.lineTo(x + 4, h); g.stroke(); }
    }
  });
}

export function grassTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(41);
    g.fillStyle = '#5f8a3a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = r();
      g.strokeStyle = `rgba(${50 + v * 80},${95 + v * 90},${30 + v * 40},0.5)`;
      const x = r() * w, y = r() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 2 - r() * 5); g.stroke();
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? 30 : 190},${r() < 0.5 ? 60 : 190},${r() < 0.5 ? 20 : 90},${r() * 0.08})`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 80, 30 + r() * 80, 0, 0, 7); g.fill();
    }
  });
}

// sport court markings; canvas is the oriented bounding rectangle of the court
export function courtTex(sport, name) {
  const W = 512, H = 1024;
  return canvasTex(W, H, (g) => {
    const r = rng(sport.length * 7);
    const line = (c = '#f5f5f0', lw = 6) => { g.strokeStyle = c; g.lineWidth = lw; };
    const m = 28;
    if (sport.startsWith('tennis')) {
      g.fillStyle = '#3d7a4d'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#31659c'; g.fillRect(m * 2.4, m * 4, W - m * 4.8, H - m * 8);
      line();
      const x0 = m * 2.4, x1 = W - m * 2.4, y0 = m * 4, y1 = H - m * 4;
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const sx = (x1 - x0) * 0.125; g.strokeRect(x0 + sx, y0, x1 - x0 - 2 * sx, y1 - y0);
      const sy = (y1 - y0) * 0.27; g.strokeRect(x0 + sx, y0 + sy, x1 - x0 - 2 * sx, y1 - y0 - 2 * sy);
      g.beginPath(); g.moveTo(W / 2, y0 + sy); g.lineTo(W / 2, y1 - sy); g.moveTo(x0 - 10, H / 2); g.lineTo(x1 + 10, H / 2); g.stroke();
    } else if (sport.startsWith('basketball')) {
      g.fillStyle = '#3b6ea5'; g.fillRect(0, 0, W, H);
      line();
      g.strokeRect(m, m, W - 2 * m, H - 2 * m);
      g.beginPath(); g.moveTo(m, H / 2); g.lineTo(W - m, H / 2); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 60, 0, 7); g.stroke();
      for (const s of [1, -1]) {
        const by = s > 0 ? m : H - m;
        g.fillStyle = '#c4633a'; g.fillRect(W / 2 - 80, s > 0 ? by : by - 190, 160, 190);
        g.strokeRect(W / 2 - 80, s > 0 ? by : by - 190, 160, 190);
        g.beginPath(); g.arc(W / 2, by + s * 190, 80, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : 2 * Math.PI); g.stroke();
        g.beginPath(); g.arc(W / 2, by + s * 50, 210, s > 0 ? 0.15 : Math.PI + 0.15, s > 0 ? Math.PI - 0.15 : 2 * Math.PI - 0.15); g.stroke();
      }
    } else if (sport.startsWith('volleyball') || sport.startsWith('kho')) {
      g.fillStyle = '#b89b6e'; g.fillRect(0, 0, W, H);
      speckle(g, W, H, r, 12000, 0.08);
      line('#f2efe6', 6); g.strokeRect(m * 2, m * 2, W - 4 * m, H - 4 * m);
      g.beginPath(); g.moveTo(m * 2, H / 2); g.lineTo(W - m * 2, H / 2); g.stroke();
    } else if (sport.startsWith('badminton')) {
      g.fillStyle = '#4f7f58'; g.fillRect(0, 0, W, H);
      line('#f5f5f0', 5); g.strokeRect(m, m, W - 2 * m, H - 2 * m);
      g.strokeRect(m + 40, m, W - 2 * m - 80, H - 2 * m);
      g.beginPath(); g.moveTo(m, H / 2); g.lineTo(W - m, H / 2); g.moveTo(W / 2, m); g.lineTo(W / 2, H / 2 - 110); g.moveTo(W / 2, H / 2 + 110); g.lineTo(W / 2, H - m);
      g.moveTo(m, H / 2 - 110); g.lineTo(W - m, H / 2 - 110); g.moveTo(m, H / 2 + 110); g.lineTo(W - m, H / 2 + 110); g.stroke();
    } else if (sport.startsWith('chess')) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#2e2e2e' : '#eae6da'; g.fillRect(x * W / 8, y * H / 8, W / 8, H / 8); }
    } else { // soccer
      const dirt = /Old/.test(name);
      g.fillStyle = dirt ? '#b9966a' : '#5c8a3c'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = dirt ? `rgba(${150 + r() * 60},${120 + r() * 50},${70 + r() * 40},0.18)` : `rgba(${120 + r() * 60},${130 + r() * 40},${60 + r() * 30},0.2)`;
        g.beginPath(); g.ellipse(r() * W, r() * H, 20 + r() * 90, 20 + r() * 90, 0, 0, 7); g.fill();
      }
      speckle(g, W, H, r, 14000, 0.07);
      line('rgba(245,245,238,0.85)', 4);
      g.strokeRect(m, m, W - 2 * m, H - 2 * m);
      g.beginPath(); g.moveTo(m, H / 2); g.lineTo(W - m, H / 2); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 62, 0, 7); g.stroke();
      for (const s of [0, 1]) {
        const y = s ? H - m - 110 : m;
        g.strokeRect(W / 2 - 135, y, 270, 110);
        g.strokeRect(W / 2 - 62, s ? H - m - 38 : m, 124, 38);
      }
    }
  }, { repeat: false });
}

export function textSprite(text, { size = 44, color = '#fff', bg = 'rgba(18,22,30,0.72)', pad = 14 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `600 ${size}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = size + pad * 1.4;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2.6); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(m);
  s.scale.set(0.027 * (w / h), 0.027, 1);
  s.renderOrder = 10;
  return s;
}

export function signTex(lines, { w = 1024, h = 256, bg = '#e9e2d0', fg = '#1f2a44' } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = `${l.weight || 700} ${l.size}px Georgia, "Times New Roman", serif`;
      g.fillStyle = l.color || fg;
      g.fillText(l.text, w / 2, l.y * h);
    });
  }, { repeat: false });
}

export function curtainTex() {
  // one 9 m structural bay of the library's glass front: orange column + teal glazing grid
  return canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#4d8f93'); gr.addColorStop(0.55, '#2f6f78'); gr.addColorStop(1, '#245a66');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 5; i++) g.fillRect(40 + i * 97, 30 + (i % 2) * 90, 60, 170);
    g.strokeStyle = '#e8e6df'; g.lineWidth = 4;
    for (let x = 40; x < w; x += 59) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += h / 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#d2622c'; g.fillRect(0, 0, 36, h);
    g.fillStyle = '#e9dfc8'; g.fillRect(0, 0, w, 26);
    g.fillStyle = '#a64b30'; g.fillRect(0, h - 22, w, 22);
  });
}
