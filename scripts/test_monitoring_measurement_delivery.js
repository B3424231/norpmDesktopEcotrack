'use strict';
// Real PostgreSQL triggers, isolated from Supabase and physical devices.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.ECOTRACK_DESKTOP_ROOT||path.resolve(__dirname,'..');
const overlay=process.env.ECOTRACK_DESKTOP_OVERLAY||root;
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[root]}));
const load=file=>fs.readFileSync(path.join(fs.existsSync(path.join(overlay,file))?overlay:root,file),'utf8').replace(/^\uFEFF/,'');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec(load('scripts/test_cloud_hardware_database.js').match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(load('supabase_cloud_hardware_migration.sql'));
  await db.exec(load('supabase_ac_recording_migration.sql'));
  await db.exec(`ALTER TABLE nodes ADD COLUMN device_mode text DEFAULT 'controller',ADD COLUMN monitor_aircon_id text;
   ALTER TABLE telemetry ADD COLUMN observed_at timestamptz,ADD COLUMN boot_id text,ADD COLUMN sequence bigint,
    ADD COLUMN rotation_rpm double precision,ADD COLUMN rotation_quality text;`);
  await db.exec(load('scripts/fixtures/monitoring-control-snapshot.sql'));
  await db.exec(`CREATE TRIGGER ecotrack_telemetry_control_snapshot BEFORE INSERT ON telemetry
   FOR EACH ROW EXECUTE FUNCTION public.ecotrack_snapshot_aircon_control();
   INSERT INTO nodes(id,name,device_mode,monitor_aircon_id) VALUES('sensor','Fixture monitor','monitoring','ac-sensor');
   INSERT INTO aircons(id,desired_state,commanded_at) VALUES('ac-sensor','{"power":false}',now()-interval '1 minute');`);
  const repair='supabase/migrations/202610240002_preserve_monitoring_measurements.sql';
  if(fs.existsSync(path.join(overlay,repair)))await db.exec(load(repair));
  await db.exec(load('supabase/migrations/20261109110749_record_monitoring_ac_settings.sql'));
  let sequence=0;
  const insert=async(overrides={})=>{
   const n=++sequence,stamp=new Date().toISOString();
   const sample={id:'sample-'+n,node_id:'sensor',temperature:29.4375,status:'online',created:stamp,
    observed_at:stamp,boot_id:'fixture-boot-1',sequence:n,interval_seconds:5,rotation_rpm:null,
    rotation_quality:'missing',ac_on:null,...overrides};
   const fields=Object.keys(sample);
   return (await db.query('INSERT INTO telemetry('+fields.join(',')+') VALUES('+fields.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(sample))).rows;
  };
  const first=await insert();
  assert.equal(first.length,1,'A measured temperature must survive without an AC ON command');
  assert.equal(Number(first[0].temperature),29.4375);assert.equal(first[0].ac_on,null);
  assert.equal(first[0].aircon_id,'ac-sensor');assert.equal(first[0].control_snapshot.desired_state.power,false);
  assert.equal(Number((await insert({temperature:0,ac_on:false}))[0].temperature),0);
  assert.equal((await insert({temperature:null,rotation_rpm:1200,rotation_quality:'ok'}))[0].rotation_rpm,1200);
  await db.exec("UPDATE nodes SET device_mode='both' WHERE id='sensor'; UPDATE aircons SET controller_node_id='sensor' WHERE id='ac-sensor'");
  const both=(await insert())[0];assert.equal(both.ac_on,null);assert.equal(both.aircon_id,'ac-sensor');
  for(const missing of [{observed_at:null},{boot_id:null},{sequence:null},{temperature:null,rotation_rpm:null}])
   assert.equal((await insert(missing)).length,0,'Incomplete/heartbeat-only data must retain the legacy OFF gate');
  await db.exec("UPDATE nodes SET device_mode='controller' WHERE id='sensor'");
  assert.equal((await insert()).length,0,'Controller-only OFF recording behavior must stay unchanged');
  await db.exec("UPDATE nodes SET device_mode='monitoring' WHERE id='sensor'; UPDATE aircons SET controller_node_id=NULL WHERE id='ac-sensor'");
  await db.exec(load(repair));
  assert.equal((await insert())[0].aircon_id,'ac-sensor');
  await db.exec(`INSERT INTO nodes(id,name,device_mode) VALUES('controller','Fixture controller','controller');
   UPDATE aircons SET controller_node_id='controller',desired_state='{"power":true,"temp":25,"fan":"high"}',
    commanded_at='2026-10-26T10:00:00Z' WHERE id='ac-sensor';
   INSERT INTO ecotrack_device_state(node_id,device_id,last_seen,latest_ir)
   VALUES('controller','esp32s3-112233445566','2026-10-26T10:00:04Z',
    '{"protocol":"TCL112AC","raw_count":227,"received_at":"2026-10-26T10:00:04Z",
      "state":{"temp":26,"fan":"quiet"},"field_at":{"fan":"2026-10-26T10:00:08Z"}}');`);
  const at=observed_at=>({observed_at,created:observed_at});
  const requested=(await insert(at('2026-10-26T10:00:02Z')))[0];
  assert.equal(requested.control_snapshot.desired_state.temp,25);
  assert.equal(requested.control_snapshot.desired_state.fan,'high');
  assert.equal(requested.control_snapshot.observed_remote_state,undefined);
  const mixed=(await insert(at('2026-10-26T10:00:06Z')))[0];
  assert.equal(mixed.control_snapshot.observed_remote_state.temp,26);
  assert.equal(mixed.control_snapshot.observed_remote_state.fan,undefined,'A later field must not leak into an earlier row');
  const remote=(await insert(at('2026-10-26T10:00:09Z')))[0];
  assert.equal(remote.control_snapshot.observed_remote_state.fan,'quiet');
  assert.equal(remote.ac_on,null);
  const older=(await insert(at('2026-10-26T09:59:59Z')))[0];
  assert.equal(older.control_snapshot,null,'A delayed sample must not inherit newer settings');
  const explicit={reported_state:{temp:20,fan:'low'},reported_at:'2026-10-26T10:00:01Z'};
  assert.deepEqual((await insert({...at('2026-10-26T10:00:10Z'),control_snapshot:JSON.stringify(explicit)}))[0].control_snapshot,explicit);
  const total=(await db.query('SELECT count(*)::integer AS count FROM telemetry')).rows[0].count;
  assert.equal(total,10);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT ecotrack_private.monitoring_measurement_aircon(t) FROM public.telemetry t LIMIT 1'),e=>e.code==='42501');
  console.log('PASS: measured temperature/RPM retention, exact AC binding, unknown/OFF power, missing metadata, legacy recording, repeat migration, and private-helper access.');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
