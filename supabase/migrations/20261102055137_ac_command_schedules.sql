-- Schedule storage and administrator APIs. Apply with the paired evaluator migration; Cron starts inactive.
BEGIN;
CREATE TABLE public.ac_command_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL DEFAULT 1,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 node_id text NOT NULL, aircon_id text NOT NULL, device_id text NOT NULL,
 weekdays integer[] NOT NULL, local_time time NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Singapore' CHECK(timezone='Asia/Singapore'),
 action text NOT NULL CHECK(action IN ('turn_on','turn_off','change_settings')), intent jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT false, next_run_at timestamptz,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz
);
CREATE TABLE public.ac_command_automation (
 node_id text NOT NULL, aircon_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(node_id,aircon_id)
);
CREATE TABLE public.ac_command_schedule_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL REFERENCES public.ac_command_schedules(id),
 schedule_version integer NOT NULL, schedule_name text NOT NULL, action text NOT NULL CHECK(action IN ('turn_on','turn_off','change_settings')), scheduled_at timestamptz NOT NULL, command_id uuid,
 node_id text NOT NULL, aircon_id text NOT NULL, device_id text NOT NULL, device_name text, aircon_name text, room_id text, room_name text,
 intent jsonb NOT NULL, status text NOT NULL CHECK(status IN ('queued','sent','missed','failed','skipped','superseded','unconfirmed')),
 reason text, transmitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(schedule_id,scheduled_at)
);
ALTER TABLE public.ac_command_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ac_command_automation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ac_command_schedule_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ac_command_schedules,public.ac_command_automation,public.ac_command_schedule_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ac_command_schedules,public.ac_command_automation,public.ac_command_schedule_runs TO authenticated;
-- Admin checks include the current mapped account, not only a cached role claim.
CREATE FUNCTION public.ecotrack_command_schedule_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
 SELECT auth.uid() IS NOT NULL AND public.ecotrack_is_admin() IS TRUE
 AND EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE)
$body$;
REVOKE ALL ON FUNCTION public.ecotrack_command_schedule_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_command_schedule_admin() TO authenticated;

CREATE POLICY ac_schedule_admin_read ON public.ac_command_schedules FOR SELECT TO authenticated USING (public.ecotrack_command_schedule_admin());
CREATE POLICY ac_automation_admin_read ON public.ac_command_automation FOR SELECT TO authenticated USING (public.ecotrack_command_schedule_admin());
CREATE POLICY ac_schedule_runs_admin_read ON public.ac_command_schedule_runs FOR SELECT TO authenticated USING (public.ecotrack_command_schedule_admin());

CREATE FUNCTION ecotrack_private.ac_schedule_next(p_days integer[],p_time time,p_after timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT min((d::date+p_time) AT TIME ZONE 'Asia/Singapore') FROM generate_series((p_after AT TIME ZONE 'Asia/Singapore')::date,(p_after AT TIME ZONE 'Asia/Singapore')::date+7,interval '1 day') d
 WHERE extract(isodow FROM d)::integer=ANY(p_days) AND ((d::date+p_time) AT TIME ZONE 'Asia/Singapore')>p_after
$$;
REVOKE ALL ON FUNCTION ecotrack_private.ac_schedule_next(integer[],time,timestamptz) FROM PUBLIC,anon,authenticated;
-- Audited against IRremoteESP8266 v2.9.0: ir_Tcl.cpp, ir_Daikin.cpp and IRac.cpp.
-- Only full-frame absolute fields with no mode side effects are permitted.
CREATE FUNCTION ecotrack_private.ac_schedule_safe_features(p_ac public.aircons,p_live jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE registry jsonb:=public.ecotrack_ac_registry(); name text; model integer; caps jsonb; allowed text[]; result jsonb;
BEGIN
 name:=coalesce(nullif(p_live->>'protocol','UNKNOWN'),p_ac.protocol_name,p_ac.protocol,'UNKNOWN');
 name:=coalesce(registry->'aliases'->>upper(name),upper(name));
 IF p_ac.capability_profile->>'protocol'=name AND p_ac.capability_profile->'model_verified'='true'::jsonb THEN
  model:=(p_ac.capability_profile->>'remote_model')::integer;
 ELSE model:=coalesce((p_live->>'remote_model')::integer,(p_ac.capability_profile->>'remote_model')::integer); END IF;
 IF model IS NOT NULL AND coalesce(registry->'protocols'->name->'models','{}'::jsonb)<>'{}'::jsonb AND NOT (registry->'protocols'->name->'models' ? model::text) THEN RETURN '{}'::jsonb; END IF;
 IF name='TEKNOPOINT' AND model IS NOT NULL AND model<>2 THEN RETURN '{}'::jsonb; END IF;
 caps:=public.ecotrack_resolve_ac_capabilities(name,model,p_ac.capability_profile,p_live->'ac_capabilities');
 IF caps->'can_transmit' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{}'::jsonb; END IF;
 allowed:=CASE WHEN name IN ('TCL112AC','TEKNOPOINT') THEN ARRAY['swing_vertical','swing_horizontal','eco','display'] WHEN name IN ('DAIKIN','DAIKIN2') THEN ARRAY['swing_vertical','swing_horizontal'] ELSE ARRAY[]::text[] END;
 SELECT coalesce(jsonb_object_agg(k,true),'{}'::jsonb) INTO result FROM unnest(allowed) k WHERE caps->'features'->k='true'::jsonb;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.ac_schedule_safe_features(public.aircons,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ecotrack_save_ac_command_schedule(p_draft jsonb,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.ac_command_schedules; a public.aircons; n public.nodes; live public.ecotrack_device_state; days integer[]; tm time; sid uuid; en boolean; awake_seconds numeric; due_seconds numeric;
BEGIN
 IF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('id','name','node_id','aircon_id','device_id','weekdays','local_time','timezone','action','intent','enabled')) THEN RAISE EXCEPTION 'Invalid schedule'; END IF;
 IF jsonb_typeof(p_draft->'weekdays') IS DISTINCT FROM 'array' OR jsonb_array_length(p_draft->'weekdays') NOT BETWEEN 1 AND 7 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'weekdays') x WHERE jsonb_typeof(x)<>'number' OR x::text !~ '^[1-7]$') THEN RAISE EXCEPTION 'Invalid weekdays'; END IF;
 SELECT array_agg(x::integer ORDER BY x::integer) INTO days FROM jsonb_array_elements_text(p_draft->'weekdays') x;
 IF cardinality(days)<>(SELECT count(DISTINCT x) FROM unnest(days) x) THEN RAISE EXCEPTION 'Duplicate weekdays'; END IF;
 IF coalesce(p_draft->>'local_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid time'; END IF;
 tm:=(p_draft->>'local_time')::time;
 IF coalesce(p_draft->>'timezone','')<>'Asia/Singapore' OR length(btrim(coalesce(p_draft->>'name',''))) NOT BETWEEN 1 AND 80 OR coalesce(p_draft->>'action','') NOT IN ('turn_on','turn_off','change_settings') OR jsonb_typeof(p_draft->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid schedule'; END IF;
 en:=(p_draft->>'enabled')::boolean;
 -- Activation remains unavailable until the worker and reconciliation are installed.
 IF en AND to_regprocedure('ecotrack_private.dispatch_due_ac_command_schedules(timestamp with time zone,integer)') IS NULL THEN RAISE EXCEPTION 'Scheduler is not ready'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_draft->>'node_id' FOR UPDATE;
 SELECT * INTO live FROM public.ecotrack_device_state WHERE node_id=n.id AND device_id=p_draft->>'device_id';
 SELECT * INTO a FROM public.aircons WHERE id=p_draft->>'aircon_id' AND (controller_node_id=n.id OR node_id IN(n.id,n.name)) FOR UPDATE;
 IF n.id IS NULL OR live.node_id IS NULL OR a.id IS NULL OR coalesce((live.capabilities->>'ir_transmitter')::boolean,false) IS NOT TRUE OR (SELECT count(*) FROM public.aircons x WHERE x.controller_node_id=n.id OR x.node_id IN(n.id,n.name))<>1 THEN RAISE EXCEPTION 'Invalid controller binding'; END IF;
 IF jsonb_typeof(p_draft->'intent') IS DISTINCT FROM 'object' OR NOT ((p_draft->'intent') ?& array['aircon_id','protocol','model','capability_revision','registry_version','state']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft->'intent') k WHERE k NOT IN ('aircon_id','protocol','model','capability_revision','registry_version','state')) OR jsonb_typeof(p_draft->'intent'->'state') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid intent'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft->'intent'->'state') k WHERE k NOT IN ('power','temp','mode','fan') AND (k NOT IN ('swing_vertical','swing_horizontal','sleep','turbo','eco','quiet','display','beep') OR ecotrack_private.ac_schedule_safe_features(a,live.latest_ir)->k IS DISTINCT FROM 'true'::jsonb)) THEN RAISE EXCEPTION 'Special function is not verified repeat-safe'; END IF;
 IF p_draft->'intent'->>'aircon_id' IS DISTINCT FROM a.id OR jsonb_typeof(p_draft->'intent'->'state'->'temp') IS DISTINCT FROM 'number' OR (p_draft->'intent'->'state'->>'temp')::numeric<>trunc((p_draft->'intent'->'state'->>'temp')::numeric) THEN RAISE EXCEPTION 'Invalid intent'; END IF;
 PERFORM public.ecotrack_validate_ac_intent(a,live.latest_ir,p_draft->'intent');
 IF en AND to_regprocedure('ecotrack_private.validate_ac_schedule_carried_state(public.aircons,public.ecotrack_device_state,jsonb,text,timestamptz)') IS NOT NULL THEN PERFORM ecotrack_private.validate_ac_schedule_carried_state(a,live,p_draft->'intent',p_draft->>'action',clock_timestamp()); END IF;
 IF (p_draft->>'action'='turn_on' AND p_draft->'intent'->'state'->>'power' IS DISTINCT FROM 'on') OR (p_draft->>'action'='turn_off' AND p_draft->'intent'->'state'->>'power' IS DISTINCT FROM 'off') OR (p_draft->>'action'='change_settings' AND p_draft->'intent'->'state'->>'power' IS DISTINCT FROM 'on') THEN RAISE EXCEPTION 'Action and power disagree'; END IF;
 sid:=nullif(p_draft->>'id','')::uuid;
 IF en THEN
  IF coalesce(n.wake_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(n.sleep_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Device awake hours are required'; END IF;
  awake_seconds:=mod(extract(epoch FROM n.sleep_time::time)-extract(epoch FROM n.wake_time::time)+86400,86400);
  due_seconds:=mod(extract(epoch FROM tm)-extract(epoch FROM n.wake_time::time)+86400,86400);
  IF awake_seconds<>0 AND (due_seconds<120 OR due_seconds+120>=awake_seconds) THEN RAISE EXCEPTION 'Schedule outside awake window'; END IF;
  IF EXISTS(SELECT 1 FROM public.ac_command_schedules x WHERE x.node_id=n.id AND x.aircon_id=a.id AND x.enabled AND x.archived_at IS NULL AND x.local_time=tm AND x.weekdays && days AND x.id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'Schedule conflict'; END IF;
 END IF;
 IF sid IS NULL THEN
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'Version conflict'; END IF;
  INSERT INTO public.ac_command_schedules(name,node_id,aircon_id,device_id,weekdays,local_time,action,intent,enabled,created_by) VALUES(btrim(p_draft->>'name'),n.id,a.id,live.device_id,days,tm,p_draft->>'action',p_draft->'intent',en,auth.uid()) RETURNING * INTO s;
 ELSE
  SELECT * INTO s FROM public.ac_command_schedules WHERE id=sid FOR UPDATE;
  IF s.id IS NULL OR s.version IS DISTINCT FROM p_expected_version OR s.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Version conflict'; END IF;
  IF s.node_id<>n.id OR s.aircon_id<>a.id OR s.device_id<>live.device_id THEN RAISE EXCEPTION 'Cannot change binding'; END IF;
  IF to_regprocedure('ecotrack_private.cancel_ac_schedule_commands(uuid,text,text,text)') IS NOT NULL THEN PERFORM ecotrack_private.cancel_ac_schedule_commands(s.id,NULL,NULL,'Schedule changed'); END IF;
  UPDATE public.ac_command_schedules SET name=btrim(p_draft->>'name'),weekdays=days,local_time=tm,action=p_draft->>'action',intent=p_draft->'intent',enabled=en,next_run_at=CASE WHEN en THEN ecotrack_private.ac_schedule_next(days,tm,now()) ELSE NULL END,version=version+1,updated_at=now() WHERE id=sid RETURNING * INTO s;
 END IF;
 IF en THEN INSERT INTO public.ac_command_automation(node_id,aircon_id,enabled) VALUES(n.id,a.id,true) ON CONFLICT(node_id,aircon_id) DO NOTHING; END IF;
 IF en AND s.next_run_at IS NULL THEN UPDATE public.ac_command_schedules SET next_run_at=ecotrack_private.ac_schedule_next(days,tm,now()) WHERE id=s.id RETURNING * INTO s; END IF;
 RETURN to_jsonb(s);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_save_ac_command_schedule(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_save_ac_command_schedule(jsonb,integer) TO authenticated;

CREATE FUNCTION public.ecotrack_set_ac_automation(p_node_id text,p_aircon_id text,p_enabled boolean,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.ac_command_automation; n public.nodes;
BEGIN
 IF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF n.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.aircons x WHERE x.id=p_aircon_id AND (x.controller_node_id=n.id OR x.node_id IN(n.id,n.name))) THEN RAISE EXCEPTION 'Invalid controller binding'; END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Invalid automation setting'; END IF;
 IF p_enabled AND to_regprocedure('ecotrack_private.dispatch_due_ac_command_schedules(timestamp with time zone,integer)') IS NULL THEN RAISE EXCEPTION 'Scheduler is not ready'; END IF;
 SELECT * INTO a FROM public.ac_command_automation WHERE node_id=p_node_id AND aircon_id=p_aircon_id FOR UPDATE;
 IF a.node_id IS NULL THEN
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'Version conflict'; END IF;
  INSERT INTO public.ac_command_automation(node_id,aircon_id,enabled) VALUES(p_node_id,p_aircon_id,p_enabled) RETURNING * INTO a;
 ELSE
  IF a.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  UPDATE public.ac_command_automation SET enabled=p_enabled,version=version+1,updated_at=now() WHERE node_id=p_node_id AND aircon_id=p_aircon_id RETURNING * INTO a;
 END IF;
 IF NOT p_enabled AND to_regprocedure('ecotrack_private.cancel_ac_schedule_commands(uuid,text,text,text)') IS NOT NULL THEN PERFORM ecotrack_private.cancel_ac_schedule_commands(NULL,p_node_id,p_aircon_id,'Automation paused'); END IF;
 IF p_enabled THEN UPDATE public.ac_command_schedules SET next_run_at=ecotrack_private.ac_schedule_next(weekdays,local_time,now()) WHERE node_id=p_node_id AND aircon_id=p_aircon_id AND enabled AND archived_at IS NULL; END IF;
 RETURN to_jsonb(a);
END $$;
CREATE FUNCTION public.ecotrack_archive_ac_command_schedule(p_schedule_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.ac_command_schedules;
BEGIN
 IF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.ac_command_schedules WHERE id=p_schedule_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Version conflict'; END IF;
 PERFORM 1 FROM public.nodes WHERE id=s.node_id FOR UPDATE;
 SELECT * INTO s FROM public.ac_command_schedules WHERE id=p_schedule_id FOR UPDATE;
 IF s.archived_at IS NOT NULL OR s.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
 IF to_regprocedure('ecotrack_private.cancel_ac_schedule_commands(uuid,text,text,text)') IS NOT NULL THEN PERFORM ecotrack_private.cancel_ac_schedule_commands(s.id,NULL,NULL,'Schedule archived'); END IF;
 UPDATE public.ac_command_schedules SET archived_at=now(),enabled=false,next_run_at=NULL,version=version+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_set_ac_automation(text,text,boolean,integer),public.ecotrack_archive_ac_command_schedule(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_set_ac_automation(text,text,boolean,integer),public.ecotrack_archive_ac_command_schedule(uuid,integer) TO authenticated;

CREATE FUNCTION public.ecotrack_list_ac_command_schedules(p_node_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE health jsonb:=jsonb_build_object('last_tick_at',NULL,'available',false);
BEGIN
 IF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.administrators WHERE auth_user_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
 IF to_regprocedure('public.ecotrack_ac_command_scheduler_status()') IS NOT NULL THEN EXECUTE 'SELECT public.ecotrack_ac_command_scheduler_status()' INTO health; END IF;
 RETURN jsonb_build_object(
  'schedules',coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('local_time',to_char(s.local_time,'HH24:MI')) ORDER BY s.created_at) FROM public.ac_command_schedules s WHERE s.archived_at IS NULL AND (p_node_id IS NULL OR s.node_id=p_node_id)),'[]'::jsonb),
  'automation',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.ac_command_automation a WHERE p_node_id IS NULL OR a.node_id=p_node_id),'[]'::jsonb),
  'runs',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.scheduled_at DESC) FROM (SELECT * FROM public.ac_command_schedule_runs WHERE p_node_id IS NULL OR node_id=p_node_id ORDER BY scheduled_at DESC LIMIT 100) r),'[]'::jsonb),
  'devices',coalesce((SELECT jsonb_agg(jsonb_build_object('aircon_id',a.id,'node_id',n.id,'device_id',d.device_id,'device_name',n.name,'aircon_name',to_jsonb(a)->>'name','room_id',n.room_id,'aircon_type',to_jsonb(a)->>'aircon_type','wake_time',n.wake_time,'sleep_time',n.sleep_time,'profile',to_jsonb(a),'cloud_state',to_jsonb(d),'schedule_safe_absolute',ecotrack_private.ac_schedule_safe_features(a,d.latest_ir)))
    FROM public.nodes n JOIN public.ecotrack_device_state d ON d.node_id=n.id JOIN public.aircons a ON (a.controller_node_id=n.id OR a.node_id IN(n.id,n.name))
    WHERE (p_node_id IS NULL OR n.id=p_node_id) AND coalesce((d.capabilities->>'ir_transmitter')::boolean,false) AND (SELECT count(*) FROM public.aircons x WHERE x.controller_node_id=n.id OR x.node_id IN(n.id,n.name))=1),'[]'::jsonb),
  'health',health);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_list_ac_command_schedules(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_list_ac_command_schedules(text) TO authenticated;
COMMIT;


