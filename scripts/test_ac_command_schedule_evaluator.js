const {test} = require('node:test');
const assert = require('node:assert/strict');
const {openScheduleDb} = require('./helpers/ac-command-schedule-db');
const at = '2026-11-02T00:00:40Z';
const tick = (f, time = at, limit = 100) => f.call('ecotrack_private.dispatch_due_ac_command_schedules', [time, limit]);
test('real queue: one occurrence, complete payload, stable notification and no invented measurements', async () => {
 const f = await openScheduleDb();
 try {
  await f.seedSchedule();
  assert.equal((await tick(f)).queued, 1);
  assert.equal((await tick(f)).queued, 0);
  const [q] = await f.rows('SELECT * FROM ecotrack_device_commands');
  assert.equal(q.kind,'ac_intent'); assert.equal(q.payload.state.temp,24);
  assert.equal(new Date(q.expires_at).toISOString(),'2026-11-02T00:02:00.000Z');
  assert.equal((await f.rows('SELECT * FROM ac_command_schedule_runs')).length,1);
  const [notice] = await f.rows('SELECT * FROM notifications');
  assert.equal(notice.type,'ac_command_schedule'); assert.equal(notice.schedule_event.status,'queued');
  await f.rows('UPDATE notifications SET is_read=true,dismissed=true');
  await f.rows("UPDATE ecotrack_device_commands SET status='completed',acknowledged_at=$1,result=$2 WHERE id=$3",[at,{success:true,command_id:q.id,aircon_id:'ac-1',protocol:'TCL112AC',delivery_status:'transmitted',state:q.payload.state},q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  const [sent] = await f.rows('SELECT * FROM notifications');
  assert.equal(sent.id,notice.id);assert.equal(sent.schedule_event.status,'sent');assert.equal(sent.is_read,true);assert.equal(sent.dismissed,true);
  assert.equal((await f.rows('SELECT * FROM telemetry')).length,0);
  assert.equal((await f.rows('SELECT reported_state FROM aircons'))[0].reported_state,null);
 } finally { await f.dispose(); }
});

test('late On/newer Off: only latest eligible preset queues; outage and duplicate ticks never replay', async () => {
 const f=await openScheduleDb();try {
  await f.seedSchedule();
  await f.seedSchedule({name:'Off',local_time:'08:01',next_run_at:'2026-11-02T00:01:00Z',action:'turn_off',intent:{...f.draft().intent,state:{...f.draft().intent.state,power:'off'}}});
  assert.deepEqual(await tick(f,'2026-11-02T00:01:30Z'),{queued:1,missed:0,skipped:0,superseded:1,failed:0});
  assert.equal((await f.rows('SELECT payload FROM ecotrack_device_commands'))[0].payload.state.power,'off');
  await tick(f,'2026-11-02T00:03:30Z');
  assert.equal((await f.rows("SELECT count(*)::int AS n FROM ac_command_schedule_runs WHERE status='missed'"))[0].n,1);
  assert.equal((await f.rows('SELECT * FROM ecotrack_device_commands'))[0].status,'expired');
  const next=(await f.rows('SELECT next_run_at FROM ac_command_schedules')).map(x=>new Date(x.next_run_at).toISOString());
  assert.ok(next.every(x=>x.startsWith('2026-11-03')));
 } finally {await f.dispose();}
});

test('missed outage occurrences are bounded, recorded, and never enqueued', async () => {
 const f=await openScheduleDb();try {
  await f.seedSchedule({next_run_at:'2026-10-28T00:00:00Z'});
  assert.equal((await tick(f,'2026-11-02T00:03:00Z',2)).missed,2);
  assert.equal((await tick(f,'2026-11-02T00:03:00Z',10)).missed,2);
  assert.equal((await f.rows('SELECT * FROM ecotrack_device_commands')).length,0);
  assert.equal((await f.rows('SELECT * FROM ac_command_schedule_runs')).length,4);
  assert.equal(new Date((await f.rows('SELECT next_run_at FROM ac_command_schedules'))[0].next_run_at).toISOString(),'2026-11-03T00:00:00.000Z');
 } finally {await f.dispose();}
});

test('invalid device is paused without blocking a valid other device', async () => {
 const f=await openScheduleDb();try {
  await f.seedSchedule(); const binding=await f.seedDevice('2');
  await f.seedSchedule({...binding,intent:{...f.draft().intent,aircon_id:binding.aircon_id}});
  await f.rows("UPDATE aircons SET capability_profile='{\"revision\":1}' WHERE id='ac-1'");
  const r=await tick(f); assert.equal(r.failed,1);assert.equal(r.queued,1);
  assert.equal((await f.rows("SELECT enabled FROM ac_command_schedules WHERE node_id='node-1'"))[0].enabled,false);
  assert.match((await f.rows("SELECT reason FROM ac_command_schedule_runs WHERE node_id='node-1'"))[0].reason,/Capabilities changed/);
 } finally {await f.dispose();}
});

test('current binding, role and unknown awake hours are revalidated at execution', async () => {
 const f=await openScheduleDb();try {
  const changes=[
   ["UPDATE administrators SET is_active=false",'active administrator',"UPDATE administrators SET is_active=true"],
   ["UPDATE ecotrack_device_state SET device_id='replacement'",'binding changed',"UPDATE ecotrack_device_state SET device_id='esp32s3-000000000001'"],
   ["UPDATE nodes SET wake_time=NULL",'awake hours',"UPDATE nodes SET wake_time='00:00'"],
   ["UPDATE nodes SET wake_time='08:00',sleep_time='18:00'",'awake window',"UPDATE nodes SET wake_time='00:00',sleep_time='00:00'"],
   ["UPDATE aircons SET controller_node_id='other',node_id='other'",'binding changed',"UPDATE aircons SET controller_node_id='node-1',node_id='node-1'"]
  ];
  for(const [bad,reason,restore] of changes) {
   const s=await f.seedSchedule();await f.db.exec(bad);assert.equal((await tick(f)).failed,1);
   assert.match((await f.rows('SELECT reason FROM ac_command_schedule_runs WHERE schedule_id=$1',[s.id]))[0].reason,new RegExp(reason));
   await f.db.exec(restore);
  }
  assert.equal((await f.rows('SELECT * FROM ecotrack_device_commands')).length,0);
 } finally {await f.dispose();}
});

test('change settings requires fresh explicit reported power, never desired state or connectivity',async()=>{
 const f=await openScheduleDb();try {
  await f.rows("UPDATE aircons SET desired_state='{\"power\":\"on\"}'");
  await f.seedSchedule({action:'change_settings'});assert.equal((await tick(f)).skipped,1);
  await f.rows("UPDATE aircons SET reported_state='{\"power\":\"on\"}',reported_at='2026-11-01T23:58:00Z'");
  await f.seedSchedule({action:'change_settings'});assert.equal((await tick(f)).skipped,1);
  await f.rows("UPDATE aircons SET reported_at='2026-11-02T00:00:00Z'");
  await f.seedSchedule({action:'change_settings'});assert.equal((await tick(f)).queued,1);
 } finally {await f.dispose();}
});

test('sleep announcement skips; disabled and master paused schedules create no commands',async()=>{
 const f=await openScheduleDb();try {
  await f.seedSchedule({enabled:false});assert.equal((await tick(f)).queued,0);
  await f.seedSchedule();await f.rows("UPDATE ac_command_automation SET enabled=false");assert.equal((await tick(f)).queued,0);
  assert.equal((await f.rows('SELECT * FROM ac_command_schedule_runs')).length,0);
  await f.rows("UPDATE ac_command_automation SET enabled=true");
  await f.seedSchedule();await f.rows("UPDATE ecotrack_device_state SET sleeping_until='2026-11-02T00:05:00Z'");assert.equal((await tick(f)).skipped,1);
 } finally {await f.dispose();}
});

test('claimed expiry is unconfirmed, wrong receipt is never Sent, and Sent is terminal',async()=>{
 const f=await openScheduleDb();try {
  await f.seedSchedule();await tick(f);
  const [c]=await f.rows('SELECT * FROM ecotrack_device_commands');
  await f.rows("UPDATE ecotrack_device_commands SET status='claimed',claimed_at=$1",[at]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',['2026-11-02T00:03:00Z']);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'unconfirmed');
  const receipt={success:true,command_id:c.id,aircon_id:'other',protocol:'TCL112AC',delivery_status:'transmitted',state:c.payload.state};
  await f.rows("UPDATE ecotrack_device_commands SET status='completed',acknowledged_at=$1,result=$2",[at,receipt]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'unconfirmed');
  await f.rows('UPDATE ecotrack_device_commands SET result=$1',[{...receipt,aircon_id:'ac-1'}]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
  await f.rows("UPDATE ecotrack_device_commands SET status='expired'");
  assert.equal(await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]),0);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
 } finally {await f.dispose();}
});

test('pause/archive/edit cancel only unclaimed work; claimed receipt can still become Sent',async()=>{
 const f=await openScheduleDb();try {
  const s=await f.seedSchedule();await tick(f);
  await f.rpc('ecotrack_archive_ac_command_schedule',{p_schedule_id:s.id,p_expected_version:1});
  assert.equal((await f.rows('SELECT status FROM ecotrack_device_commands'))[0].status,'superseded');
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'superseded');
  const s2=await f.seedSchedule();await tick(f);
  const [c]=await f.rows("SELECT * FROM ecotrack_device_commands WHERE status='queued'");
  await f.rows("UPDATE ecotrack_device_commands SET status='claimed',claimed_at=$1 WHERE id=$2",[at,c.id]);
  await f.rpc('ecotrack_set_ac_automation',{p_node_id:'node-1',p_aircon_id:'ac-1',p_enabled:false,p_expected_version:1});
  assert.equal((await f.rows('SELECT status FROM ecotrack_device_commands WHERE id=$1',[c.id]))[0].status,'claimed');
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs WHERE schedule_id=$1',[s2.id]))[0].status,'unconfirmed');
  await f.rows("UPDATE ecotrack_device_commands SET status='completed',acknowledged_at=$1,result=$2 WHERE id=$3",[at,{success:true,command_id:c.id,aircon_id:'ac-1',protocol:'TCL112AC',delivery_status:'transmitted',state:c.payload.state},c.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs WHERE schedule_id=$1',[s2.id]))[0].status,'sent');
 } finally {await f.dispose();}
});

test('private workers deny app roles and health stays unavailable without active Cron',async()=>{
 const f=await openScheduleDb();try {
  await tick(f);
  const h=await f.call('ecotrack_ac_command_scheduler_status');assert.equal(h.available,false);assert.equal(h.cron_active,false);
  for(const role of ['anon','authenticated']) {
   await f.db.exec(`SET ROLE ${role}`);
   await assert.rejects(()=>tick(f),/permission denied/);
   await assert.rejects(()=>f.rows('SELECT * FROM ecotrack_private.ac_command_scheduler_health'),/permission denied/);
   await f.db.exec('RESET ROLE');
  }
  await f.rows("UPDATE administrators SET is_active=false");
  await assert.rejects(()=>f.call('ecotrack_ac_command_scheduler_status'),/Active administrator/);
 } finally {await f.dispose();}
});

test('weekday recurrence handles Sunday midnight and Singapore overnight windows',async()=>{
 const f=await openScheduleDb();try {
  const next=await f.call('ecotrack_private.ac_schedule_next',[[7],'00:00','2026-11-07T15:59:00Z']);
  assert.equal(new Date(next).toISOString(),'2026-11-07T16:00:00.000Z');
  await f.rows("UPDATE nodes SET wake_time='22:00',sleep_time='06:00'");
  await f.seedSchedule({local_time:'01:00',next_run_at:'2026-11-01T17:00:00Z'});
  assert.equal((await tick(f,'2026-11-01T17:00:30Z')).queued,1);
 } finally {await f.dispose();}
});

test('each trigger is visible to unread badge and the inbox immediately',async()=>{
 const f=await openScheduleDb();try {
  await f.seedSchedule();await tick(f);
  const [notice]=await f.rows('SELECT * FROM notifications');
  assert.equal(notice.triggered,true);
 }finally{await f.dispose();}
});

test('carried Turbo is rejected, and a newer verified manual Off clears that state safely',async()=>{
 const f=await openScheduleDb();try{
  await f.rows("UPDATE ecotrack_device_state SET latest_ir=jsonb_set(latest_ir,'{state,turbo}','\"on\"') || '{\"received_at\":\"2026-11-01T23:50:00Z\"}'::jsonb");
  await f.seedSchedule();assert.equal((await tick(f)).failed,1);
  assert.equal((await f.rows('SELECT * FROM ecotrack_device_commands')).length,0);
  await f.rows("UPDATE ecotrack_device_state SET latest_ir=latest_ir #- '{state,turbo}'");
  await f.seedSchedule();assert.equal((await tick(f)).failed,1);
  const state={...f.draft().intent.state,turbo:'off'};
  await f.rows("INSERT INTO ecotrack_device_commands(id,node_id,kind,payload,status,created_by,created_at,expires_at,acknowledged_at,result) VALUES('22222222-2222-4222-8222-222222222222','node-1','ac_intent',$1,'completed',$2,'2026-11-01T23:55:00Z','2026-11-01T23:57:00Z','2026-11-01T23:55:10Z',$3)",[{...f.draft().intent,state},f.actor,{success:true,command_id:'22222222-2222-4222-8222-222222222222',aircon_id:'ac-1',protocol:'TCL112AC',delivery_status:'transmitted',state}]);
  await f.seedSchedule();assert.equal((await tick(f)).queued,1);
 }finally{await f.dispose();}
});

test('revoked mapped administrators cannot list, pause or archive schedule data',async()=>{
 const f=await openScheduleDb();try{
  const s=await f.seedSchedule();await f.rows("UPDATE administrators SET is_active=false");
  await assert.rejects(()=>f.rpc('ecotrack_list_ac_command_schedules',{p_node_id:null}),/Active administrator/);
  await assert.rejects(()=>f.rpc('ecotrack_set_ac_automation',{p_node_id:'node-1',p_aircon_id:'ac-1',p_enabled:false,p_expected_version:1}),/Active administrator/);
  await assert.rejects(()=>f.rpc('ecotrack_archive_ac_command_schedule',{p_schedule_id:s.id,p_expected_version:1}),/Active administrator/);
 }finally{await f.dispose();}
});

test('receipt identity includes controller, command kind and the actual transmitted state',async()=>{
 const f=await openScheduleDb();try{
  await f.seedSchedule();await tick(f);await f.seedDevice('2');
  const [q]=await f.rows('SELECT * FROM ecotrack_device_commands');
  const receipt={success:true,command_id:q.id,aircon_id:'ac-1',protocol:'TCL112AC',delivery_status:'transmitted',state:q.payload.state};
  await f.rows("UPDATE ecotrack_device_commands SET status='completed',claimed_at=$1,acknowledged_at=$1,result=$2,node_id='node-2' WHERE id=$3",[at,receipt,q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.notEqual((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
  await f.rows("UPDATE ecotrack_device_commands SET node_id='node-1',kind='ping' WHERE id=$1",[q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.notEqual((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
  await f.rows("UPDATE ecotrack_device_commands SET kind='ac_intent',result=$1 WHERE id=$2",[{...receipt,state:{...receipt.state,temp:30}},q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.notEqual((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
  await f.rows("UPDATE ecotrack_device_commands SET payload=$1,result=$2 WHERE id=$3",[{...q.payload,state:{...q.payload.state,temp:30}},{...receipt,state:{...receipt.state,temp:30}},q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.notEqual((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
  await f.rows("UPDATE ecotrack_device_commands SET payload=$1 WHERE id=$2",[q.payload,q.id]);
  await f.rows("UPDATE ecotrack_device_commands SET result=$1 WHERE id=$2",[receipt,q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',[at]);
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'sent');
 }finally{await f.dispose();}
});




test('Cron registration uses the managed API, commits inactive, and reports recent active health',async()=>{
 const f=await openScheduleDb({cron:true});try{
  const [job]=await f.rows("SELECT * FROM cron.job WHERE jobname='ecotrack-ac-command-schedules'");
  assert.ok(job);assert.equal(job.active,false);assert.equal(job.schedule,'* * * * *');
  await f.db.exec(job.command);
  assert.equal((await f.call('ecotrack_ac_command_scheduler_status')).available,false);
  await assert.rejects(()=>f.rows('UPDATE cron.job SET active=true WHERE jobid=$1',[job.jobid]),/permission denied for table job/);
  await f.rows('SELECT cron.alter_job(job_id := $1,active := true)',[job.jobid]);
  assert.equal((await f.call('ecotrack_ac_command_scheduler_status')).available,true);
  await f.rows("UPDATE ecotrack_private.ac_command_scheduler_health SET last_tick_at=clock_timestamp()-interval '121 seconds'");
  assert.equal((await f.call('ecotrack_ac_command_scheduler_status')).available,false);
 }finally{await f.dispose();}
});


test('known missed or cancelled schedules settle only their own current AC command summary',async()=>{
 const f=await openScheduleDb();try{
  await f.seedSchedule();await tick(f);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',['2026-11-02T00:03:00Z']);
  assert.equal((await f.rows('SELECT command_status FROM aircons'))[0].command_status,'failed');
  await f.seedSchedule();await tick(f);
  const manual=await f.call('ecotrack_cloud_request',['node-1','ac_intent',f.draft().intent,'33333333-3333-4333-8333-333333333333']);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',['2026-11-02T00:03:00Z']);
  const [current]=await f.rows('SELECT command_id,command_status,reported_state FROM aircons');
  assert.equal(current.command_id,manual.id);assert.equal(current.command_status,'queued');assert.equal(current.reported_state,null);
 }finally{await f.dispose();}
});

