// usage: node tools/shot.mjs out_prefix "x,y,z,yaw,pitch[,time]" ...   (or "place:Name[,time]")
import puppeteer from 'puppeteer-core';
const [, , prefix, ...views] = process.argv;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1400,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 820 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto((process.env.URL || 'http://localhost:5173') + '/?shot=1' + (process.env.UI ? '' : '&ui=0'), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
let i = 0;
for (const v of views) {
  const a = v.split(',');
  await page.evaluate((a) => {
    const t = ['day', 'evening', 'night'].includes(a[a.length - 1]) ? a.pop() : 'day';
    window.__time(t);
    window.__go(+a[0], +a[1], +a[2], +a[3], +a[4]);
  }, a);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${prefix}${i++}.jpg`, type: 'jpeg', quality: 80 });
}
const info = await page.evaluate(async () => {
  let n = 0; const t0 = performance.now();
  await new Promise((res) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  return JSON.stringify({ fps: Math.round(n / 2), ...window.__info() });
});
console.log(info);
await browser.close();
