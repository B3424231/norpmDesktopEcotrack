(function (root) {
  'use strict';
  const displayedReadings = new WeakMap();

  function acceptHeartbeat(next, previous, now = Date.now()) {
    const timestamp = value => typeof value?.last_seen === 'string' ? Date.parse(value.last_seen) : NaN;
    const incoming = timestamp(next), cached = timestamp(previous);
    return Number.isFinite(incoming) && incoming <= now + 5000 &&
      (!Number.isFinite(cached) || cached > now + 5000 || incoming >= cached);
  }
  function read(device, now = Date.now()) {
    const hardware = device?.cloud_state || device;
    const config = hardware?.applied_config;
    const candidates = config && Object.prototype.hasOwnProperty.call(config, 'battery_percent_estimate')
      ? [config.battery_percent_estimate]
      : [hardware?.battery_percent, hardware?.capabilities?.battery_percent, device?.battery_percent,
        ['percent', '%'].includes(device?.battery_unit) ? device.battery : null];
    const percent = candidates.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) ?? null;
    const seen = Date.parse(hardware?.last_seen || '');
    const wake = Date.parse(hardware?.sleeping_until || '');
    const live = acceptHeartbeat(hardware, null, now) && now - seen <= 45000 &&
      !(Number.isFinite(wake) && wake > now) && !['offline', 'sleeping'].includes(hardware?.connection_status);
    let state = null;
    if (live && percent !== null) {
      if (config?.battery_charging === true && config.battery_charge_state === 'charging' && percent < 100) state = 'charging';
      if (config?.battery_charging === false && (config.battery_charge_state === 'discharging' || config.battery_charge_state === 'full' && percent === 100)) state = config.battery_charge_state;
    }
    return { percent, reported: percent !== null, live, state, charging: state === 'charging',
      label: { charging: 'Charging', full: 'Fully charged', discharging: 'On battery' }[state] || '' };
  }
  function markup(reading) {
    const text = reading.reported ? Math.round(reading.percent) + '%' : 'Not reported';
    const label = text + (reading.label ? ' · ' + reading.label : '');
    const fill = reading.reported ? `<rect x="3" y="8" width="${16 * reading.percent / 100}" height="8" rx=".5" fill="currentColor" stroke="none"/>` : '';
    const bolt = reading.charging ? '<path data-battery-bolt d="m12 5-4 8h4l-1 6 5-9h-4l1-5Z" fill="currentColor" stroke="var(--eco-surface, #fff)" stroke-width=".7"/>' : '';
    return `<span class="ecotrack-battery" style="display:inline-flex;align-items:center;gap:.4em;flex-wrap:wrap" aria-label="${label}"><svg viewBox="0 0 24 24" width="22" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1" y="6" width="20" height="12" rx="2"/><path d="M23 10v4"/>${fill}${bolt}</svg><span>${label}</span></span>`;
  }
  function stabilizeReading(element, device, reading) {
    const hardware = device?.cloud_state || device;
    const nodeId = hardware?.device_id || device?.db_id || hardware?.node_id || device?.node_id;
    if (!nodeId || !reading.live || !reading.reported) {
      displayedReadings.delete(element);
      return reading;
    }

    const seen = Date.parse(hardware.last_seen);
    const percent = Math.round(reading.percent);
    const previous = displayedReadings.get(element);
    if (previous?.nodeId === nodeId && seen < previous.seen) return previous.reading;

    const current = { ...reading, percent };
    if (previous?.nodeId !== nodeId || seen - previous.seen > 45000 ||
        previous.reading.state !== reading.state || percent === 0 || percent === 100 ||
        Math.abs(percent - previous.reading.percent) > 4) {
      displayedReadings.set(element, { nodeId, seen, reading: current, candidate: percent, matches: 0, crossings: 0 });
      return current;
    }

    // A refresh can render the same heartbeat multiple times. Only a new sample confirms a small change.
    if (seen > previous.seen) {
      previous.seen = seen;
      previous.matches = previous.candidate === percent ? previous.matches + 1 : 1;
      previous.candidate = percent;
      const crossesLowThreshold = (percent <= 20) !== (previous.reading.percent <= 20);
      previous.crossings = crossesLowThreshold ? previous.crossings + 1 : 0;
      if (previous.matches >= 3 || previous.crossings >= 3) {
        previous.reading = current;
        previous.crossings = 0;
      }
    }
    return previous.reading;
  }

  function render(element, device, now, { stabilize = false } = {}) {
    if (!element) return;
    const raw = read(device, now);
    const reading = stabilize ? stabilizeReading(element, device, raw) : raw;
    element.innerHTML = markup(reading);
    element.dataset.reported = String(reading.reported);
    element.title = reading.reported ? (reading.live ? 'Battery reported by this device' : 'Last reported battery percentage') : 'No battery percentage reported by this device';
    return reading;
  }
  root.EcoTrackBattery = { acceptHeartbeat, read, markup, render };
})(typeof window !== 'undefined' ? window : globalThis);
