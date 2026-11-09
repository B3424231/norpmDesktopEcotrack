'use strict';
// Production helpers and detail templates; isolated equipment, no account or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), publicDir = path.join(root, 'public');
const out = path.join(root, 'reports/maintenance-unit-20261104/browser');
const source = fs.readFileSync(path.join(publicDir, 'js/maintenance-modal.js'), 'utf8').replace(/\r\n/g, '\n');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const helpers = section('  function maintenanceDisplayText(', '  function maintenanceStateClasses(');
const repairTemplate = section('      <!-- 2. TARGET UNIT & ASSIGNMENT STRIP', '      <!-- 3. REMEDIATION CHECKLIST');
const regularTemplate = section('        <!-- META OVERVIEW -->', '            <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase block">Maintenance Type</span>');
// The last regular-template opening div belongs to the next unrelated card.
const regularCards = regularTemplate.slice(0, regularTemplate.lastIndexOf('<div class=')) + '</div>';
let browser, server;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((req, res) => {
    const name = path.resolve(publicDir, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!name.startsWith(publicDir + path.sep) || !fs.existsSync(name) || !fs.statSync(name).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({ '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' })[path.extname(name)] || 'application/octet-stream');
    fs.createReadStream(name).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const checks = [];
  for (const theme of ['light', 'dark']) for (const width of [414, 1460]) {
    const page = await browser.newPage({ viewport: { width, height: 650 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    await page.setContent(`<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}"><head><base href="${base}/"><script src="vendor/tailwindcss.js"></script><script>tailwind.config={darkMode:'class'}</script><link rel="stylesheet" href="styles.css"></head><body class="app-shell"><main style="padding:20px"><div id="ecoDetailModalBody"><div id="repair"></div><div id="regular" style="margin-top:24px"></div></div></main></body></html>`);
    await page.addScriptTag({ url: base + '/js/device-labels.js' });
    await page.addScriptTag({ content: helpers + `
      window.name='';
      window.EcoTrackMode={mode:'both'};
      const ac={id:'asset-one',airconId:'ac-one',nodeId:'node-one',nodeName:'AC Sensor 04A7AC',airconName:'Aircon Matrix',airconType:'Window Type (Inverter)',building:'IC building',floor:'Floor 1',room:'Room 1'};
      window.EcoTrackAirconSystem={AirconProfileManager:{getAll:()=>[]}};
      const getAirconsDatabase=()=>[ac];
      function renderFixture(missing=false){
        const report={aircon_id:missing?'deleted-node':'node-one',staffName:'Fixture technician',dueDate:'2026-11-05'};
        const aircon=findMaintenanceAircon(report)||{};
        const equipment=maintenanceReportEquipment(report,aircon);
        if(typeof equipment!=='object')throw new Error('Equipment resolver returned '+typeof equipment);
        document.getElementById('repair').innerHTML=${'`' + repairTemplate + '`'};
        document.getElementById('regular').innerHTML=${'`' + regularCards + '`'};
      }
      renderFixture();
    ` });
    for (const target of ['repair', 'regular']) {
      const card = page.locator('#' + target + ' > div > div').first();
      await card.getByText('AC device 04A7AC', { exact: true }).waitFor();
      assert((await card.innerText()).includes('IC building • Floor 1 • Room 1'));
      const spans = await card.locator('span').allTextContents();
      assert(spans.every(text => text.trim() && text.trim() !== '📍'));
      assert(await card.isVisible());
    }
    assert((await page.locator('#repair').innerText()).includes('Window Type (Inverter)'));
    await page.screenshot({ path: path.join(out, `unit-${theme}-${width}.png`) });
    await page.evaluate(() => renderFixture(true));
    for (const target of ['repair', 'regular']) {
      const card = page.locator('#' + target + ' > div > div').first();
      assert((await card.innerText()).includes('AC Device unavailable'));
      assert((await card.innerText()).includes('Location unavailable'));
    }
    assert.deepEqual(errors, []);
    checks.push({ theme, width, status: 'PASS', repairAndRegularUnit: true, missingDeviceFallback: true, runtimeErrors: errors });
    console.log('PASS maintenance unit details', theme, width);
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'PASS', liveWrites: false, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.close(); });
