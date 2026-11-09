-- Cloud worker only. This migration never enables Cron or changes device firmware.
BEGIN;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS node_id text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS schedule_event jsonb;
CREATE INDEX ac_schedule_due_idx ON public.ac_command_schedules(next_run_at,node_id) WHERE enabled AND archived_at IS NULL;
CREATE INDEX ac_schedule_command_idx ON public.ac_command_schedule_runs(command_id) WHERE command_id IS NOT NULL;
CREATE TABLE ecotrack_private.ac_command_scheduler_health (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), last_tick_at timestamptz, last_error text
);
ALTER TABLE ecotrack_private.ac_command_scheduler_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ecotrack_private.ac_command_scheduler_health FROM PUBLIC,anon,authenticated;
INSERT INTO ecotrack_private.ac_command_scheduler_health(singleton) VALUES(true);

-- A trigger makes queued -> final transitions update the same inbox row, including
-- transitions caused by archive/edit/master pause. Read/dismiss columns are untouched.
CREATE FUNCTION ecotrack_private.publish_ac_schedule_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snapshot jsonb; stamp timestamptz:=NEW.updated_at;
BEGIN
 snapshot:=to_jsonb(NEW)||jsonb_build_object('ac_type',(SELECT coalesce(to_jsonb(a)->>'aircon_type',to_jsonb(a)->>'ac_type') FROM public.aircons a WHERE a.id=NEW.aircon_id));
 INSERT INTO public.notifications(id,date,time,content,triggered,room_id,node_id,type,event_key,schedule_event,created,updated)
 VALUES('ac_schedule_'||NEW.id,(NEW.scheduled_at AT TIME ZONE 'Asia/Singapore')::date,(NEW.scheduled_at AT TIME ZONE 'Asia/Singapore')::time,
 NEW.schedule_name||': '||NEW.status,true,NEW.room_id,NEW.node_id,'ac_command_schedule','ac-schedule:'||NEW.id,snapshot,NEW.created_at,stamp)
 ON CONFLICT(id) DO UPDATE SET
 content=EXCLUDED.content,
 schedule_event=notifications.schedule_event||jsonb_build_object('status',NEW.status,'reason',NEW.reason,'command_id',NEW.command_id,'transmitted_at',NEW.transmitted_at,'updated_at',NEW.updated_at),
 updated=stamp
 WHERE notifications.schedule_event->>'status' IS DISTINCT FROM NEW.status
 OR notifications.schedule_event->>'reason' IS DISTINCT FROM NEW.reason
 OR notifications.schedule_event->>'command_id' IS DISTINCT FROM NEW.command_id::text
 OR notifications.schedule_event->'transmitted_at' IS DISTINCT FROM coalesce(to_jsonb(NEW.transmitted_at),'null'::jsonb);
 IF NEW.command_id IS NOT NULL AND NEW.status IN ('sent','missed','failed','superseded') THEN
  -- Settle only this scheduled command's existing summary. A newer manual
  -- command must retain its own state; no reported/physical fields are changed.
  UPDATE public.aircons SET command_status=CASE WHEN NEW.status='sent' THEN 'transmitted' ELSE 'failed' END,command_status_at=NEW.updated_at
  WHERE id=NEW.aircon_id AND command_id=NEW.command_id
   AND command_status IS DISTINCT FROM CASE WHEN NEW.status='sent' THEN 'transmitted' ELSE 'failed' END;
 END IF;

 RETURN NEW;
END $$;
CREATE TRIGGER ac_schedule_run_notification AFTER INSERT OR UPDATE OF status,reason,transmitted_at ON public.ac_command_schedule_runs
FOR EACH ROW EXECUTE FUNCTION ecotrack_private.publish_ac_schedule_run();

CREATE FUNCTION ecotrack_private.cancel_ac_schedule_commands(p_schedule_id uuid DEFAULT NULL,p_node_id text DEFAULT NULL,p_aircon_id text DEFAULT NULL,p_reason text DEFAULT 'Schedule changed') RETURNS integer
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r public.ac_command_schedule_runs; c public.ecotrack_device_commands; total integer:=0;
BEGIN
 -- Caller has already locked the controller, matching manual enqueue and dispatch.
 FOR r IN SELECT * FROM public.ac_command_schedule_runs WHERE command_id IS NOT NULL AND status IN ('queued','unconfirmed')
 AND (p_schedule_id IS NULL OR schedule_id=p_schedule_id) AND (p_node_id IS NULL OR node_id=p_node_id) AND (p_aircon_id IS NULL OR aircon_id=p_aircon_id) FOR UPDATE LOOP
  SELECT * INTO c FROM public.ecotrack_device_commands WHERE id=r.command_id FOR UPDATE;
  IF c.status IN ('queued','claimed') THEN
   IF c.claimed_at IS NULL AND c.status='queued' THEN
    UPDATE public.ecotrack_device_commands SET status='superseded',result=jsonb_build_object('success',false,'error',p_reason) WHERE id=c.id;
    UPDATE public.ac_command_schedule_runs SET status='superseded',reason=p_reason,updated_at=clock_timestamp() WHERE id=r.id;
   ELSE
    UPDATE public.ac_command_schedule_runs SET status='unconfirmed',reason=p_reason||'; already claimed, delivery may be in flight',updated_at=clock_timestamp() WHERE id=r.id AND (status<>'unconfirmed' OR reason IS DISTINCT FROM p_reason||'; already claimed, delivery may be in flight');
   END IF;
   total:=total+1;
  END IF;
 END LOOP;
 RETURN total;
END $$;

CREATE FUNCTION ecotrack_private.reconcile_ac_command_schedule_runs(p_now timestamptz DEFAULT clock_timestamp()) RETURNS integer
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE candidate record; r public.ac_command_schedule_runs; c public.ecotrack_device_commands; new_status text; why text; sent_at timestamptz; total integer:=0; registry jsonb:=public.ecotrack_ac_registry();
BEGIN
 FOR candidate IN SELECT id,node_id FROM public.ac_command_schedule_runs WHERE command_id IS NOT NULL AND status IN ('queued','unconfirmed') ORDER BY node_id,id LOOP
  PERFORM 1 FROM public.nodes WHERE id=candidate.node_id FOR UPDATE;
  SELECT * INTO r FROM public.ac_command_schedule_runs WHERE id=candidate.id FOR UPDATE;
  IF r.status NOT IN ('queued','unconfirmed') THEN CONTINUE; END IF;
  SELECT * INTO c FROM public.ecotrack_device_commands WHERE id=r.command_id FOR UPDATE;
  new_status:=r.status;why:=r.reason;sent_at:=NULL;
  IF c.id IS NULL THEN new_status:='unconfirmed';why:='Command record unavailable; delivery cannot be verified';
  ELSIF c.status='completed' THEN
   IF c.kind='ac_intent' AND c.node_id=r.node_id AND c.payload->>'aircon_id'=r.aircon_id AND c.result->'state'=c.payload->'state' AND c.payload->'state'=r.intent->'state' AND c.acknowledged_at>=c.created_at AND c.result->'success'='true'::jsonb AND c.result->>'command_id'=c.id::text AND c.result->>'aircon_id'=r.aircon_id
    AND coalesce(registry->'aliases'->>upper(c.result->>'protocol'),upper(c.result->>'protocol'))=coalesce(registry->'aliases'->>upper(r.intent->>'protocol'),upper(r.intent->>'protocol'))
    AND c.result->>'delivery_status'='transmitted' AND c.acknowledged_at IS NOT NULL THEN
    new_status:='sent';why:='IR transmission acknowledged; physical AC operation is not confirmed';sent_at:=c.acknowledged_at;
   ELSE new_status:=CASE WHEN c.claimed_at IS NOT NULL THEN 'unconfirmed' ELSE 'failed' END;why:='Invalid or mismatched transmission receipt'; END IF;
  ELSIF c.status='failed' THEN
   new_status:=CASE WHEN c.claimed_at IS NOT NULL AND c.result->'success' IS DISTINCT FROM 'false'::jsonb THEN 'unconfirmed' ELSE 'failed' END;
   why:=coalesce(c.result->>'error','Device rejected scheduled command');
  ELSIF c.status IN ('expired','superseded') OR c.expires_at<=p_now THEN
   IF c.status IN ('queued','claimed') THEN UPDATE public.ecotrack_device_commands SET status='expired',result=jsonb_build_object('success',false,'error','Scheduled command expired') WHERE id=c.id; END IF;
   new_status:=CASE WHEN c.claimed_at IS NOT NULL OR c.status='claimed' THEN 'unconfirmed' WHEN c.status='superseded' THEN 'superseded' ELSE 'missed' END;
   why:=CASE WHEN new_status='unconfirmed' THEN 'Claimed command has no matching transmission receipt; delivery is unconfirmed' WHEN new_status='superseded' THEN 'Replaced by a newer command' ELSE 'Delivery window expired before device claimed command' END;
  END IF;
  IF (r.status,r.reason,r.transmitted_at) IS DISTINCT FROM (new_status,why,sent_at) THEN
   UPDATE public.ac_command_schedule_runs SET status=new_status,reason=why,transmitted_at=sent_at,updated_at=p_now WHERE id=r.id;
   total:=total+1;
  END IF;
 END LOOP;
 RETURN total;
END $$;

-- Validate fields retained by the existing firmware without changing that firmware.
-- Explicit safe extras form a complete preset; unsafe carried features must be
-- known off. Newer matching transmission evidence can supersede an IR observation.
CREATE FUNCTION ecotrack_private.validate_ac_schedule_carried_state(p_ac public.aircons,p_device public.ecotrack_device_state,p_intent jsonb,p_action text,p_now timestamptz DEFAULT clock_timestamp()) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $body$
DECLARE caps jsonb; safe jsonb; registry jsonb:=public.ecotrack_ac_registry(); k text; known text; sent_value text; captured timestamptz:='-infinity'; model integer;
BEGIN
 IF p_action='turn_off' THEN RETURN; END IF;
 model:=coalesce((p_intent->>'resolved_model')::integer,(p_intent->>'model')::integer);
 caps:=public.ecotrack_resolve_ac_capabilities(p_intent->>'protocol',model,p_ac.capability_profile,p_device.latest_ir->'ac_capabilities');
 safe:=ecotrack_private.ac_schedule_safe_features(p_ac,p_device.latest_ir);
 FOR k IN SELECT jsonb_object_keys(safe) LOOP
  IF safe->k='true'::jsonb AND NOT (p_intent->'state' ? k) THEN RAISE EXCEPTION 'Choose a known value for % before enabling this preset',replace(k,'_',' '); END IF;
 END LOOP;
 BEGIN
  IF p_device.latest_ir->>'received_at' IS NOT NULL THEN captured:=(p_device.latest_ir->>'received_at')::timestamptz; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN captured:='infinity'; END;
 FOREACH k IN ARRAY ARRAY['turbo','eco','sleep','filter','clean','beep','i_feel'] LOOP
  IF caps->'features'->k IS DISTINCT FROM 'true'::jsonb OR safe->k='true'::jsonb THEN CONTINUE; END IF;
  known:=lower(p_device.latest_ir->'state'->>k);
  SELECT lower(c.result->'state'->>k) INTO sent_value FROM public.ecotrack_device_commands c
  WHERE c.node_id=p_device.node_id AND c.kind='ac_intent' AND c.status='completed'
   AND c.result->'success'='true'::jsonb AND c.result->>'command_id'=c.id::text
   AND c.result->>'aircon_id'=p_ac.id AND c.payload->>'aircon_id'=p_ac.id
   AND c.result->>'delivery_status'='transmitted' AND c.result->'state'=c.payload->'state'
   AND coalesce(registry->'aliases'->>upper(c.result->>'protocol'),upper(c.result->>'protocol'))=coalesce(registry->'aliases'->>upper(p_intent->>'protocol'),upper(p_intent->>'protocol'))
   AND c.acknowledged_at>captured AND c.acknowledged_at<=p_now AND c.result->'state' ? k
  ORDER BY c.acknowledged_at DESC,c.id LIMIT 1;
  IF FOUND THEN known:=sent_value; END IF;
  IF known IS NULL OR known NOT IN ('off','false','0') THEN RAISE EXCEPTION 'Disable or verify % using manual control before enabling this preset',replace(k,'_',' '); END IF;
 END LOOP;
END $body$;
REVOKE ALL ON FUNCTION ecotrack_private.validate_ac_schedule_carried_state(public.aircons,public.ecotrack_device_state,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION ecotrack_private.dispatch_due_ac_command_schedules(p_now timestamptz DEFAULT clock_timestamp(),p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE candidate record; s public.ac_command_schedules; n public.nodes; a public.aircons; d public.ecotrack_device_state;
 run_id uuid; cmd_id uuid; due timestamptz; outcome text; why text; payload jsonb; safe jsonb; k text;
 awake_seconds numeric; due_seconds numeric; count_done integer:=0; report jsonb:='{"queued":0,"missed":0,"skipped":0,"superseded":0,"failed":0}'; last_problem text;
BEGIN
 IF p_now IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'Invalid evaluator time or batch limit'; END IF;
 PERFORM ecotrack_private.reconcile_ac_command_schedule_runs(p_now);
 FOR candidate IN SELECT id,node_id FROM public.ac_command_schedules WHERE enabled AND archived_at IS NULL AND next_run_at<=p_now ORDER BY node_id,next_run_at DESC,id LIMIT p_limit LOOP
  -- Never acquire a schedule lock before its node: manual commands and CRUD share it.
  SELECT * INTO n FROM public.nodes WHERE id=candidate.node_id FOR UPDATE;
  SELECT * INTO s FROM public.ac_command_schedules WHERE id=candidate.id FOR UPDATE;
  IF NOT s.enabled OR s.archived_at IS NOT NULL OR s.next_run_at IS NULL OR s.next_run_at>p_now THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ac_command_automation WHERE node_id=s.node_id AND aircon_id=s.aircon_id AND enabled) THEN
   PERFORM ecotrack_private.cancel_ac_schedule_commands(s.id,NULL,NULL,'Automation paused');
   UPDATE public.ac_command_schedules SET next_run_at=ecotrack_private.ac_schedule_next(weekdays,local_time,p_now) WHERE id=s.id;
   CONTINUE;
  END IF;
  WHILE s.next_run_at<=p_now AND count_done<p_limit LOOP
   due:=s.next_run_at;run_id:=NULL;cmd_id:=NULL;outcome:='queued';why:=NULL;
   SELECT * INTO a FROM public.aircons WHERE id=s.aircon_id;
   SELECT * INTO d FROM public.ecotrack_device_state WHERE node_id=s.node_id;
   INSERT INTO public.ac_command_schedule_runs(schedule_id,schedule_version,schedule_name,action,scheduled_at,node_id,aircon_id,device_id,device_name,aircon_name,room_id,room_name,intent,status,created_at,updated_at)
   VALUES(s.id,s.version,s.name,s.action,due,s.node_id,s.aircon_id,s.device_id,n.name,to_jsonb(a)->>'name',n.room_id,(SELECT name FROM public.rooms WHERE id=n.room_id),s.intent,'queued',p_now,p_now)
   ON CONFLICT(schedule_id,scheduled_at) DO NOTHING RETURNING id INTO run_id;
   IF run_id IS NOT NULL THEN
    -- A bad preset rolls back only its enqueue work; other controllers keep progressing.
    BEGIN
     IF due+interval '120 seconds'<=p_now THEN outcome:='missed';why:='Scheduled delivery window elapsed; command was not replayed';
     ELSE
      IF n.id IS NULL OR a.id IS NULL OR NOT coalesce(a.controller_node_id=n.id OR a.node_id IN(n.id,n.name),false)
       OR d.node_id IS NULL OR d.device_id IS DISTINCT FROM s.device_id
       OR d.capabilities->'ir_transmitter' IS DISTINCT FROM 'true'::jsonb
       OR (SELECT count(*) FROM public.aircons x WHERE x.controller_node_id=n.id OR x.node_id IN(n.id,n.name))<>1 THEN RAISE EXCEPTION 'Controller binding changed; review schedule'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=s.created_by AND is_active IS TRUE) THEN RAISE EXCEPTION 'Schedule creator is no longer an active administrator'; END IF;
      IF coalesce(n.wake_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(n.sleep_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Device awake hours are unknown; review schedule'; END IF;
      awake_seconds:=mod(extract(epoch FROM n.sleep_time::time)-extract(epoch FROM n.wake_time::time)+86400,86400);
      due_seconds:=mod(extract(epoch FROM (due AT TIME ZONE 'Asia/Singapore')::time)-extract(epoch FROM n.wake_time::time)+86400,86400);
      IF awake_seconds<>0 AND (due_seconds<120 OR due_seconds+120>=awake_seconds) THEN RAISE EXCEPTION 'Schedule is outside the device awake window'; END IF;
      IF NOT(s.intent ?& ARRAY['aircon_id','protocol','model','capability_revision','registry_version','state']) OR s.intent->>'aircon_id' IS DISTINCT FROM s.aircon_id THEN RAISE EXCEPTION 'Incomplete schedule intent'; END IF;
      IF s.intent->'state'->>'power' IS DISTINCT FROM (CASE WHEN s.action='turn_off' THEN 'off' ELSE 'on' END) THEN RAISE EXCEPTION 'Action and power disagree'; END IF;
      safe:=ecotrack_private.ac_schedule_safe_features(a,d.latest_ir);
      FOR k IN SELECT jsonb_object_keys(s.intent->'state') LOOP
       IF k NOT IN ('power','temp','mode','fan') AND safe->k IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Special function is not verified repeat-safe: %',k; END IF;
      END LOOP;
      payload:=s.intent||public.ecotrack_validate_ac_intent(a,d.latest_ir,s.intent);
      PERFORM ecotrack_private.validate_ac_schedule_carried_state(a,d,payload,s.action,p_now);
      IF (s.intent->'state'->>'temp')::numeric<>trunc((s.intent->'state'->>'temp')::numeric) THEN RAISE EXCEPTION 'Schedule temperature must use whole degrees'; END IF;
      IF EXISTS(SELECT 1 FROM public.ecotrack_device_commands c WHERE c.node_id=s.node_id AND c.kind='ac_intent' AND c.created_at>=due-interval '120 seconds' AND c.created_at<=p_now AND NOT EXISTS(SELECT 1 FROM public.ac_command_schedule_runs r WHERE r.command_id=c.id)) THEN
       outcome:='skipped';why:='Recent manual command takes priority';
      ELSIF EXISTS(SELECT 1 FROM public.ac_command_schedules newer WHERE newer.node_id=s.node_id AND newer.aircon_id=s.aircon_id AND newer.enabled AND newer.archived_at IS NULL AND newer.next_run_at>due AND newer.next_run_at<=p_now)
       OR EXISTS(SELECT 1 FROM public.ac_command_schedule_runs newer WHERE newer.node_id=s.node_id AND newer.aircon_id=s.aircon_id AND newer.scheduled_at>due AND newer.scheduled_at<=p_now AND newer.status IN ('queued','sent','unconfirmed')) THEN
       outcome:='superseded';why:='A later scheduled preset takes priority';
      ELSIF d.sleeping_until>p_now THEN outcome:='skipped';why:='Device reported sleeping during the command window';
      ELSIF s.action='change_settings' AND NOT coalesce(a.reported_at<=p_now AND a.reported_at>=p_now-interval '120 seconds' AND a.reported_state->>'power'='on',false) THEN
       outcome:='skipped';why:='Fresh explicit reported AC-on state is required';
      ELSE
       PERFORM ecotrack_private.cancel_ac_schedule_commands(NULL,s.node_id,s.aircon_id,'Replaced by later scheduled preset');
       cmd_id:=gen_random_uuid();
       INSERT INTO public.ecotrack_device_commands(id,node_id,kind,payload,created_by,created_at,expires_at)
       VALUES(cmd_id,s.node_id,'ac_intent',payload,s.created_by,p_now,due+interval '120 seconds');
       UPDATE public.aircons SET desired_state=payload->'state',command_id=cmd_id,command_status='queued',command_status_at=p_now,commanded_at=p_now WHERE id=a.id;
      END IF;
     END IF;
    EXCEPTION WHEN OTHERS THEN
     outcome:='failed';why:=SQLERRM;cmd_id:=NULL;last_problem:=why;
     UPDATE public.ac_command_schedules SET enabled=false,next_run_at=NULL,version=version+1,updated_at=p_now WHERE id=s.id;
     PERFORM ecotrack_private.cancel_ac_schedule_commands(s.id,NULL,NULL,'Schedule needs review: '||why);
    END;
    UPDATE public.ac_command_schedule_runs SET command_id=cmd_id,status=outcome,reason=why,updated_at=p_now WHERE id=run_id;
    report:=jsonb_set(report,ARRAY[outcome],to_jsonb((report->>outcome)::integer+1));
    count_done:=count_done+1;
   END IF;
   UPDATE public.ac_command_schedules SET next_run_at=CASE WHEN enabled THEN ecotrack_private.ac_schedule_next(weekdays,local_time,due) END WHERE id=s.id RETURNING * INTO s;
   IF NOT s.enabled THEN EXIT; END IF;
  END LOOP;
  EXIT WHEN count_done>=p_limit;
 END LOOP;
 UPDATE ecotrack_private.ac_command_scheduler_health SET last_tick_at=p_now,last_error=last_problem WHERE singleton;
 RETURN report;
END $$;

CREATE FUNCTION public.ecotrack_ac_command_scheduler_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h ecotrack_private.ac_command_scheduler_health; active boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM ecotrack_private.ac_command_scheduler_health WHERE singleton;
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=$1 AND active)' INTO active USING 'ecotrack-ac-command-schedules';
 END IF;
 RETURN jsonb_build_object('last_tick_at',h.last_tick_at,'cron_active',active,'available',active AND coalesce(h.last_tick_at BETWEEN clock_timestamp()-interval '120 seconds' AND clock_timestamp(),false),'last_error',h.last_error);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_ac_command_scheduler_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_ac_command_scheduler_status() TO authenticated;
REVOKE ALL ON FUNCTION ecotrack_private.publish_ac_schedule_run(),ecotrack_private.cancel_ac_schedule_commands(uuid,text,text,text),ecotrack_private.reconcile_ac_command_schedule_runs(timestamptz),ecotrack_private.dispatch_due_ac_command_schedules(timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA ecotrack_private FROM PUBLIC,anon,authenticated;

-- Registration and deactivation commit together: the job cannot run between them.
-- When pg_cron is absent, installation succeeds and health remains unavailable.
DO $$ DECLARE job bigint; BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT cron.schedule($1,$2,$3)' INTO job USING 'ecotrack-ac-command-schedules','* * * * *','SELECT ecotrack_private.dispatch_due_ac_command_schedules(); SELECT ecotrack_private.reconcile_ac_command_schedule_runs();';
  -- Supabase manages cron.job permissions; use its supported mutation API.
  PERFORM cron.alter_job(job_id := job,active := false);
 END IF;
END $$;
COMMIT;




