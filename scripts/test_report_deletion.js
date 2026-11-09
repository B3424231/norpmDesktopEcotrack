// Exercise actual deletion handlers with mocked clients; no live database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function section(file, start, end) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const offset = source.indexOf(start);
  assert(offset >= 0);
  return source.slice(offset, source.indexOf(end, offset + start.length));
}
function database({ rpc = { data: [], error: { message: 'RPC unavailable' } }, direct = { data: [{ id: 'MR-1' }], error: null }, throwRpc = false } = {}) {
  const calls = [];
  return { calls,
    async rpc(name, payload) { calls.push({ operation: 'rpc', name, ids: payload.report_ids }); if (throwRpc) throw new Error('IPC transport failure'); return rpc; },
    from(table) { const query = {
      delete() { return query; },
      in(field, ids) { calls.push({ operation: 'delete', table, field, ids }); return query; },
      select() { return Promise.resolve(direct); }
    }; return query; }
  };
}
function mainHandler(client) {
  let handler;
  const context = vm.createContext({ getSupabaseAdmin: () => client, registerDatabaseHandler: (_, callback) => { handler = callback; } });
  vm.runInContext(section('src/main.js', 'function normalizeMaintenanceReportIds(', "registerDatabaseHandler('maintenance-save-report'"), context);
  return ids => handler({}, ids);
}

async function testMainHandler() {
  for (const input of [' MR-1 ', [' MR-1 ', null, undefined, '', ['MR-1'], {}], { ids: [' MR-1 '] }, { report_ids: 'MR-1' }, { id: 'MR-1' }]) {
    const client = database({rpc:{data:[{id:'MR-1'}],error:null}});
    const result = await mainHandler(client)(input);
    assert.equal(result.success, true);
    assert.equal(JSON.stringify(client.calls[0].ids), '["MR-1"]');
    assert.equal(client.calls.length, 1, 'Only the authorized RPC executes');
  }
  const absent = await mainHandler(null)(['MR-1']);
  assert.equal(absent.error, 'Database service unavailable');
  for (const input of [null, [], {}, [null, undefined, false, {}, ' ']]) {
    const client = database();
    assert.equal((await mainHandler(client)(input)).error, 'Invalid report IDs');
    assert.equal(client.calls.length, 0);
  }
  const rpcSuccess = database({ rpc: { data: [{ id: 'MR-1' }], error: null } });
  assert.equal((await mainHandler(rpcSuccess)('MR-1')).success, true);
  assert.equal(rpcSuccess.calls.length, 1, 'Confirmed RPC deletion does not run the fallback');
  assert.equal((await mainHandler(database({ throwRpc: true }))('MR-1')).success, false);
  const empty = database({ rpc: { data: [], error: null }, direct: { data: [], error: null } });
  assert.equal((await mainHandler(empty)('MR-1')).success, false, 'Never fabricate deleted records for zero-row responses');
  const denied = database({ rpc: { data: null, error: { message: 'Permission denied' } } });
  assert.equal((await mainHandler(denied)('MR-1')).error, 'Permission denied');
}

function renderer(client, ipc) {
  const reports = [{ id: 'MR-1' }, { id: 'child', parent_report_id: 'MR-1' }, { id: 'other', linked_repair_id: 'MR-1' }];
  const notices = [];
  const context = vm.createContext({ _reportsCache: reports, getReports: () => context._reportsCache, getSb: () => client,
    window: { electron: ipc ? { invoke: ipc } : null, dispatchEvent() {} },
    reportWriteRevision: 0, reportVersions: new Map(), confirmedReportWrites: new Map(),
    normalizeReport: report => report, syncReportsWithLinkedRepairs: rows => rows, deduplicateReports: rows => rows,
    localStorage: { setItem() {} }, Event: class {}, CustomEvent: class {}, console,
    refreshPageReportsView() {}, broadcastMaintenanceChange() {}, showToast: (...args) => notices.push(args)
  });
  vm.runInContext(section('public/js/maintenance-modal.js', '  function mergeReportsSafely(', '  let _isRefreshingReportsView') +
    section('public/js/maintenance-modal.js', '  async function deleteReports(', '  // Delete Single Report'), context);
  return { context, notices };
}

async function testRendererFallbacks() {
  for (const ipc of [null, async () => ({ success: false, error: 'IPC unavailable' }), async () => { throw new Error('IPC rejected'); }]) {
    const client = database({ rpc: { data: [{ id: 'MR-1' }, { id: 'child' }], error: null } });
    const { context } = renderer(client, ipc);
    assert.equal(await context.deleteReports({ ids: [[' MR-1 '], null, undefined, 'MR-1'] }), true);
    assert.equal(JSON.stringify(client.calls[0].ids), '["child","MR-1"]', 'Retain dependent-report deletion');
    assert.equal(context._reportsCache.length, 1);
    assert.equal(context._reportsCache[0].id, 'other');
    assert.equal(context._reportsCache[0].linked_repair_id, null);
    const stale = context.mergeReportsSafely([{ id: 'MR-1' }, { id: 'child' }, { id: 'other' }], [], 0);
    assert.equal(JSON.stringify(stale.map(row => row.id)), '["other"]', 'An in-flight read must not restore deleted reports');
  }
  const empty = database({ direct: { data: [], error: null } });
  const failed = renderer(empty);
  assert.equal(await failed.context.deleteReports('MR-1'), false);
  assert.equal(failed.context._reportsCache.length, 3, 'Failed deletion preserves local reports');
  assert.equal(failed.notices.at(-1)[0], 'Deletion Failed');
  assert.equal(await failed.context.deleteReports([null, undefined, ' ']), false);
  const ipcEmpty = renderer(empty, async () => ({ success: false, error: 'No maintenance reports were deleted. Refresh and check the selected reports.' }));
  assert.equal(await ipcEmpty.context.deleteReports('MR-1'), false, 'An empty IPC result must not remove a real report locally');
  assert.equal(ipcEmpty.context._reportsCache.length, 3);
  const partial = renderer(database({ rpc: { data: [{ id: 'child' }], error: null } }));
  assert.equal(await partial.context.deleteReports('MR-1'), false);
  assert.equal(partial.context._reportsCache.length, 2, 'Remove only rows actually confirmed by the database');
}

async function testModalSelection() {
  let result = [], received, rendered = 0;
  const selected = new Set(['MR-1', 2]);
  const context = vm.createContext({
    selectedReportIds: selected, isReportSelectMode: true,
    renderPageReports: () => { rendered++; },
    window: { EcoTrackMaintenance: { promptDeleteReports: async (ids, { bulk }) => {
      received = { ids, bulk }; return result;
    } } }
  });
  vm.runInContext(section('public/staff.html', '      async function deleteReportPrompt(', '      // Bulk action listeners'), context);
  await context.deleteReportPrompt('MR-1');
  assert.equal(JSON.stringify(received), '{"ids":["MR-1"],"bulk":false}');
  assert.equal(selected.size, 2, 'Keep selection if the user cancels without deleting any reports');
  assert.equal(rendered, 0);
  result = ['MR-1'];
  await context.deleteSelectedReportsPrompt();
  assert.equal(JSON.stringify(received), '{"ids":["MR-1",2],"bulk":true}');
  assert.deepEqual([...selected], [2], 'Only clear selection for confirmed deletions');
  assert.equal(context.isReportSelectMode, true);
  result = ['2'];
  await context.deleteSelectedReportsPrompt();
  assert.equal(selected.size, 0);
  assert.equal(context.isReportSelectMode, false);
  assert.equal(rendered, 2);
}

async function main() {
  await testMainHandler(); await testRendererFallbacks(); await testModalSelection();
  console.log('Report deletion passed: ID formats, unavailable database, authorized RPC, zero-row failures, dependent reports, confirmed cache removal, and modal selection.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
