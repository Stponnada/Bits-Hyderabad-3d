// usage: node tools/profile.mjs "x,y,z,yaw,pitch" ...  -> per-group triangle/draw-call breakdown and frame time
import puppeteer from 'puppeteer-core';
const views = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1400,820'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 820, deviceScaleFactor: +(process.env.DPR || 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/?shot=1&ui=0' + (process.env.Q || ''), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
for (const v of views) {
  const a = v.split(',').map(Number);
  const out = await page.evaluate(async (a) => {
    window.__go(...a);
    await new Promise((r) => setTimeout(r, 1500));
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    const groups = {};
    const top = (o) => { let p = o; while (p.parent && p.parent !== window.__scene) p = p.parent; return p; };
    window.__scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false; if (!vis) return;
      const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      const t = top(o), key = (t.name || t.type) + '#' + window.__scene.children.indexOf(t) + (o.castShadow ? ' [shadow]' : '');
      (groups[key] ||= { tris: 0, calls: 0 }); groups[key].tris += tri; groups[key].calls++;
    });
    const rows = Object.entries(groups).sort((x, y) => y[1].tris - x[1].tris).slice(0, 14).map(([k, v]) => `${(v.tris / 1e6).toFixed(2)}M ${String(v.calls).padStart(4)} calls  ${k}`);
    const i = window.__info();
    return { fps: Math.round(n / 3), frameTris: i.tris, frameCalls: i.calls, rows };
  }, a);
  console.log(`\n== ${v}  fps ${out.fps}  rendered tris ${(out.frameTris / 1e6).toFixed(1)}M  calls ${out.frameCalls}`);
  console.log(out.rows.join('\n'));
}
await browser.close();
