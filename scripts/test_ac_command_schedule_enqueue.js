const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {openScheduleDb}=require('./helpers/ac-command-schedule-db');
test('actual manual wrapper wins after due, request IDs remain idempotent, unrelated work survives',async()=>{
 const f=await openScheduleDb();try {
  await f.seedSchedule();
  const manual=await f.call('ecotrack_cloud_request',['node-1','ac_intent',f.draft().intent,randomUUID()]);
  await f.rows("UPDATE ecotrack_device_commands SET created_at='2026-11-02T00:00:20Z' WHERE id=$1",[manual.id]);
  const result=await f.call('ecotrack_private.dispatch_due_ac_command_schedules',['2026-11-02T00:00:40Z',100]);
  assert.equal(result.skipped,1);assert.equal(result.queued,0);
  const same=await f.call('ecotrack_cloud_request',['node-1','ac_intent',f.draft().intent,manual.id]);assert.equal(same.id,manual.id);
  await assert.rejects(()=>f.call('ecotrack_cloud_request',['node-1','ac_intent',{...f.draft().intent,state:{...f.draft().intent.state,temp:25}},manual.id]),/conflict/);
  await f.rows("UPDATE ecotrack_device_commands SET created_at='2026-11-01T23:00:00Z'");
  const ping=await f.call('ecotrack_cloud_request',['node-1','ping',{},randomUUID()]);
  const learn=await f.call('ecotrack_cloud_request',['node-1','learn_ir',{},randomUUID()]);
  const config=await f.call('ecotrack_cloud_request',['node-1','configure',{interval_seconds:30,wake_time:'00:00',sleep_time:'00:00'},randomUUID()]);
  await f.seedSchedule();assert.equal((await f.call('ecotrack_private.dispatch_due_ac_command_schedules',['2026-11-02T00:00:40Z',100])).queued,1);
  for(const c of [ping,learn,config]) assert.equal((await f.rows('SELECT status FROM ecotrack_device_commands WHERE id=$1',[c.id]))[0].status,'queued');
  assert.equal((await f.rows('SELECT * FROM telemetry')).length,0);
 } finally {await f.dispose();}
});
test('manual superseding a claimed schedule retains delivery uncertainty',async()=>{
 const f=await openScheduleDb();try {
  await f.seedSchedule();await f.call('ecotrack_private.dispatch_due_ac_command_schedules',['2026-11-02T00:00:40Z',100]);
  const [c]=await f.rows('SELECT * FROM ecotrack_device_commands');
  await f.rows("UPDATE ecotrack_device_commands SET status='claimed',claimed_at='2026-11-02T00:00:41Z'");
  await f.call('ecotrack_cloud_request',['node-1','ac_intent',f.draft().intent,randomUUID()]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',['2026-11-02T00:01:00Z']);
  assert.equal((await f.rows('SELECT status FROM ecotrack_device_commands WHERE id=$1',[c.id]))[0].status,'superseded');
  assert.equal((await f.rows('SELECT status FROM ac_command_schedule_runs'))[0].status,'unconfirmed');
 } finally {await f.dispose();}
});
