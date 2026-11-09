# SDD ledger - plan: docs/superpowers/plans/2026-11-02-ac-command-schedules.md

Implementation authorized by user on 2026-11-02. Current scope: AC Device Scheduler and Notifications only. Existing feature/agent-skills checkout retained to preserve extensive uncommitted user work. No commits, pushes, firmware/mobile edits or live cloud activation.

| Task/interface | Preflight result |
| --- | --- |
| Backend -> scheduler UI | One agreed list RPC returns schedules, automation, runs, devices, health. Save/version/enable/archive contracts shared in agent briefs. |
| Backend -> notifications | Type ac_command_schedule, schedule_event snapshot and one event_key per run. Status updates replace the same row. |
| UI -> notifications deep link | scheduler.html?view=commands&node=...&schedule=... |
| Task 1 storage | Additive schema with admin-only RPCs/RLS and exact capability validation. No destructive history changes. |
| Task 2 enqueue | Prefer a new private scheduler enqueue helper; keep existing ecotrack_cloud_request and device_exchange unchanged. Existing node locks/manual superseding semantics are reused. |
| Task 3 evaluator | Deterministic occurrence IDs, latest due preset wins, manual precedence, two-minute due-based expiry, no replay, unknown delivery separated. |
| Tasks 4-5 UI | New scoped CSS/JS and two-page-only integration; Aircon Control card removed from implementation scope. |
| Task 6 notifications | Every-trigger inbox policy supersedes earlier exception-only policy; popup only actionable problems, no rule-compliance side effects. |

Ruling: Latest explicit implementation request supersedes the planning-only global constraint, while no production activation is inferred from writing/testing the feature.
Ruling: Reuse the current feature checkout under the developer preference; a HEAD-only worktree would omit the current application changes.
Ruling: Use a new private schedule enqueue path instead of refactoring the existing manual cloud RPC wherever possible; inspect and regression-test shared queue behavior.
Ruling: Parallel agents own disjoint files and one shared contract. Review integrated changes with fresh reviewers after implementation.

Progress: baseline captured; implementation dispatched next.
Implementation completed in code; final verification and rollout report in progress. Resume from CHECKPOINT.md; do not repeat completed work.
Local implementation and verification complete. Report and rollout guide saved. Final checkpoint appended; no live activation or hardware commands.

2026-11-02 13:57 Asia/Singapore: user requested completion of missing live setup. Both exact scheduling migrations applied to configured project ynopdmfhngooknybyahq; Cron active and three automatic runs succeeded. Managed cron.job direct-write restriction reproduced RED and fixed with cron.alter_job; SQL20PASS. Authenticated current-session list/health/RLS reads and unauthenticated REST denial PASS. Existing manual/exchange/validator/admin functions and two existing Cron jobs unchanged. No schedules or device test commands created. Migration filenames aligned with remote versions20261102055137 and20261102055353. Current checkpoint supersedes earlier no-live-activation ruling; cloud setup is complete. Physical pilot remains unperformed.
