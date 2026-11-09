# EcoTrack data flow diagrams

Updated 6 November 2026 after inspecting the current desktop, mobile, firmware and cloud scheduling source. Level 0 retains the previous single-process context design. Level 1 retains the previous left-hand entities, central process column and right-hand data store, with eight numbered processes. Arrow labels use short phrases.

**Role correction supplied by the user:** administrators use the desktop application; assigned staff use the mobile application. No administrator role is shown in mobile. The software boundary includes both applications, their cloud services, the desktop backend and local data storage. The ESP32 and its optical/IR peripherals are external hardware relative to this software boundary.

## Level 0 — context

![EcoTrack Level 0 DFD](diagrams/ecotrack-dfd-level-0.png)

[Editable SVG](diagrams/ecotrack-dfd-level-0.svg)

The administrator supplies credentials, device/location registrations, controls, inbox/rule changes, maintenance assignments and review decisions, report/cost inputs, and device hours or AC presets. EcoTrack returns access, inventory, RPM and reported charge state, native alerts, work/repair results, reports and automation run status. Mobile staff submit sign-in data, assigned-room setup, status queries, inbox actions, work evidence and explicit verification submissions. They receive permitted devices, status, notices, tasks and review outcomes.

The ESP32 receives provisioning, manual control/capture requests, timed commands, device wake/sleep/reporting configuration and upload receipts. It returns its identity, rotation RPM, battery/heartbeat metadata, IR observations and command receipts. Cloud scheduling and rule evaluation run within the software boundary.

## Level 1 — decomposition

![EcoTrack Level 1 DFD](diagrams/ecotrack-dfd-level-1.png)

[Editable SVG](diagrams/ecotrack-dfd-level-1.svg) · [Editable Mermaid sources](diagrams/ecotrack-dfd-source.md) · [Canonical source](diagrams/ecotrack-dfd.canonical.json)

The Level 1 diagram uses aligned connectors, dark lines and filled arrowheads. Each of its 50 flows has a short, distinct label. Small bridges distinguish crossing paths. Process 8.0 makes timed AC automation explicit alongside the existing seven process responsibilities.

| Process | Responsibility | Data within the grouped store |
| --- | --- | --- |
| 1.0 | Authenticate users and enforce role/room access | Supabase Auth and profiles |
| 2.0 | Register devices and manage locations, bindings and assignments; serve assigned inventory | Supabase registry |
| 3.0 | Receive RPM and reported battery/charge state, archive observations and display permitted monitoring | Cloud live state/temporary telemetry and desktop SQLite history |
| 4.0 | Queue supported manual AC commands and learn/save infrared codes | Cloud device commands, AC desired state and IR profiles |
| 5.0 | Evaluate rules, maintain inboxes and deliver Windows/Android notices | Cloud rules, notifications, push registrations and delivery records |
| 6.0 | Assign maintenance and corrective repairs, save checklists/photos, accept explicit submissions and verify work | Cloud maintenance reports, linked repair tasks and image storage |
| 7.0 | Analyze retained observations, calculate available conditional cost estimates and export reports | SQLite recorded history and required cloud metadata |
| 8.0 | Save timed presets, pause/resume automation, evaluate due commands and reconcile their run outcomes | ac_command_schedules, ac_command_automation, ac_command_schedule_runs, device commands and receipts |

The Level 1 layout follows the previous diagram and supplied example. Users and hardware sit on the left, numbered processes run down the centre, and data storage sits on the right. D1 groups the related records described above. Shared application data uses Supabase, and desktop history uses SQLite. Mobile accesses its permitted cloud records.

## New functions checked

- Timed presets and automation controls are implemented in [ac-command-schedules.js](../public/js/ac-command-schedules.js). The [schedule storage migration](../supabase/migrations/20261102055137_ac_command_schedules.sql) defines schedule, binding and run records. The [cloud evaluator](../supabase/migrations/20261102055353_ac_command_schedule_evaluator.sql) dispatches due work and reconciles matching receipts.
- Battery status is read from fresh heartbeat metadata by [battery-status.js](../public/js/battery-status.js) and the mobile battery adapter. Current firmware labels its source as mock in [the hardware README](../firmware/ecotrack_cloud_measurements/README.md).
- Desktop and mobile maintenance now distinguish saved checklist progress, technician submission and administrator approval. Corrective repair approval updates its linked parent task, and the parent report has its own submission/review. The [maintenance flow](../reports/maintenance-repair-20261104/MAINTENANCE_FLOW.md) records those handoffs.
- Desktop native notification delivery is handled by [system-notifications.js](../src/system-notifications.js). The mobile push worker delivers permitted staff notices through Expo and tracks their delivery results.

This update checked source paths and diagram rendering. Live device operation and current cloud deployment state were outside this documentation check.

## Hardware and storage interpretation

- The maintained hardware uses an ESP32-S3, optical rotation input on GPIO40 with a 20-notch wheel, IR receiver on GPIO4, IR transmitter on GPIO5, Wi-Fi and Bluetooth.
- MCP9808, measured outlet temperature and pressure sensing remain excluded. GPIO47/48 are unused. Current reported battery voltage, percentage and charging fields come from the firmware mock source.
- New cloud measurements keep `outlet_temperature_c: null`. AC target-temperature commands remain supported. Original queued readings and historical records retain their captured values.
- Rotation RPM and heartbeat connectivity do not prove AC power, compressor runtime or measured kWh. IR acknowledgment confirms the device's command handling, not the physical AC's reception.
- Durable measurement flow is **optical sensor → ESP32 buffer → Supabase temporary telemetry → verified desktop SQLite archive → monitoring/report APIs**. The backend acknowledges exact cloud readings only after archival; cloud rows are a delivery bridge rather than the permanent archive.
- Mobile uses permitted shared cloud records. The diagram does not add a direct mobile connection to desktop SQLite.
- Temperature-based sensor-energy estimates are unavailable for new readings without measured temperature. Control-history estimates retain their existing input/coverage requirements and remain estimates.

The current source was inspected in both application projects. Physical wiring and firmware installation are separate from these diagrams and source compilation.
