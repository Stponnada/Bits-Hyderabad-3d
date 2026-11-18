// true per-group render cost: hide each top-level group in turn and read what the renderer drew
import puppeteer from 'puppeteer-core';
const [, , view] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1400,820'] });
const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 820 });
await page.goto('http://localhost:5173/?shot=1&ui=0' + (process.env.Q || ''), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
const out = await page.evaluate(async (a) => {
  window.__go(...a); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const measure = async () => { await wait(350); const i = window.__info(); return [i.tris, i.calls]; };
  const base = await measure(), rows = [];
  for (const o of window.__scene.children) {
    if (!o.visible) continue; o.visible = false; const m = await measure(); o.visible = true;
    const dt = base[0] - m[0], dc = base[1] - m[1];
    if (dt > 30000 || dc > 15) rows.push([dt, dc, (o.name || o.type) + '#' + window.__scene.children.indexOf(o)]);
  }
  rows.sort((x, y) => y[0] - x[0]);
  return { base, rows: rows.map((r) => `${(r[0] / 1e6).toFixed(2)}M tris ${String(r[1]).padStart(4)} calls  ${r[2]}`) };
}, view.split(',').map(Number));
console.log(`total ${(out.base[0] / 1e6).toFixed(2)}M tris, ${out.base[1]} calls`); console.log(out.rows.join('\n'));
await browser.close();
