'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(storage = new Map(), browser = false, readDelayMs = 0) {
  let rows = [];
  let systemSuccess = true;
  const sent = [], events = [];
  const context = {
    console, Date, Set, Map, Promise,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    sessionStorage: { getItem() {}, setItem() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    setInterval() {}, setTimeout() {}, addEventListener() {},
    dispatchEvent: event => events.push(event.type),
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { pathname: '/dashboard.html' },
  };
  if (browser) {
    context.Notification = class {
      static permission = 'default';
      static async requestPermission() { this.permission = 'granted'; return 'granted'; }
      constructor(title, options) { sent.push({ title, ...options }); }
    };
  } else context.electron = { invoke: async (channel, payload) => {
    if (channel === 'notifications-fetch-all') {
      if (readDelayMs) await new Promise(resolve => setTimeout(resolve, readDelayMs));
      return { success: true, data: rows };
    }
    if (channel === 'system-notification-show') { sent.push(payload); return { success: systemSuccess }; }
    return { success: false };
  }, on() {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/global-notifications.js'), 'utf8'), context);
  return { context, sent, events, storage, rows: value => { rows = value; }, systemSuccess: value => { systemSuccess = value; }, settle: () => new Promise(resolve => setImmediate(resolve)) };
}
const installation = { id: 'install-one', type: 'controller_installation', triggered: true, content: 'AC device 04A7AC|||Installed in Room 1.', room_id: 'room-one' };

test('global desktop alerts follow new saved inbox rows once across polling and page navigation', async () => {
  const h = harness();
  await h.context.updateGlobalNotificationBadge();
  h.rows([installation]);
  await h.context.updateGlobalNotificationBadge(); await h.settle();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].body, 'Installed in Room 1.');
  assert.equal(h.sent[0].context.id, 'install-one');
  assert.match(h.sent[0].title, /Installation/);
  await h.context.updateGlobalNotificationBadge();
  const nextPage = harness(h.storage); nextPage.rows([installation]);
  await nextPage.context.updateGlobalNotificationBadge();
  assert.equal(h.sent.length, 1); assert.equal(nextPage.sent.length, 0);
  assert.equal(h.events.includes('notification:triggered'), false, 'installation is not a rule violation');
});

test('initial history, read rows, dismissed rows and disabled notifications do not replay alerts', async () => {
  const h = harness(); h.rows([installation]);
  await h.context.updateGlobalNotificationBadge();
  h.storage.set('ecoTrackNotificationReadState', JSON.stringify({ read: true }));
  h.rows([installation, { ...installation, id: 'read' }, { ...installation, id: 'deleted', is_dismissed_from_inbox: true }, { ...installation, id: 'inactive', triggered: false }]);
  await h.context.updateGlobalNotificationBadge();
  assert.equal(h.sent.length, 0);
  h.storage.set('ecoTrack_notifications_enabled', 'false');
  h.context.triggerGlobalNotification('Muted', { id: 'muted' });
  assert.equal(h.sent.length, 0);
});

test('direct alert and subsequent inbox polling do not duplicate a maintenance system alert', async () => {
  const h = harness(); await h.context.updateGlobalNotificationBadge();
  const report = { id: 'verification', report_id: 'MR-one', type: 'maintenance_verification', triggered: true, content: 'Verification Required: Report MR-one' };
  h.context.triggerGlobalNotification(report.content, report);
  h.rows([report]); await h.context.updateGlobalNotificationBadge(); await h.settle();
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].context.report_id, 'MR-one');
});

test('a browser permission grant displays the triggering alert without waiting for another event', async () => {
  const h = harness(new Map(), true);
  h.context.triggerGlobalNotification('Threshold exceeded', { id: 'rule-one', type: 'rule_violation' });
  await h.settle();
  assert.equal(h.sent.length, 1);
});

test('a failed native alert retries after navigation and stops retrying after confirmed delivery', async () => {
  const h = harness(); h.systemSuccess(false);
  await h.context.updateGlobalNotificationBadge(); h.rows([installation]);
  await h.context.updateGlobalNotificationBadge(); await h.settle();
  assert.equal(h.sent.length, 1);
  const next = harness(h.storage); next.rows([installation]);
  await next.context.updateGlobalNotificationBadge(); await next.settle();
  assert.equal(next.sent.length, 1, 'failed delivery must remain retryable');
  await next.context.updateGlobalNotificationBadge(); await next.settle();
  assert.equal(next.sent.length, 1, 'confirmed delivery must not repeat');
});

test('fast native failures and slower inbox reads cannot create a continuous retry loop', async () => {
  const h = harness(new Map(), false, 2);
  await h.context.updateGlobalNotificationBadge(); h.systemSuccess(false); h.rows([installation]);
  try {
    await h.context.updateGlobalNotificationBadge();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(h.sent.length <= 2, `unexpected retry loop: ${h.sent.length} attempts`);
  } finally {
    h.systemSuccess(true);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
});
