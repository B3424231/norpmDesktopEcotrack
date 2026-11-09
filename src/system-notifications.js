'use strict';

function registerSystemNotifications({ ipcMain, Notification, isTrustedCaller, focusMainWindow, getWindow, icon, logger = console }) {
  const active = new Set();
  ipcMain.handle('system-notification-show', (_event, payload) => {
    if (!isTrustedCaller(_event)) return { success: false, error: 'Untrusted caller' };
    if (!payload || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 200 ||
        typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > 10000) {
      return { success: false, error: 'Invalid notification' };
    }
    if (!Notification?.isSupported()) return { success: false, error: 'System notifications are unavailable' };
    const context = {};
    for (const field of ['id', 'room_id', 'control_name', 'sensor_name', 'report_id', 'message', 'content']) {
      const value = payload.context?.[field];
      if (typeof value === 'string' && value.length <= 10000) context[field] = value;
    }
    try {
      const notice = new Notification({ title: payload.title, body: payload.body, icon });
      active.add(notice);
      notice.on('click', () => {
        focusMainWindow();
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send('system-notification-clicked', context);
        active.delete(notice);
      });
      // A timed-out Windows toast remains clickable in Action Center.
      notice.on('close', details => { if (details?.reason !== 'timedOut') active.delete(notice); });
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ success: false, error: 'System notification was not confirmed' }), 10000);
        notice.once('show', () => { clearTimeout(timer); resolve({ success: true }); });
        notice.once('failed', (_event, error) => {
          clearTimeout(timer); active.delete(notice); logger.warn('System notification failed:', error);
          resolve({ success: false, error: 'System notification could not be shown' });
        });
        try { notice.show(); }
        catch (error) { clearTimeout(timer); active.delete(notice); logger.warn('System notification failed:', error.message); resolve({ success: false, error: 'System notification could not be shown' }); }
      });
    } catch (error) {
      logger.warn('System notification failed:', error.message);
      return { success: false, error: 'System notification could not be shown' };
    }
  });
}
module.exports = { registerSystemNotifications };
