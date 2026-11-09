'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const now = Date.parse('2026-11-03T04:00:00Z');
const context = vm.createContext({ window: {}, Date });
if (fs.existsSync('public/js/battery-status.js')) vm.runInContext(fs.readFileSync('public/js/battery-status.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('public/js/controller-details.js', 'utf8'), context);
const status = (percent, extra = {}) => ({ last_seen: new Date(now).toISOString(), applied_config: {
  battery_percent_estimate: percent, battery_charging: true, battery_charge_state: 'charging', ...extra
} });
// Catch the existing bug: firmware percentages in applied_config never reach the controller details.
assert.equal(context.window.EcoTrackControllerDetails.battery({ cloud_state: status(5) }).percent, 5);
const api = context.window.EcoTrackBattery;
assert(api, 'The shared heartbeat battery reader must be available to all existing battery surfaces');
let checks = 1;
for (const percent of [0, 1, 5, 20, 21, 99, 100]) {
  const reading = api.read(status(percent), now);
  assert.equal(reading.percent, percent);
  assert.equal(reading.live, true);
  assert.equal(reading.label, percent === 100 ? '' : 'Charging');
  assert.equal(reading.charging, percent < 100);
  checks++;
}
for (const percent of [null, undefined, '', '5', true, -1, 101, Infinity, NaN, {}]) {
  const reading = api.read(status(percent), now);
  assert.equal(reading.reported, false);
  assert.equal(reading.percent, null);
  assert.equal(reading.label, '');
  assert.equal(reading.charging, false);
  checks++;
}
for (const [extra, label, charging] of [
  [{ battery_charging: false, battery_charge_state: 'full' }, 'Fully charged', false],
  [{ battery_charging: false, battery_charge_state: 'discharging' }, 'On battery', false],
  [{ battery_charging: null, battery_charge_state: 'charging' }, '', false],
  [{ battery_charging: 'true', battery_charge_state: 'charging' }, '', false],
  [{ battery_charging: false, battery_charge_state: 'charging' }, '', false],
  [{ battery_charging: true, battery_charge_state: 'full' }, '', false],
  [{ battery_charging: undefined, battery_charge_state: undefined }, '', false]
]) {
  const reading = api.read(status(100, extra), now);
  assert.equal(reading.label, label);
  assert.equal(reading.charging, charging);
  checks++;
}
for (const change of [
  { last_seen: new Date(now - 45001).toISOString() },
  { last_seen: new Date(now + 5001).toISOString() },
  { last_seen: null }, { last_seen: 'invalid' },
  { sleeping_until: new Date(now + 60000).toISOString() },
  { connection_status: 'offline' }, { connection_status: 'sleeping' }
]) {
  const reading = api.read({ ...status(68), ...change }, now);
  assert.equal(reading.percent, 68, 'Retain the last percentage without asserting a current charge state');
  assert.equal(reading.live, false);
  assert.equal(reading.label, '');
  assert.equal(reading.charging, false);
  checks++;
}
assert.equal(api.read({ ...status(20), last_seen: new Date(now - 45000).toISOString() }, now).live, true);
assert.equal(api.read({ ...status(20), sleeping_until: new Date(now - 1).toISOString() }, now).live, true);
assert.equal(api.read({ status: 'Connected', battery: 3.8 }, now).reported, false, 'Never convert raw volts or connectivity into charge');
assert.equal(api.read({ battery: 5, battery_unit: 'percent' }, now).percent, 5);
assert.equal(api.read({ cloud_state: status(0), battery_percent: 80 }, now).percent, 0, 'Live zero wins over a cached percentage');
assert.equal(api.read(status(20, { battery_charging: false, battery_charge_state: 'full' }), now).label, '', 'A low percentage cannot claim fully charged');
const online = api.markup(api.read(status(68), now));
assert.match(online, /68%/); assert.match(online, /Charging/); assert.match(online, /data-battery-bolt/);
const stale = api.markup(api.read(status(68), now + 45001));
assert.match(stale, /68%/); assert(!stale.includes('Charging')); assert(!stale.includes('data-battery-bolt'));
assert(!online.includes('mock') && !online.includes('simulation'));
checks += 8;
// Exercise existing diagnostics consumers, so adapting only the helper cannot pass.
const maintenance = fs.readFileSync('public/js/maintenance-modal.js', 'utf8');
vm.runInContext(maintenance.slice(maintenance.indexOf('  function formatBatteryDisplay('), maintenance.indexOf('  function currentMaintenanceControllers(')), context);
context.fixtureStatus = status(5);
assert.equal(vm.runInContext('maintenanceControllerDiagnostics({battery:3.8},fixtureStatus, ' + now + ').controls.battery.val', context), '5% · Charging');
const sensor = fs.readFileSync('public/js/sensor-workspace.js', 'utf8');
Object.assign(context, { available: true, targetSetting: () => ({}), modeSetting: () => ({}), num: String,
  settingSource: () => '', settingLabel: () => '', stamp: () => '', airflowReading: () => '', airflowMeasurementNote: () => '', blowerDetail: () => '',
  connection: () => ({ label: 'Connected', heartbeat: status(5) }), deviceLabel: String, esc: String, intervalLabel: () => '' });
vm.runInContext(sensor.slice(sensor.indexOf('  function sensorDetailsContent('), sensor.indexOf('  function openSensorDetails(')), context);
context.fixtureSensor = { id: 'registry:node', fresh: true, latest: { battery_voltage: 3.8 } };
// A fixed clock controls the same Date.now() used by the production renderer.
vm.runInContext('Date.now=()=>'+now, context);
assert.match(vm.runInContext('sensorDetailsContent(fixtureSensor)', context), /5%.*Charging/);
checks += 2;
console.log('PASS desktop battery: ' + checks + ' boundary, explicit charging, freshness and presentation checks.');

// Run the production monitoring poll and subscription against an isolated read-only client.
Object.assign(context, { AbortController, setTimeout, clearTimeout });
vm.runInContext(`
  const nodes=[{cloud_node_id:'node-one',aircon_id:'aircon-one'}],registryDevices=[];
  const heartbeats=new Map(),liveMeasurements=new Map(),liveNodeValues=new Map(),liveAircons=new Map();
  let heartbeatScope='',heartbeatChecked=0,heartbeatInFlight=false,heartbeatAccount='',heartbeatChannel=null,heartbeatController=null,heartbeatIDs=new Set();
  let fixtureHeartbeats=[],fixtureStatusHandler;
  const page='logs',loaded=false;
  const rememberCloudReading=()=>{},rememberAirconObservation=()=>{},registryEvent=()=>{};
  window.supabaseClient={from(table){
    const query={in:()=>query,eq:()=>query,not:()=>query,order:()=>query,limit:()=>query,abortSignal:()=>query,
      then(resolve,reject){return Promise.resolve({data:table==='ecotrack_device_state'?fixtureHeartbeats:[],error:null}).then(resolve,reject);}};
    return {select:()=>query};
  },channel(){const channel={on(_type,filter,callback){if(filter.table==='ecotrack_device_state')fixtureStatusHandler=callback;return channel;},subscribe(){return channel;}};return channel;}};
`, context);
vm.runInContext(sensor.slice(sensor.indexOf('  async function refreshHeartbeats('), sensor.indexOf('  function build(')), context);
vm.runInContext(`(async()=>{
  const valid=(percent,time=Date.now())=>({node_id:'node-one',last_seen:new Date(time).toISOString(),applied_config:{battery_percent_estimate:percent,battery_charging:true,battery_charge_state:'charging'}});
  fixtureHeartbeats=[valid(80)];await refreshHeartbeats({force:true});
  fixtureHeartbeats=[valid(10,Date.now()+3600000)];await refreshHeartbeats({force:true});
  if(heartbeats.get('node-one')?.applied_config.battery_percent_estimate!==80)throw new Error('Monitoring poll cached a future heartbeat instead of retaining80%');
  for(const invalid of [valid(10,Date.now()+3600000),{...valid(10),last_seen:'invalid'}]){
    heartbeats.set('node-one',invalid);fixtureHeartbeats=[valid(81)];await refreshHeartbeats({force:true});
    if(heartbeats.get('node-one')?.applied_config.battery_percent_estimate!==81)throw new Error('Monitoring poll could not recover from an invalid cached heartbeat');
    heartbeats.set('node-one',invalid);fixtureStatusHandler({eventType:'UPDATE',new:valid(82)});
    if(heartbeats.get('node-one')?.applied_config.battery_percent_estimate!==82)throw new Error('Monitoring subscription could not recover from an invalid cached heartbeat');
  }
  fixtureStatusHandler({eventType:'UPDATE',new:valid(10,Date.now()+3600000)});
  if(heartbeats.get('node-one')?.applied_config.battery_percent_estimate!==82)throw new Error('Monitoring subscription cached a future heartbeat');
  fixtureHeartbeats=[{...valid(10),last_seen:'malformed'}];await refreshHeartbeats({force:true});
  fixtureStatusHandler({eventType:'UPDATE',new:fixtureHeartbeats[0]});
  if(heartbeats.get('node-one')?.applied_config.battery_percent_estimate!==82)throw new Error('Monitoring cached a malformed heartbeat');
})()`, context).then(() => console.log('PASS monitoring heartbeat cache: future reads/events rejected; future/malformed cache recovers from valid reads/events.')).catch(error => { console.error(error); process.exitCode = 1; });

async function checkMaintenanceInventoryCache() {
  let incoming;
  const original = { nodeId: 'node-one', deviceState: { node_id: 'node-one', last_seen: new Date(now).toISOString(), applied_config: { battery_percent_estimate: 80 } } };
  const tables = { nodes: [{ id: 'node-one', name: 'Device 1' }], rooms: [], floors: [], buildings: [], aircons: [] };
  const client = { from: table => ({ select: async () => ({ data: table === 'ecotrack_device_state' ? [incoming] : tables[table], error: null }) }) };
  const inventory = vm.createContext({ window: { EcoTrackBattery: api, dispatchEvent() {} }, console,
    _nodesAirconCache: [structuredClone(original)], _maintenanceInventoryReady: true, reportAuthVersion: 0,
    getSb: () => client, ensureReportReadSession() {}, readMaintenanceSensors: async () => [], updateStaffLocationHierarchy() {},
    maintenanceControllerDiagnostics: () => ({}), setTimeout() {}, localStorage: { setItem() {}, removeItem() {} }, CustomEvent: class {} });
  vm.runInContext(maintenance.slice(maintenance.indexOf('  async function fetchAirconsFromSupabase('), maintenance.indexOf('  // Filter AC controls strictly matching')), inventory);
  for (const invalidTimestamp of [new Date(now + 3600000).toISOString(), 'malformed']) {
    incoming = { ...original.deviceState, last_seen: invalidTimestamp, applied_config: { battery_percent_estimate: 10 } };
    inventory._nodesAirconCache = [structuredClone(original)];
    await inventory.fetchAirconsFromSupabase();
    assert.equal(inventory._nodesAirconCache[0].deviceState.applied_config.battery_percent_estimate, 80);
    inventory._nodesAirconCache[0].deviceState = incoming;
    incoming = { ...original.deviceState, applied_config: { battery_percent_estimate: 81 } };
    await inventory.fetchAirconsFromSupabase();
    assert.equal(inventory._nodesAirconCache[0].deviceState.applied_config.battery_percent_estimate, 81);
  }
  console.log('PASS maintenance inventory cache: rejects future/malformed responses and recovers from future/malformed cached status.');
}
checkMaintenanceInventoryCache().catch(error => { console.error(error); process.exitCode = 1; });
