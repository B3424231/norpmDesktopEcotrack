const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function load(rpc) {
  const window = { supabaseClient: { rpc } };
  vm.runInNewContext(fs.readFileSync('public/js/ac-command-schedules.js', 'utf8'), {window, URLSearchParams, console, setTimeout, clearTimeout, AbortController});
  return window.EcoTrackCommandSchedules;
}
test('summarizes weekdays and complete action', () => {
 const api=load();
 assert.equal(api.summarize({weekdays:[1,2,3,4,5],local_time:'08:00',action:'turn_on',intent:{state:{temp:24,fan:'auto'}}}), 'Mon-Fri at 8:00 AM - On - 24 C - Auto fan');
});
test('RPC methods preserve exact binding and expected version', async () => {
 const calls=[]; const api=load(async(name,args)=>{calls.push({name,args});return {data:{ok:true}}});
 await api.setAutomation({node_id:'node-1',aircon_id:'ac-1'},false,3);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{name:'ecotrack_set_ac_automation',args:{p_node_id:'node-1',p_aircon_id:'ac-1',p_enabled:false,p_expected_version:3}});
});
test('missing setup fails explicitly', async () => {
 const api=load(async()=>({error:{code:'PGRST202'}}));
 await assert.rejects(api.list(),/setup/i);
});
