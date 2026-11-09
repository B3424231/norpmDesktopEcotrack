const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../public/js/schedule-notifications.js');
const record = {id:'n1',type:'ac_command_schedule',event_key:'ac-schedule:r1',room_id:'room1',schedule_event:{id:'r1',schedule_id:'s1',node_id:'n1',room_id:'room1',status:'sent',scheduled_at:'2026-11-02T00:00:00Z',transmitted_at:'2026-11-02T00:01:00Z',device_name:'<img src=x>',intent:{state:{power:'on',mode:'cool',temp:24,fan:'auto',special:{swing:'on'}}}}};
test('retains one occurrence and escapes snapshot details',()=>{const m=api.toMessage(record,{}); assert.equal(m.id,'n1'); assert.match(api.renderDetails(m.schedule_event),/&lt;img/); assert.match(api.renderDetails(m.schedule_event),/AC operation is not confirmed/); assert.match(api.scheduleUrl(record),/view=commands/);});
test('rejects mismatched occurrence links and does not invent transmission',()=>{assert.equal(api.scheduleUrl({...record,event_key:'ac-schedule:other'}),null); const html=api.renderDetails({...record.schedule_event,status:'failed'}); assert.doesNotMatch(html,/Transmitted at/); assert.equal(api.scheduleUrl({...record,schedule_event:{...record.schedule_event,node_id:''}}),null);});
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('problem transition resets read once without rule side effects', () => {
 const map = new Map([['ecoTrackNotificationReadState',JSON.stringify({n1:true})]]); const localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))};
 const events=[]; let compliance=0; const context={console,localStorage,sessionStorage:{setItem(){}},document:{addEventListener(){},getElementById(){return null}},setInterval(){},setTimeout(){},CustomEvent:class{constructor(type){this.type=type}},dispatchEvent:e=>events.push(e.type),addEventListener(){},initRuleComplianceBenchmarking:()=>compliance++,renderComplianceChart:()=>compliance++}; context.window=context; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/global-notifications.js'),'utf8'),context);
 const queued={...record,schedule_event:{...record.schedule_event,status:'queued'}}; context.observeScheduleNotifications([queued],{n1:true});
 const read={n1:true}; context.observeScheduleNotifications([{...queued,schedule_event:{...queued.schedule_event,status:'failed'}}],read);
 assert.equal(read.n1,undefined); assert.equal(compliance,0); assert.equal(events.length,0); const after={n1:true}; context.observeScheduleNotifications([{...queued,schedule_event:{...queued.schedule_event,status:'failed'}}],after); assert.equal(after.n1,true);
 context.triggerGlobalNotification('Rule warning',{type:'rule_violation'}); assert.equal(compliance,2); assert.deepEqual(events,['notification:triggered']);
});
test('flat special flags are labeled, off hides irrelevant fields, and absent receipts remain unconfirmed',()=>{
 const html=api.renderDetails({...record.schedule_event,intent:{state:{power:'on',mode:'cool',temp:24,fan:'auto',swing_vertical:'on',eco:'off'}}},record);
 assert.match(html,/Vertical swing on/); assert.match(html,/Eco off/); assert.match(html,/Action<\/dt><dd[^>]*>Unavailable/);
 const off=api.renderDetails({...record.schedule_event,intent:{state:{power:'off',mode:'cool',temp:24,fan:'auto'}}},record); assert.doesNotMatch(off,/Temperature|Fan speed/);
 const noReceipt=api.toMessage({...record,schedule_event:{...record.schedule_event,transmitted_at:null}},{}); assert.equal(noReceipt.status,'Unconfirmed'); assert.doesNotMatch(api.renderDetails(noReceipt.schedule_event,record),/IR command transmitted/);
});
test('stored action enums use the intended labels',()=>{
 for (const [action,label] of [['turn_on','Turn on'],['turn_off','Turn off'],['change_settings','Change settings']]) {
  const html=api.renderDetails({...record.schedule_event,action},record);
  assert.match(html,new RegExp(`>${label}<`));
 }
});
test('status colors are distinct, trusted, and room navigation uses the saved ID',()=>{
 assert.match(api.statusClass('sent'),/emerald/); assert.match(api.statusClass('queued'),/blue/); assert.match(api.statusClass('missed'),/amber/); assert.match(api.statusClass('failed'),/red/); assert.match(api.statusClass('skipped'),/slate/); assert.doesNotMatch(api.statusClass('<script>'),/script/);
 assert.match(api.scheduleUrl(record),/room=room1/); assert.doesNotMatch(api.scheduleUrl({...record,schedule_event:{...record.schedule_event,room_id:'bad&x'}}),/room=/);
 const html=api.renderDetails({...record.schedule_event,status:'missed'},record); assert.match(html,/amber/);
});
