BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Monitoring inserts bypass the controller-only ON gate. Attach their settings
-- independently after the existing gate and snapshot triggers have run.
CREATE OR REPLACE FUNCTION ecotrack_private.record_monitoring_ac_settings()
RETURNS trigger
LANGUAGE plpgsql
-- The existing telemetry writers can insert samples without reading private settings tables.
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  bound_aircon text;
  controller text;
  ac public.aircons%ROWTYPE;
  device public.ecotrack_device_state%ROWTYPE;
  settings jsonb;
  frame jsonb;
  remote_fields jsonb;
  remote_times jsonb;
  seen timestamptz;
  captured numeric;
BEGIN
  IF NEW.control_snapshot IS NOT NULL AND NEW.control_snapshot NOT IN ('null'::jsonb, '{}'::jsonb) THEN
    RETURN NEW;
  END IF;
  bound_aircon := ecotrack_private.monitoring_measurement_aircon(NEW);
  IF bound_aircon IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.* INTO ac FROM public.aircons a WHERE a.id = bound_aircon;
  NEW.aircon_id := bound_aircon;
  settings := jsonb_strip_nulls(jsonb_build_object(
    'desired_state', CASE WHEN ac.commanded_at <= NEW.observed_at THEN ac.desired_state END,
    'commanded_at', CASE WHEN ac.commanded_at <= NEW.observed_at THEN ac.commanded_at END,
    'command_id', CASE WHEN ac.commanded_at <= NEW.observed_at THEN ac.command_id END,
    'command_status', CASE WHEN ac.commanded_at <= NEW.observed_at
      THEN CASE WHEN ac.command_status_at <= NEW.observed_at THEN ac.command_status ELSE 'queued' END END,
    'reported_state', CASE WHEN ac.reported_at <= NEW.observed_at THEN ac.reported_state END,
    'reported_at', CASE WHEN ac.reported_at <= NEW.observed_at THEN ac.reported_at END));

  controller := coalesce(nullif(ac.controller_node_id, ''), ac.node_id);
  SELECT d.* INTO device FROM public.ecotrack_device_state d WHERE d.node_id = controller;
  frame := device.latest_ir;
  IF frame->>'frame_kind' = 'settings_only' OR jsonb_typeof(frame->'state') IS DISTINCT FROM 'object' THEN
    frame := frame->'last_decoded';
  END IF;
  IF jsonb_typeof(frame->'state') = 'object'
     AND frame->>'frame_kind' IS DISTINCT FROM 'settings_only'
     AND frame->>'protocol' ~ '^[A-Z][A-Z0-9_]{1,48}$'
     AND frame->>'protocol' <> 'UNKNOWN'
     AND (frame->>'raw_data' ~ '^[0-9]+(,[0-9]+)+$' OR frame->>'raw_count' ~ '^[1-9][0-9]*$') THEN
    seen := ecotrack_private.analytics_state_time(coalesce(frame->>'received_at', device.last_seen::text));
    BEGIN
      captured := (frame->>'captured_at_epoch_ms')::numeric;
      IF captured > 0 AND captured <= 8640000000000000 AND to_timestamp(captured/1000) <= seen + interval '5 seconds' THEN
        seen := to_timestamp(captured/1000);
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
      NULL;
    END;
    IF seen > '1970-01-01T00:00:00Z'::timestamptz AND seen <= NEW.observed_at THEN
      SELECT jsonb_object_agg(field.key, field.value), jsonb_object_agg(field.key, field.observed)
      INTO remote_fields, remote_times
      FROM (
        SELECT f.key, f.value, coalesce(nullif(ecotrack_private.analytics_state_time(frame->'field_at'->>f.key),
          '1970-01-01T00:00:00Z'::timestamptz), seen) AS observed
        FROM jsonb_each(frame->'state') f WHERE f.key <> 'source'
      ) field
      WHERE field.observed <= least(NEW.observed_at, seen + interval '5 seconds');
      IF remote_fields IS NOT NULL THEN
        settings := settings || jsonb_build_object('observed_remote_state', remote_fields,
          'observed_remote_at', seen, 'observed_remote_protocol', frame->>'protocol',
          'observed_remote_field_at', remote_times);
      END IF;
    END IF;
  END IF;
  NEW.control_snapshot := nullif(settings, '{}'::jsonb);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION ecotrack_private.record_monitoring_ac_settings() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_ecotrack_monitoring_ac_settings ON public.telemetry;
CREATE TRIGGER zz_ecotrack_monitoring_ac_settings BEFORE INSERT ON public.telemetry
FOR EACH ROW EXECUTE FUNCTION ecotrack_private.record_monitoring_ac_settings();

COMMIT;
