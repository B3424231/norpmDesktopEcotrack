'use strict';
// Current persistence and sensor-card rendering with isolated transport/DOM.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function persistence() {
  const writes = [], events = [], window = { dispatchEvent: event => events.push(event) };
  const context = vm.createContext({ window, document: { readyState: 'loading', addEventListener() {} }, console, AbortController, clearTimeout, setTimeout, setInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (_url, options) => { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'saved-fixture' }) }; }
  });
  window.electron={invoke:async(channel,input)=>{assert.equal(channel,'telemetry-admin-request');writes.push(input.data);return {success:true,data:{id:'saved-fixture'}};}};
  vm.runInContext(read('public/js/node-sync.js'), context);
  return { save: window.EcoTrackNodeSync.saveNodeTelemetryToSqlite, writes, events };
}
function sensorView() { const h=require('./helpers/sensor-workspace-harness').createSensorHarness();return h.context; }

const packet = { id: 'rotation-fixture', room_name: 'Fixture Room', floor_name: 'Fixture Floor', building_name: 'Fixture Building', status: 'online', temp: 25, interval_seconds: 60 };

test('real persistence forwards rotation quality and suppresses fault/missing/negative or malformed RPM', async () => {
  for (const patch of [{ rotation_rpm: 120, rotation_quality: 'fault' }, { rotation_rpm: 120, rotation_quality: 'missing' }, { rotation_rpm: -1, rotation_quality: 'ok' }, { rotation_rpm: null }, { rotation_rpm: '' }, { rotation_rpm: '  ' }, { rotation_rpm: false }, { rotation_rpm: Infinity }]) {
    const f = persistence(); await f.save({ ...packet, ...patch });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].rotation_rpm, null);
    if (patch.rotation_quality) assert.equal(f.writes[0].rotation_quality, patch.rotation_quality);
    assert.equal(f.events[0].detail.rotation_rpm, null);
    assert(!Object.hasOwn(f.writes[0], 'pressure'));
  }
});

test('real measured zero and positive numeric RPM are preserved without changing power evidence', async () => {
  for (const value of [0, 120.25, '120.25']) {
    const f = persistence(); await f.save({ ...packet, rotation_rpm: value, rotation_quality: 'ok', ac_on: false });
    assert.equal(f.writes[0].rotation_rpm, Number(value));
    assert.equal(f.writes[0].rotation_quality, 'ok');
    assert.equal(f.writes[0].ac_on, false);
  }
});

test('sensor cards do not expose old or new RPM, including zero', () => {
  const f = sensorView(), node={id:'rotation-view',name:'Sensor',fresh:true,expected_interval_seconds:5,rotation_rpm:450};
  for(const rotation_rpm of [null,0,450]) {
    const card=f.sensorCard({...node,latest:{rotation_rpm,rotation_quality:'ok',observed_at:new Date().toISOString()}});
    assert.doesNotMatch(card,/Airflow|RPM|450/);
  }
});
