'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = process.env.ECOTRACK_AUDIT_ARTIFACTS || path.join(root, 'reports/battery-charging-20261103/desktop-ui');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'electron-user-data'));
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (file, a, b) => { const source = read(file), start = source.indexOf(a), end = source.indexOf(b, start + a.length); assert(start >= 0 && end > start, a); return source.slice(start, end); };
app.whenReady().then(async () => {
  const results = [];
  for (const [width, theme] of [[1080, 'light'], [390, 'light'], [1080, 'dark'], [390, 'dark']]) {
    const win = new BrowserWindow({ width, height: 940, show: false, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true } });
    const errors = []; win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Content Security Policy')) errors.push(event.message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_event, done) => done({ cancel: true }));
    const fixture = path.join(out, 'battery-fixture.html');
    fs.writeFileSync(fixture, '<!doctype html><html class="' + (theme === 'dark' ? 'dark' : '') + '"><head><meta charset="utf-8"><style>' + read('public/styles.css') + read('public/css/sensor-workspace.css') + `
      body{font:14px system-ui;margin:0;padding:24px;background:${theme === 'dark' ? '#0b1220' : '#f8fafc'};color:${theme === 'dark' ? '#e2e8f0' : '#18392b'}}
      h1{font-size:24px;margin:0 0 8px}h2{font-size:16px;margin:0 0 20px}p{color:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{padding:24px;border:1px solid #64748b55;border-radius:16px;min-width:0}#monitoring .sensor-detail-list>div:not(:has(.ecotrack-battery)){display:none}input{max-width:100%}.hidden-fixture{display:none}
      </style></head><body class="app-shell"><h1>Hardware battery</h1><p>Isolated desktop renderer fixture</p><div class="grid"><article><h2>Device details</h2><span id="viewBattery"></span><div class="hidden-fixture"><time id="viewDeploymentDate"></time><time id="viewDeploymentTime"></time><span id="viewDeploymentTimezone"></span><span id="viewAdminVerified"></span></div></article><article><h2>Control diagnostics</h2><span id="dispNodeBattery"><span id="dispNodeBatteryText"></span></span></article><article><h2>Maintenance diagnostics</h2><div id="maintenance"></div><p>Unsaved report draft</p><input id="draft" value="Keep this report text"></article><article><h2>Monitoring device</h2><div id="monitoring"></div></article></div></body></html>`);
    await win.loadFile(fixture);
    const helpers = read('public/js/battery-status.js') + read('public/js/controller-details.js');
    const setup = `
      let fixtureNow = Date.now(); Date.now = () => fixtureNow;
      Object.defineProperty(document,'hidden',{get:()=>false});
      let fixtureState={node_id:'node-one',last_seen:new Date(fixtureNow).toISOString(),applied_config:{battery_percent_estimate:68,battery_charging:true,battery_charge_state:'charging'}};
      const fixtureNode={nodeId:'node-one',deviceState:fixtureState,state:'Online',controls:{}};
      const _nodesAirconCache=[fixtureNode]; let cloudRows=[]; let reportAuthVersion=0;
      const getSb=()=>({from:()=>({select:()=>({in:async()=>({data:cloudRows,error:null})})})});
      const dispNodeBatteryText=document.getElementById('dispNodeBatteryText');
      const maintenanceDisplayText=String;
      const available=true,targetSetting=()=>({}),modeSetting=()=>({}),num=String,settingSource=()=>'',settingLabel=()=>'',stamp=()=>'',airflowReading=()=>'',airflowMeasurementNote=()=>'',blowerDetail=()=>'',deviceLabel=String,esc=String,intervalLabel=()=>'';
      const connection=()=>({label:'Connected',heartbeat:fixtureState});
      const fixtureSensor={id:'registry:node-one',fresh:true,latest:{battery_voltage:3.8}};
    `;
    const production = section('public/control.html', '      function refreshControllerBattery(', '      function refreshActiveControllerBattery(') +
      section('public/js/maintenance-modal.js', '  function renderMaintenanceDiagnostics(', '  let maintenanceBatteryTimer') +
      section('public/js/sensor-workspace.js', '  function sensorDetailsContent(', '  function openSensorDetails(');
    const paint = `
      window.paintBattery=()=>{
        window.EcoTrackControllerDetails.render({cloud_state:fixtureState});
        refreshControllerBattery({cloud_state:fixtureState});
        fixtureNode.deviceState=fixtureState;
        document.getElementById('maintenance').innerHTML=renderMaintenanceDiagnostics(fixtureNode);
        document.getElementById('monitoring').innerHTML=sensorDetailsContent(fixtureSensor);
        return ['#viewBattery','#dispNodeBatteryText','[data-maintenance-battery]','#monitoring .ecotrack-battery'].map(selector=>document.querySelector(selector).textContent);
      };paintBattery();true;
    `;
    await win.webContents.executeJavaScript(helpers + setup + production + paint);
    let labels = await win.webContents.executeJavaScript('paintBattery()');
    assert(labels.every(label => label.includes('68%') && label.includes('Charging')));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(out, `charging-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
    labels = await win.webContents.executeJavaScript("fixtureState={...fixtureState,last_seen:new Date(fixtureNow+10).toISOString(),applied_config:{battery_percent_estimate:100,battery_charging:false,battery_charge_state:'full'}};paintBattery()");
    assert(labels.every(label => label.includes('100%') && label.includes('Fully charged')));
    labels = await win.webContents.executeJavaScript("fixtureState.applied_config={battery_percent_estimate:5,battery_charging:false,battery_charge_state:'discharging'};paintBattery()");
    assert(labels.every(label => label.includes('5%') && label.includes('On battery')));
    labels = await win.webContents.executeJavaScript("fixtureState.applied_config={battery_percent_estimate:0,battery_charging:true,battery_charge_state:'charging'};paintBattery()");
    assert(labels.every(label => label.includes('0%') && label.includes('Charging')));
    labels = await win.webContents.executeJavaScript('fixtureNow+=45011;paintBattery()');
    assert(labels.every(label => label.includes('0%') && !label.includes('Charging')));
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("[data-battery-bolt]").length'), 0);
    // A newer heartbeat follows a stale page without rebuilding the draft form.
    await win.webContents.executeJavaScript("cloudRows=[{...fixtureState,last_seen:new Date(fixtureNow).toISOString(),applied_config:{battery_percent_estimate:21,battery_charging:true,battery_charge_state:'charging'}}];refreshMaintenanceBatteryReadings()");
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-maintenance-battery]").textContent'), /21%.*Charging/);
    await win.webContents.executeJavaScript("cloudRows=[{...fixtureState,last_seen:new Date(fixtureNow-60000).toISOString()}];refreshMaintenanceBatteryReadings()");
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-maintenance-battery]").textContent'), /21%.*Charging/);
    // Invalid future status must never poison monotonic cache ordering.
    await win.webContents.executeJavaScript("cloudRows=[{...fixtureState,last_seen:new Date(fixtureNow+3600000).toISOString(),applied_config:{battery_percent_estimate:10,battery_charging:false,battery_charge_state:'discharging'}}];refreshMaintenanceBatteryReadings()");
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-maintenance-battery]").textContent'), /21%.*Charging/);
    for(const badTimestamp of ['future','malformed']) {
      await win.webContents.executeJavaScript("fixtureNode.deviceState={...fixtureState,last_seen:" + (badTimestamp === 'future' ? 'new Date(fixtureNow+3600000).toISOString()' : "'not-a-date'") + ",applied_config:{battery_percent_estimate:10}};cloudRows=[{...fixtureState,last_seen:new Date(fixtureNow).toISOString(),applied_config:{battery_percent_estimate:81,battery_charging:true,battery_charge_state:'charging'}}];refreshMaintenanceBatteryReadings()");
      assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-maintenance-battery]").textContent'), /81%.*Charging/);
    }
    await win.webContents.executeJavaScript("cloudRows=[];window.EcoTrackAirconSystem={NodeService:{getNode:()=>({cloud_state:{...fixtureState,last_seen:new Date(fixtureNow+3600000).toISOString(),applied_config:{battery_percent_estimate:10}}})}};refreshMaintenanceBatteryReadings()");
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-maintenance-battery]").textContent'), /81%.*Charging/);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("draft").value'), 'Keep this report text');
    const layout = await win.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth,labels:[...document.querySelectorAll(".ecotrack-battery")].map(el=>el.getAttribute("aria-label"))})');
    assert.equal(layout.overflow, false); assert(layout.labels.every(Boolean)); assert.deepEqual(errors, []);
    results.push({ width, theme, status: 'PASS', surfaces: 4, state_updates: ['charging', 'full', 'discharging', 'zero', 'stale', 'recovery'], draft_preserved: true, stale_read_rejected: true, future_read_rejected: true, invalid_cache_recovered: true, future_service_cache_rejected: true });
    win.destroy();
  }
  fs.writeFileSync(path.join(out, 'render-results.json'), JSON.stringify({ results, live_database_modified: false, physical_hardware_tested: false }, null, 2));
  console.log('PASS battery render: four existing renderers, four viewport/theme combinations, live state changes, stale charging removal, recovery and preserved maintenance draft.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
