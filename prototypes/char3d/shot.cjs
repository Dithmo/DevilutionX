const { chromium } = require('playwright');
(async () => {
  const [,, out, setJson, clip] = process.argv;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1180, height: 1500 }, deviceScaleFactor: 1 });
  const logs = [];
  p.on('console', m => logs.push(m.type() + ': ' + m.text()));
  p.on('pageerror', e => logs.push('ERR ' + e.message));
  await p.addInitScript(() => { window.__noWarm = true; });
  await p.goto('http://localhost:8810/index.html', { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }).catch(e => logs.push('timeout'));
  if (setJson) await p.evaluate(o => window.__set(o), JSON.parse(setJson));
  await p.evaluate(() => { window.__frames = 0; });
  await p.waitForFunction(() => window.__frames >= 2, null, { timeout: 300000 });
  const ms = await p.evaluate(() => document.getElementById('stats').textContent);
  if (clip) { const [x,y,w,h] = clip.split(',').map(Number); await p.screenshot({ path: out, clip: {x,y,width:w,height:h} }); }
  else await p.screenshot({ path: out, fullPage: true });
  console.log('bake ms', ms); console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
