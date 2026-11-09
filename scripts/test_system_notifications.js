'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerSystemNotifications } = require('../src/system-notifications');

function harness(supported = true, fails = false) {
  const notices = [], sent = [];
  let handler, focused = 0;
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; notices.push(this); }
    show() { this.shown = true; this.emit(fails ? 'failed' : 'show', {}, 'Windows rejected the toast'); }
  }
  registerSystemNotifications({
    ipcMain: { handle: (name, callback) => { assert.equal(name, 'system-notification-show'); handler = callback; } },
    Notification, isTrustedCaller: event => event.trusted,
    focusMainWindow: () => { focused++; },
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }),
    icon: 'app-icon.png', logger: { warn() {} },
  });
  return { show: (payload, trusted = true) => handler({ trusted }, payload), notices, sent, focused: () => focused };
}
test('native desktop toast retains saved context and restores the window on click', async () => {
  const h = harness();
  assert.equal((await h.show({ title: 'Maintenance', body: 'Verify MR-1', context: { id: 'n1', report_id: 'MR-1', url: 'https://untrusted.invalid' } })).success, true);
  assert.equal(h.notices[0].shown, true);
  assert.equal(h.notices[0].options.body, 'Verify MR-1');
  h.notices[0].emit('click');
  assert.equal(h.focused(), 1);
  assert.deepEqual(h.sent, [['system-notification-clicked', { id: 'n1', report_id: 'MR-1' }]]);
});
test('untrusted IPC callers and invalid payloads cannot create system notifications', async () => {
  const h = harness();
  for (const payload of [null, {}, { title: 'Title', body: 12 }, { title: 'x'.repeat(201), body: 'Body' }]) assert.equal((await h.show(payload)).success, false);
  assert.equal((await h.show({ title: 'Title', body: 'Body' }, false)).success, false);
  assert.equal(h.notices.length, 0);
  assert.equal((await harness(false).show({ title: 'Title', body: 'Body' })).success, false);
});
test('an OS notification failure is returned to the renderer as a failed delivery', async () => {
  const h = harness(true, true);
  assert.equal((await h.show({ title: 'Title', body: 'Body' })).success, false);
});
