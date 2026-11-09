'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('public/control.html', 'utf8');
const element = { textContent: '', innerHTML: '', dataset: {} };
const node = { battery: null, cloud_state: { last_seen: new Date().toISOString(), applied_config: {
  battery_percent_estimate: 5, battery_charging: true, battery_charge_state: 'charging'
} } };
const context = vm.createContext({ window: {}, node, isNodeOnline: true, dispNodeBatteryText: element,
  document: { getElementById: () => element }, Date });
vm.runInContext(fs.readFileSync('public/js/battery-status.js', 'utf8'), context);
const start = source.indexOf('        // Battery status calculation');
const end = source.indexOf('        if (typeof renderWorkspaceTabData', start);
const functionStart = source.indexOf('      function refreshControllerBattery(');
if (functionStart >= 0) vm.runInContext(source.slice(functionStart, source.indexOf('      function refreshActiveControllerBattery(', functionStart)), context);
vm.runInContext(source.slice(start, end), context);
assert.match(element.innerHTML || element.textContent, /5%.*Charging/);
node.cloud_state.last_seen = new Date(Date.now() - 45001).toISOString();
vm.runInContext(source.slice(start, end), context);
assert.match(element.innerHTML, /5%/); assert(!element.innerHTML.includes('Charging'));
node.cloud_state.applied_config.battery_percent_estimate = null;
vm.runInContext(source.slice(start, end), context);
assert.match(element.innerHTML, /Not reported/);

let now = Date.now();
context.Date = { now: () => now, parse: Date.parse };
function showBattery(nodeId, percent, { advance = 5000, age = 0, ...charge } = {}) {
  now += advance;
  node.db_id = nodeId;
  node.cloud_state.last_seen = new Date(now - age).toISOString();
  node.cloud_state.applied_config = { battery_percent_estimate: percent, ...charge };
  vm.runInContext(source.slice(start, end), context);
  return element.innerHTML;
}

assert.match(showBattery('controller-one', 22), /22%/);
for (const percent of [19, 20, 21, 22, 20, 18, 21, 22]) {
  assert.match(showBattery('controller-one', percent), /22%/, 'Neighboring estimates must not flicker');
  assert.match(element.className, /emerald/);
}
assert.match(showBattery('controller-one', 19), /22%/);
assert.match(showBattery('controller-one', 19, { advance: 0 }), /22%/, 'A repeat render is not a new heartbeat');
assert.match(showBattery('controller-one', 19), /22%/);
assert.match(showBattery('controller-one', 19), /19%/, 'A confirmed small drop must appear');
assert.match(element.className, /rose/);
assert.match(showBattery('controller-one', 14), /14%/, 'A larger drop must appear immediately');
assert.match(showBattery('controller-two', 16), /16%/, 'A controller switch must use its own reading');
assert.match(showBattery('controller-two', 17, { battery_charging: true, battery_charge_state: 'charging' }), /17%.*Charging/);
assert.match(showBattery('controller-two', 16, { age: 46000 }), /16%/);
assert.doesNotMatch(element.innerHTML, /Charging/);
assert.match(showBattery('controller-two', null), /Not reported/);
assert.match(showBattery('controller-two', 18), /18%/);

assert.match(showBattery('controller-three', 22), /22%/);
assert.match(showBattery('controller-three', 19), /22%/);
assert.match(showBattery('controller-three', 20), /22%/);
assert.match(showBattery('controller-three', 19), /19%/, 'Repeated low readings must show low battery');
assert.match(element.className, /rose/);
assert.match(showBattery('controller-three', 100, { advance: 0, age: 5000, battery_charging: false, battery_charge_state: 'full' }), /19%/);
assert.doesNotMatch(element.innerHTML, /Fully charged/);
console.log('PASS control battery: steady display, confirmed changes, controller switches, freshness and missing data.');
