'use strict';
// Real desktop state engines with the existing isolated Supabase/event harness.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'test_page_connections.js'), 'utf8');
const harness = source.slice(0, source.indexOf('async function run(){'));
const scenario = `
(async () => {
  const apps = pages.map(makePage), clock = Date.now();
  db.ecotrack_device_state[0].last_seen = new Date(clock).toISOString();
  for (const app of apps) for (const fn of app.listeners.get('supabase:ready') || []) fn();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush(); await flush();
  for (const app of apps) { await app.system.syncWithDatabase(); vm.runInContext(read('public/js/battery-status.js'), app.context); }
  const channels = realtime.filter(channel => channel.name === 'realtime_aircon_nodes');
  const row = (offset, percent, state = 'charging') => ({...copy(db.ecotrack_device_state[0]),last_seen:new Date(clock + offset).toISOString(),applied_config:{battery_percent_estimate:percent,battery_charging:state === 'charging',battery_charge_state:state,battery_voltage:3.8,battery_source:'mock'}});
  const deliver = state => channels.forEach(channel => channel.handlers.find(item => item.filter.table === 'ecotrack_device_state').callback({eventType:'UPDATE',new:copy(state)}));
  reads.length = 0; writes.length = 0;
  deliver(row(50, 5));
  for (const app of apps) {
    const node = app.system.NodeService.getNode(deviceId), battery = app.window.EcoTrackBattery.read(node, clock + 50);
    assert.equal(battery.percent,5); assert.equal(battery.label,'Charging');
  }
  assert.equal(reads.length,0); assert.equal(writes.length,0);
  const app = apps[0], cloud = app.window.EcoTrackHardwareCloud, previousRead = cloud.listStatus;
  let release; cloud.listStatus = async () => { const stale = [row(50,5)]; await new Promise(resolve => release = resolve); return stale; };
  const pending = app.system.syncWithDatabase(); while (!release) await flush();
  deliver(row(100,100,'full')); release(); await pending; cloud.listStatus = previousRead;
  deliver(row(75,0,'discharging'));
  for (const page of apps) {
    const node = page.system.NodeService.getNode(deviceId);
    assert.equal(page.window.EcoTrackBattery.read(node,clock+100).label,'Fully charged');
    assert.equal(page.window.EcoTrackBattery.read(node,clock+45101).label,'');
    assert.equal(node.cloud_state.applied_config.battery_voltage,3.8);
  }
  assert.equal(writes.length,0);
  console.log('PASS battery realtime: five page engines update from heartbeat without writes; delayed events/reads cannot roll back full charge; stale charge hides; raw volts preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
vm.runInNewContext(harness + scenario, { require, __dirname, process, console, setImmediate, setTimeout,
  clearTimeout, setInterval, clearInterval, structuredClone, URLSearchParams, TextEncoder, TextDecoder, performance });
