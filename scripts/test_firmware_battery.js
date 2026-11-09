'use strict';
// Execute the battery-only C++ arithmetic/branches with Arduino GPIO/time doubles.
// Type erasure below does not emulate ESP32 hardware; arduino-cli checks the C++.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sketchPath = path.join(__dirname, '../firmware/ecotrack_cloud_measurements/ecotrack_cloud_measurements.ino');

function battery({ percent = 80, usb = true, stepMs = 10000 } = {}) {
  const source = fs.readFileSync(sketchPath, 'utf8');
  const block = source.match(/\/\/ BEGIN MOCK BATTERY SOURCE\r?\n([\s\S]*?)\/\/ END MOCK BATTERY SOURCE/);
  assert.ok(block, 'Firmware must provide the replaceable mock battery source');
  const pins = {}, modes = {}, holds = new Set();
  let now = 0, deepSleepHeld = false;
  let code = block[1]
    .replace(/static_assert\([\s\S]*?\);/g, '')
    .replace(/constexpr int MOCK_BATTERY_INITIAL_PERCENT = \d+;/, `constexpr int MOCK_BATTERY_INITIAL_PERCENT = ${percent};`)
    .replace(/constexpr bool MOCK_BATTERY_USB_PRESENT = (true|false);/, `constexpr bool MOCK_BATTERY_USB_PRESENT = ${usb};`)
    .replace(/constexpr uint32_t MOCK_BATTERY_STEP_MS = \d+UL;/, `constexpr uint32_t MOCK_BATTERY_STEP_MS = ${stepMs}UL;`)
    .replace(/const uint32_t (\w+) = ([^;]+);/g, 'const $1 = Math.trunc($2);')
    .replace(/constexpr (?:uint8_t|uint16_t|uint32_t|int|bool) /g, 'const ')
    .replace(/(?:RTC_DATA_ATTR|static) (?:uint32_t|int) /g, 'let ')
    .replace(/(?:void|float|bool|const char \*) (\w+)\(/g, 'function $1(')
    .replace(/JsonObject (\w+)/g, '$1')
    .replace(/\b(\d+)UL\b/g, '$1')
    .replace(/\b(\d+(?:\.\d+)?)f\b/g, '$1')
    .replace(/\(gpio_num_t\)/g, '');
  code += '\nthis.api = { beginBatteryStatus, updateBatteryStatus, holdBatteryLeds, writeBatteryStatus, batteryVoltage };';
  const context = vm.createContext({ Math, HIGH: 1, LOW: 0, OUTPUT: 'output',
    millis: () => now, uint32_t: value => value >>> 0,
    min: Math.min, max: Math.max, constrain: (value, lo, hi) => Math.max(lo, Math.min(hi, value)),
    pinMode: (pin, mode) => { modes[pin] = mode; },
    digitalWrite: (pin, level) => { pins[pin] = level; },
    gpio_hold_en: pin => { holds.add(pin); }, gpio_hold_dis: pin => { holds.delete(pin); },
    gpio_deep_sleep_hold_en: () => { deepSleepHeld = true; },
    gpio_deep_sleep_hold_dis: () => { deepSleepHeld = false; }
  });
  vm.runInContext(code, context);
  return { pins, modes, holds, api: context.api,
    setTime: value => { now = value >>> 0; },
    at: value => { now = value >>> 0; context.api.updateBatteryStatus(); },
    status: () => { const config = {}; context.api.writeBatteryStatus(config); return config; },
    deepSleepHeld: () => deepSleepHeld
  };
}

for (const [percent, blue, red] of [[0, 0, 1], [20, 0, 1], [21, 1, 0], [100, 1, 0]]) {
  test(`powered LED threshold at ${percent}% uses exactly one indicator`, () => {
    const f = battery({ percent }); f.api.beginBatteryStatus();
    assert.deepEqual(f.modes, { 6: 'output', 7: 'output' });
    assert.deepEqual(f.pins, { 6: blue, 7: red });
    const status = f.status();
    assert.equal(status.battery_percent_estimate, percent);
    assert.ok(status.battery_voltage >= 2.5 && status.battery_voltage <= 4.35);
  });
}

test('mock USB charging progresses without waiting and stops at full', () => {
  const f = battery({ percent: 98 }); f.api.beginBatteryStatus();
  f.at(9999); assert.equal(f.status().battery_percent_estimate, 98);
  f.at(10000); assert.equal(f.status().battery_percent_estimate, 99);
  assert.equal(f.status().battery_charging, true);
  assert.equal(f.status().battery_charge_state, 'charging');
  f.at(20000); assert.equal(f.status().battery_percent_estimate, 100);
  assert.equal(f.status().battery_charging, false);
  assert.equal(f.status().battery_charge_state, 'full');
  f.at(10000000); assert.equal(f.status().battery_percent_estimate, 100);
  assert.deepEqual(f.pins, { 6: 1, 7: 0 });
});

test('mock unplugged battery discharges through the LED boundary and stops at zero', () => {
  const f = battery({ percent: 21, usb: false }); f.api.beginBatteryStatus();
  assert.equal(f.status().battery_charge_state, 'discharging');
  f.at(10000); assert.equal(f.status().battery_percent_estimate, 20);
  assert.deepEqual(f.pins, { 6: 0, 7: 1 });
  assert.equal(f.status().battery_charging, false);
  f.at(10000000); assert.equal(f.status().battery_percent_estimate, 0);
  assert.deepEqual(f.pins, { 6: 0, 7: 1 });
});

test('a full pack without virtual USB reports discharging rather than charging or full', () => {
  const f = battery({ percent: 100, usb: false }); f.api.beginBatteryStatus();
  assert.equal(f.status().battery_charging, false);
  assert.equal(f.status().battery_charge_state, 'discharging');
  f.at(10000); assert.equal(f.status().battery_percent_estimate, 99);
});

test('a delayed loop accounts for elapsed steps and preserves the remaining fraction', () => {
  const f = battery({ percent: 80 }); f.api.beginBatteryStatus();
  f.at(35000); assert.equal(f.status().battery_percent_estimate, 83);
  f.at(39999); assert.equal(f.status().battery_percent_estimate, 83);
  f.at(40000); assert.equal(f.status().battery_percent_estimate, 84);
});

test('millis rollover continues progression without a jump', () => {
  const f = battery({ percent: 20 });
  f.setTime(0xfffff000); f.api.beginBatteryStatus();
  f.at(0x0000170f); assert.equal(f.status().battery_percent_estimate, 20);
  f.at(0x00001710); assert.equal(f.status().battery_percent_estimate, 21);
  assert.deepEqual(f.pins, { 6: 1, 7: 0 });
});

test('heartbeat publishes explicit mock metadata and historical battery stays volts', () => {
  const f = battery({ percent: 80 }); f.api.beginBatteryStatus();
  const status = f.status();
  assert.deepEqual(status, {
    battery_voltage: 3.96, battery_percent_estimate: 80, battery_charging: true,
    battery_charge_state: 'charging', battery_source: 'mock', battery_capacity_mah: 5200
  });
  assert.equal(f.api.batteryVoltage(), 3.96);
  assert.ok(f.api.batteryVoltage() < 5, 'The telemetry battery field cannot receive percentage');
});

test('sleep holds both LED levels and wake releases them before updating outputs', () => {
  const f = battery({ percent: 20 }); f.api.beginBatteryStatus();
  f.api.holdBatteryLeds();
  assert.deepEqual([...f.holds].sort(), [6, 7]); assert.equal(f.deepSleepHeld(), true);
  f.api.beginBatteryStatus();
  assert.equal(f.holds.size, 0); assert.equal(f.deepSleepHeld(), false);
  assert.deepEqual(f.pins, { 6: 0, 7: 1 });
});

test('the actual measurement capture places mock volts alongside original observation and RPM', () => {
  const source = fs.readFileSync(sketchPath, 'utf8');
  const body = source.match(/void captureTelemetryReading\(\) \{\r?\n([\s\S]*?)^\}/m);
  assert.ok(body);
  const f = battery(); f.api.beginBatteryStatus();
  const captured = [];
  const context = vm.createContext({
    millis: () => 20000, lastReportMs: 0, intervalMs: 5000,
    registryId: 'node-fixture', projectUrl: 'https://example.invalid',
    deviceId: 'esp32s3-fixture', bootCount: 1, reportSequence: 7,
    clockReady: () => true, updateRotationMeasurement() {},
    batteryVoltage: f.api.batteryVoltage, time: () => 1793664000,
    isoUtc: () => '2026-11-03T00:00:00Z',
    WL_CONNECTED: 3, WiFi: { status: () => 3, RSSI: () => -61 },
    measuredRotationRpm: 120.5, isfinite: Number.isFinite,
    telemetryOutbox: { append: reading => { captured.push(structuredClone(reading)); return true; } },
    lastMeasurementAt: '', telemetryUploadError: '', missedMeasurements: 0
  });
  const code = body[1].replace(/JsonDocument reading;/, 'const reading = {};')
    .replace(/\.isEmpty\(\)/g, '.length === 0')
    .replace(/\.as<String>\(\)/g, '').replace(/\bnullptr\b/g, 'null');
  vm.runInContext(`function captureTelemetryReading() {${code}}; captureTelemetryReading();`, context);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].battery, 3.96);
  assert.equal(captured[0].rotation_rpm, 120.5);
  assert.equal(captured[0].observed_at, '2026-11-03T00:00:00Z');
  assert.equal(captured[0].report_id, 'esp32s3-fixture-1-7');
  assert.equal(captured[0].interval_seconds, 5);
  assert.equal(captured[0].outlet_temperature_c, null);
  assert.equal(Object.hasOwn(captured[0], 'ac_on'), false);
  assert.equal(context.reportSequence, 8);
});

test('the actual heartbeat exchange sends battery metadata through the existing authenticated RPC', () => {
  const source = fs.readFileSync(sketchPath, 'utf8');
  const body = source.match(/bool exchange\(const String &sleepingUntil = ""\) \{\r?\n([\s\S]*?)^\}/m);
  assert.ok(body);
  const f = battery(); f.api.beginBatteryStatus();
  const requests = [];
  const context = vm.createContext({
    WL_CONNECTED: 3, WiFi: { status: () => 3, SSID: () => 'Fixture', RSSI: () => -61, localIP: () => ({ toString: () => '192.0.2.1' }) },
    clockReady: () => true, validToken: () => true,
    deviceId: 'esp32s3-fixture', deviceToken: 'test-only-token', projectUrl: 'https://example.invalid',
    VERSION: 'fixture-version', IR_TX_ENABLED: true, intervalMs: 5000, wakeTime: '', sleepTime: '',
    telemetryOutbox: { pending: () => 2, error: '' }, TelemetryOutbox: { CAPACITY: 1024 },
    telemetryUploadError: '', lastMeasurementAt: '2026-11-03T00:00:00Z', missedMeasurements: 0,
    writeBatteryStatus: f.api.writeBatteryStatus, captureDirty: false, immediateObservationSupport: 1,
    latestCapture: '', pendingAck: '', cloudStatus: '', lastError: '', registryId: '', saveCloudAfterVerify: false,
    applyConfig() {}, postCloudRpc: (rpc, request, response) => {
      requests.push({ rpc, request: structuredClone(request) });
      Object.assign(response, { success: true, node_id: 'node-fixture', config: {}, command: null });
      return 200;
    }
  });
  const code = body[1]
    .replace('JsonDocument request;', 'const request = {};')
    .replace('JsonObject status = request["p_status"].to<JsonObject>();', 'const status = request["p_status"] = { capabilities: {}, applied_config: {} };')
    .replace('JsonDocument capture, ack;', 'const capture = {}, ack = {};')
    .replace('JsonDocument response;', 'const response = {};')
    .replace('int code =', 'const code =')
    .replace('TelemetryOutbox::CAPACITY', 'TelemetryOutbox.CAPACITY')
    .replace(/\.isEmpty\(\)/g, '.length === 0').replace(/\.length\(\)/g, '.length')
    .replace(/\.as<(?:JsonObject|JsonVariantConst|String)>\(\)/g, '')
    .replace(/response\["command"\]\.isNull\(\)/g, '(response["command"] == null)')
    .replace('response["node_id"] | ""', 'response["node_id"] || ""');
  assert.equal(vm.runInContext(`function exchange(sleepingUntil = '') {${code}}; exchange();`, context), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].rpc, 'ecotrack_device_exchange');
  assert.equal(requests[0].request.p_device_id, 'esp32s3-fixture');
  assert.equal(requests[0].request.p_token, 'test-only-token');
  const status = requests[0].request.p_status.applied_config;
  for (const [key, value] of Object.entries(f.status())) assert.equal(status[key], value);
  assert.equal(status.telemetry_pending, 2);
  assert.equal(status.last_measurement_at, '2026-11-03T00:00:00Z');
  assert.equal(context.registryId, 'node-fixture');
});
