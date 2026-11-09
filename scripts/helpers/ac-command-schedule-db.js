const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const actor = '11111111-1111-4111-8111-111111111111';

async function openScheduleDb(options = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
      CREATE FUNCTION public.ecotrack_is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.admin',true),'false')='true' $$;
      CREATE TABLE rooms(id text PRIMARY KEY,name text);
      CREATE TABLE administrators(id text PRIMARY KEY,auth_user_id uuid,is_active boolean);
      CREATE TABLE telemetry(id text PRIMARY KEY,node_id text,sensor_name text,room_name text,aircon_type text,temperature numeric,pressure numeric,battery numeric,rssi numeric,status text,created timestamptz,interval_seconds numeric,ac_on boolean);
      CREATE TABLE nodes(id text PRIMARY KEY DEFAULT ('node_'||gen_random_uuid()),name text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'offline',room_id text REFERENCES rooms(id),brand text,aircon_type text,temp numeric,rssi numeric,battery numeric,ip_address text,wifi_ssid text,wake_time text,sleep_time text,interval_val integer,interval_unit text,created timestamptz DEFAULT now(),updated timestamptz DEFAULT now());
      CREATE TABLE aircons(id text PRIMARY KEY,name text,aircon_type text,node_id text,controller_node_id text,protocol text,protocol_name text,capability_profile jsonb NOT NULL DEFAULT '{}',desired_state jsonb,command_id uuid,command_status text,command_status_at timestamptz,commanded_at timestamptz,reported_state jsonb,reported_at timestamptz);
      CREATE TABLE notifications(id text PRIMARY KEY,date text,time text,content text,triggered boolean DEFAULT false,room_id text,created timestamptz DEFAULT now(),updated timestamptz DEFAULT now(),is_read boolean DEFAULT false,dismissed boolean DEFAULT false,is_dismissed_from_inbox boolean DEFAULT false);
      SELECT set_config('test.user','${actor}',false),set_config('test.admin','true',false);
      INSERT INTO administrators VALUES ('admin','${actor}',true);
      INSERT INTO rooms VALUES ('room-1','Laboratory');
    `);
    await db.exec(read('supabase_cloud_hardware_migration.sql'));
    const caps = read('supabase_ac_capabilities_migration.sql');
    await db.exec(caps.slice(caps.indexOf('CREATE OR REPLACE FUNCTION public.ecotrack_ac_registry()'), caps.indexOf('CREATE OR REPLACE FUNCTION public.ecotrack_verify_ac_capabilities')));
    await db.exec(caps.slice(caps.indexOf('CREATE OR REPLACE FUNCTION public.ecotrack_cloud_request('), caps.indexOf('CREATE OR REPLACE FUNCTION public.ecotrack_device_observe(')));
    await db.exec(read('supabase/migrations/20261102055137_ac_command_schedules.sql'));
    // pg_cron itself is unavailable in WASM; this opt-in fixture verifies its
    // documented registration contract and the exact migration's inactive branch.
    if (options.cron) await db.exec(`
      CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
      CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE plpgsql AS $job$
      DECLARE selected_id bigint;
      BEGIN
       INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command)
       ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command,active=true RETURNING jobid INTO selected_id;
       RETURN selected_id;
      END $job$;
      -- Managed Supabase denies direct UPDATE of cron.job, even to its postgres
      -- migration role. Model that boundary rather than a freely writable table.
      CREATE FUNCTION cron.guard_job_update() RETURNS trigger LANGUAGE plpgsql AS $guard$
      BEGIN
       IF coalesce(current_setting('test.cron_api',true),'')<>'on' THEN
        RAISE EXCEPTION 'permission denied for table job' USING ERRCODE='42501';
       END IF;
       RETURN NEW;
      END $guard$;
      CREATE TRIGGER managed_cron_update BEFORE UPDATE ON cron.job FOR EACH ROW EXECUTE FUNCTION cron.guard_job_update();
      CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $alter$
      BEGIN
       PERFORM set_config('test.cron_api','on',true);
       UPDATE cron.job j SET active=coalesce($6,j.active) WHERE j.jobid=$1;
       PERFORM set_config('test.cron_api','off',true);
      END $alter$;
    `);

    await db.exec(read('supabase/migrations/20261102055353_ac_command_schedule_evaluator.sql'));
    const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
    const call = async (name, args = []) => {
      if (!/^(?:public\.|ecotrack_private\.)?[a-z_]+$/.test(name)) throw Error('Invalid function name');
      return (await rows(`SELECT ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS value`, args))[0].value;
    };
    const rpc = (name, args = {}) => {
      if (!/^[a-z_]+$/.test(name) || Object.keys(args).some(k => !/^p_[a-z_]+$/.test(k))) throw Error('Invalid RPC');
      return rows(`SELECT public.${name}(${Object.keys(args).map((k, i) => `${k} => $${i + 1}`).join(',')}) AS value`, Object.values(args)).then(r => r[0].value);
    };
    const seedDevice = async (suffix = '1') => {
      const nodeId = `node-${suffix}`, acId = `ac-${suffix}`, deviceId = `esp32s3-${String(suffix).padStart(12, '0')}`;
      await rows(`INSERT INTO nodes(id,name,room_id,wake_time,sleep_time,aircon_type) VALUES($1,$2,'room-1','00:00','00:00','Split')`, [nodeId, `Controller ${suffix}`]);
      await rows(`INSERT INTO aircons(id,name,aircon_type,node_id,controller_node_id,protocol_name) VALUES($1,$2,'Split',$3,$3,'TCL112AC')`, [acId, `AC ${suffix}`, nodeId]);
      await rows(`INSERT INTO ecotrack_device_state(node_id,device_id,last_seen,capabilities,latest_ir) VALUES($1,$2,'2026-11-02T00:00:00Z','{"ir_transmitter":true,"ir_receiver":true}','{"protocol":"TCL112AC","state":{"turbo":"off","quiet":"off","filter":"off","eco":"off","display":"on","swing_vertical":"off","swing_horizontal":"off"}}')`, [nodeId, deviceId]);
      return { node_id: nodeId, aircon_id: acId, device_id: deviceId };
    };
    await seedDevice();
    const draft = (overrides = {}) => ({name:'Morning',node_id:'node-1',aircon_id:'ac-1',device_id:'esp32s3-000000000001',weekdays:[1,2,3,4,5],local_time:'08:00',timezone:'Asia/Singapore',action:'turn_on',enabled:true,intent:{aircon_id:'ac-1',protocol:'TCL112AC',model:null,capability_revision:0,registry_version:'irremote-2.9.0-1',state:{power:'on',temp:24,mode:'cool',fan:'auto',swing_vertical:'off',swing_horizontal:'off',eco:'off',display:'on'}},...overrides});
    const seedSchedule = async (overrides = {}) => {
      const d = draft(overrides);
      await rows(`INSERT INTO ac_command_automation(node_id,aircon_id,enabled) VALUES($1,$2,true) ON CONFLICT DO NOTHING`, [d.node_id, d.aircon_id]);
      return (await rows(`INSERT INTO ac_command_schedules(name,node_id,aircon_id,device_id,weekdays,local_time,action,intent,enabled,next_run_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [d.name,d.node_id,d.aircon_id,d.device_id,d.weekdays,d.local_time,d.action,d.intent,d.enabled,d.next_run_at || '2026-11-02T00:00:00Z',d.created_by || actor]))[0];
    };
    return { db, rows, call, rpc, draft, seedSchedule, seedDevice, actor, dispose: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}
module.exports = { openScheduleDb, actor };


