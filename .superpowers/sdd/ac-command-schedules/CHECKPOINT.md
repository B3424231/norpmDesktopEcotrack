# AC command schedules — current checkpoint

Updated: 2026-11-02, 13:57 Asia/Singapore. Local implementation AND live Supabase setup are complete. This supersedes earlier local-only/no-activation notes in progress.md and agent notes. The user's latest request to finish the missing cloud setup was carried through.

## Resume rules

- Workspace: C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control. Always pass this workdir; the environment path without -control does not exist.
- Branch feature/agent-skills has extensive pre-existing user changes. Never reset/overwrite them or apply unrelated pending migrations. No commit/push was made.
- Scope: AC Device Scheduler + Notifications and their new cloud helpers. Existing manual control, device hours, hardware exchange, telemetry, firmware, mobile and dependencies are unchanged.
- User requested durable checkpoints around 10% remaining tokens to avoid repeating work. Exact token meter is unavailable. Resume from this file and the linked reports; do not redo completed work after compaction/reset.
- There is no remaining code or cloud-install task. Do not reapply the two migrations. A physical AC pilot is not performed or claimed.

## Live setup — completed

Configured and verified project: ynopdmfhngooknybyahq, ACTIVE_HEALTHY, URL matches local .env. No secrets were printed.
Applied ONLY:
1. supabase/migrations/20261102055137_ac_command_schedules.sql
2. supabase/migrations/20261102055353_ac_command_schedule_evaluator.sql

Local filenames were renamed from their CLI creation timestamps to these exact versions assigned by live Supabase migration history. All test/report references were updated, preventing duplicate pending migrations.

Cron job ecotrack-ac-command-schedules is ACTIVE, every minute. Real automatic runs at 05:55, 05:56, 05:57 UTC (13:55–13:57 local) succeeded, latest health last_error=null. Existing mobile-push and command-cleanup jobs retain their original settings.

Installation found a real managed-platform restriction: direct UPDATE cron.job is denied. The evaluator transaction rolled back cleanly. Added a permission-boundary regression fixture/test (RED with original SQL); changed only registration to cron.alter_job(job_id := job,active := false); all20 database tests then PASS. Corrected evaluator migration applied successfully while inactive, verified zero schedules/runs, then activated through supported API.

Live verification:
- Active administrator list RPC, health and RLS reads PASS under authenticated role using an existing valid session context entirely inside a rolled-back SQL transaction. First probe omitted required session_id and correctly denied access; probe was corrected without changing auth functions.
- Actual REST RPC exists: unauthenticated configured-public-key request returns401/42501, not missing-function PGRST202.
- All4 new tables have RLS; anon list denied; authenticated private worker denied.
- Manual cloud RPC, device exchange, exact capability validator and admin helper hashes unchanged. Private schema ACL unchanged.
- Zero saved schedules, automation rows, run records, scheduled commands or schedule notifications at verification. NO live test data/device command was created.

Evidence: reports/ac-command-schedules/live-setup.json and live-setup-database-tests.log. Current report: REPORT.md; operational instructions and physical pilot: ROLLOUT.md.

## Implementation and already completed tests

- New runtime: public/js/ac-command-schedules.js, public/css/ac-command-schedules.css, public/js/schedule-notifications.js.
- Only4 existing app files changed against365-file baseline: public/scheduler.html, public/Notification.html, public/js/notifications.js, public/js/global-notifications.js.361unchanged,0deleted. Baseline/source-boundary JSON and originals saved in reports/ac-command-schedules.
- Modal, day/time/action/temp/mode/fan/safe specials, disabled drafts, Off without extras, per-device pause/archive, room filtering/deep links, health polling, retained history, typed every-trigger notifications and status modal.
- Actual capability validator/queue reused. Worker uses consistent node locks; manual precedence; latest due wins;120s due-based expiry; no old replay; exact receipt matching; unconfirmed claimed work; active mapped admin and session checks. Conservative complete safe special presets and unsafe carried-feature guards. Original firmware/manual functions unchanged.
- SQL20PASS after latest Cron fix. Focused JS9PASS; light/dark1460/390 scheduler and notifications browser PASS; actual browser→SQL RPC→worker→matching receipt→Notification modal PASS.
- Legacy device-hours browser4PASS; notification dismissal13, audit13, AC core39, hardwareDB30/client47, node schedule10, npm integrity48PASS. Native device-hours22baselinePASS. Do not repeat unchanged tests.
- Pre-existing unrelated harness failures: scheduler_device_identity VM lacks URLSearchParams; native control fixture urlParams undefined. Their production sources unchanged.
- UI screenshots: reports/ac-command-schedules/browser/{schedule-editor-dark.png,command-schedules-dark.png,notification-sent-dark.png}.
- Agent notes/reviews in reports/ac-command-schedules; prior agents complete. Root finalized engine and cloud setup.

## Remaining verification limits

Subsequent requested Protocol Studio expansion is also complete (2026-11-02). Only4layout class attributes in public/ir-library.html changed: remove1400px cap/extra top gap, fill available width/height, retain workspace scrolling. All scripts/IDs/handlers/text unchanged by source comparison. PASS24layout states and8existing actual Studio browser scenarios in both themes, plus whitespace. Evidence and source snapshot: reports/protocol-studio-layout-20261102/REPORT.md. No scheduler/database/Cron/hardware changes. Reload Studio; do not repeat completed work on resume.

Latest UI request completed (2026-11-02): fixed collapsed Choose selector/readability and expanded command table to fill the card with bottom pagination. Only new schedule CSS, one render-markup line and scheduler asset versions v=2 changed; byte comparisons confirm JS outside rendering/page markup otherwise unchanged. PASS36 full-style/dropdown layout states across320–1920px/both themes, existing command browser suite,3unit tests and4Device hours browser scenarios. Evidence and before snapshots: reports/ac-command-schedules/layout-20261102/REPORT.md. Reload page for v=2. No database/Cron/device commands changed; do not repeat these completed UI checks after reset.

Physical IR/AC behavior, real multi-session contention, reboot/lost-ACK physical duplicates, and a deliberate end-to-end real controller pilot remain untested. No claim of zero hidden bugs or physical exactly-once delivery. Refresh/Try again in Command schedules clears the prior missing-setup state. No extra approval, deployment or repeated investigation is pending.
