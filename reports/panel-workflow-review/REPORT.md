# EcoTrack desktop and mobile: panel workflow, fetching and error review

Reviewed on 12–13 October 2026, Asia/Singapore.

## Executive Summary

Targeted fetching, loading and error-handling fixes were applied to both repositories. The desktop query engine now shares concurrent reads, preserves newer requests and stops hung queries. Mobile reads have deadlines, fewer pagination requests and consistent first-load skeletons. Both apps retain valid content during refresh.

The main panel-visible fixes are: incorrect “Unassigned” during Home loading; false zero device counts after a failed read; stale staff appearing after an empty database response; invented staff location defaults; staff seeing an administrator-only registration action; loading placeholders persisting indefinitely; and cancellation/retry behavior that could repeat requests.

Controlled request counts improved from **14 to 8 for mobile Home** and **11 to 6 for Devices**. These are request counts against fixtures, not measured production latency.

The project is **not certified fully demo-ready**. The broad legacy regression command still has **156 passes / 41 failures**, identical to the initial baseline. Native Electron startup, the installed Android APK and physical Bluetooth/Wi-Fi/IR behavior require the follow-up checks below.

## Repository/Architecture Inspection

| App | Repository | Main architecture |
| --- | --- | --- |
| Desktop | C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control | Electron renderer, authenticated IPC, Supabase metadata/hardware state, Flask + local SQLite telemetry, local Random Forest estimates |
| Mobile | C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control | Expo SDK 57 / React Native, Supabase Auth/RPC/RLS, staff assignment and maintenance, administrator Bluetooth/controller setup |

The [versioned Expo 57 documentation](https://docs.expo.dev/versions/v57.0.0/) was read before implementation. Existing source changes, configuration, dependencies, firmware and real records were preserved. No commit, migration or deployment was performed.

~~~mermaid
flowchart LR
  D[Desktop administrator] --> S[Supabase Auth, records and commands]
  M[Mobile staff / administrator] --> S
  M --> B[Bluetooth setup on a real phone]
  B --> E[ESP32 controller]
  E <--> S
  E --> A[AC via supported IR protocol]
  S --> F[Desktop Flask telemetry synchronization]
  F --> Q[Local SQLite]
  Q --> L[Daily Logs and exports]
  R[Random Forest service] --> L
  S --> N[Maintenance and notifications in both apps]
~~~

Connectivity, requested settings, transmitted IR and physically confirmed AC operation are separate states.

## Requirements/UI Specification

The authorized scope was to inspect both apps, simulate panel workflows, improve fetching, add consistent loading skeletons, improve error handling and provide a report with repair guidance.

The existing screens, theme, navigation and layout were the UI reference. No separate UI_SPEC or DESIGN_SPEC was supplied. UI changes were limited to loading, truthful unavailable states, retry messages and role-appropriate empty states.

The repository prompt-enhancer, full-webapp-lifecycle, web-app-builder, debug-and-rebuild, browser-qa-tester, ui-spec-enforcer, api-database-tester, code-reviewer, security-reviewer and final-report-generator skills guided the work. They are in the desktop repository’s .agents/skills folder.

## Implementation Changes

### Fixed findings

| Priority | Finding and panel impact | Correction and evidence |
| --- | --- | --- |
| P1 | Two desktop callers requesting the same query cancelled one another. A cancelled scheduler read could return null, while an old rejection could remove the newer read’s tracking. | Shared per-key read promises; replacement bookkeeping is checked by controller identity. Reproduced before fixing; focused tests pass. [eco-data-bus.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/eco-data-bus.js:156) |
| P1 | Hung reads could leave a list loading indefinitely. | Desktop query deadline: 15 s; prediction request/body deadline: 15 s; telemetry request timeout: 8 s; paged mobile reads: 15 s; mobile read scopes/notification loads: 20 s. Late results cannot commit after the deadline. [query-utils.ts](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/services/query-utils.ts:18) |
| P1 | The desktop network helper existed privately but was never exported. Pages using window.EcoNetwork silently fell back to raw fetch. | Exported the shared helper and connected the Daily Logs loaders to it. [eco-network.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/eco-network.js:740) |
| P1 | Default retries were disabled only for exactly “POST”; lowercase POST, PUT, PATCH and DELETE could be sent again after a network failure. | Automatic retries are limited to GET/HEAD. Caller cancellation ends the request without retrying. [eco-network.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/eco-network.js:177) |
| P2 | Mobile Home showed “Unassigned” before its room query completed, even for an assigned worker. | Assignment loading has its own skeleton and “Checking assignment” state. Read failure is not converted into an unassigned result. Verified in the actual web bundle at 390 px dark and 320 px light. [index.tsx](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/app/index.tsx:293) |
| P2 | Devices showed zero Total/Online/Offline when the first query failed, suggesting the fleet was empty. | Counts show “—” until a successful snapshot exists. A failed background refresh retains the prior successful counts and list. Verified in the browser error/retry flow. [devices.tsx](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/app/devices.tsx:112) |
| P2 | A successful empty staff response was rejected as incomplete, causing old cached staff to reappear. | Empty arrays are accepted as authoritative success. No second fallback request follows a successful empty IPC response. [staff.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/staff.js:160) |
| P2 | Missing staff assignments were displayed using invented building/floor/“Server Room A” defaults. | Missing assignment fields remain empty/Unassigned; stored real assignment names are preserved. [staff.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/staff.js:115) |
| P2 | Skeletons could replace already-loaded content during refresh or remain forever when a manual loader never settled. | Shared desktop skeletons preserve rendered content, expose aria-busy and fall back to a safe retry state after 20 s. Table errors retain a valid table row/column structure. [skeletons.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/skeletons.js:13) |
| P2 | Mobile notification refreshes could overlap. | Reused the refresh coordinator to serialize reads, retain one follow-up and preserve recipient-state revisions during mutations/account changes. [use-mobile-notifications.ts](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/hooks/use-mobile-notifications.ts:49) |
| P2 | A staff user with an empty device list was offered administrator-only controller registration. | Empty-state registration appears only for administrators; staff receive assignment guidance. Verified with an isolated staff session. [devices.tsx](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/app/devices.tsx:1170) |
| P2 | The offline banner promised that changes would synchronize later, without establishing a durable write queue. It also blocked the local backend merely because internet connectivity was absent. | Banner now explains that cloud changes require a connection. Loopback backend reads are permitted; cloud requests still fail explicitly when offline. [eco-network.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/eco-network.js:185) |
| P2 | Loading-error HTML embedded unescaped error text and retry behavior could cache a reload as query success. | Error text uses textContent; retry uses a callback/reload rather than a fake query. Browser check confirms HTML-like error text does not create an image/handler. |
| P2 | Failed Daily Logs reads could be visible only in the console. | Added a persistent inline error/retry message; valid previously loaded records are retained. [logs.js](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/logs.js:904) |

### Fetching and loading improvements

Mobile pagination uses the first page’s RLS-filtered exact count to avoid a final empty request. A missing count retains the prior cursor-based fallback, including server-shortened pages. Row identity validation and room/client separation remain in place. Hardware-state pagination has the same safeguard.

Home, Devices, Maintenance and Notifications now share [data-list-skeleton.tsx](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/src/components/data-list-skeleton.tsx). It follows the existing light/dark palette, respects reduced motion and exposes an accessible loading state. Background refreshes keep the existing list.

| Controlled refresh | Before count-aware reads | After | Reduction |
| --- | ---: | ---: | ---: |
| Assigned-room Home | 14 | 8 | 42.9% fewer requests |
| Devices + room options | 11 | 6 | 45.5% fewer requests |

Outputs were compared for equivalence. Exact counting has a database cost; network latency and production table sizes still need measurement before claiming a time improvement.

## Build and Static Verification

| Check | Actual result | Status |
| --- | --- | --- |
| Mobile TypeScript --noEmit | Completed without errors | PASS |
| Lint: shared skeleton, notification hook, query utility and hardware read service | 0 errors / 0 warnings | PASS |
| Desktop changed JavaScript syntax | Parsed successfully | PASS |
| Expo web export | Final web bundle produced | PASS |
| Expo Android export | Final Hermes .hbc bundle produced | PASS |
| APK assembly/install | No APK was assembled or installed in this task | NOT RUN |
| Whole desktop diff whitespace | Check passed; line-ending warnings only | PASS |
| Whole mobile diff whitespace | Existing firmware/profile/icon/device-service whitespace appears in the repository diff | FAIL, existing |
| Task whitespace | Checked against the saved task snapshot; unrelated whitespace was preserved | See evidence summary |

The final web/Android export is in C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/panel-workflow-review/build. A compiled bundle is not an installed or physically tested Android app.

## Browser/Functional Testing

The harness runs the actual exported mobile app and desktop renderer pages in Chrome with fresh browser storage. Cloud APIs are intercepted, WebSockets are closed and unexpected remote writes are blocked. Test people/controllers exist only in fixtures.

The panel simulation completed **22 checks with zero page runtime errors**:

- Mobile Home, Devices, Maintenance and Notifications: initial skeletons settle into loaded or empty states.
- Devices: failed first load shows retry; retry recovers; failed first-load counts are unavailable.
- Staff device empty state does not offer administrator registration.
- Home at 320 px/light theme: assignment loading remains truthful; no horizontal page overflow.
- Twelve desktop pages: Dashboard, Aircons, Control, Nodes, Telemetry, Scheduler, Rules, Staff, Notifications, Logs, Predictions and Profile opened without page runtime errors.
- Shared desktop skeleton: background refresh retains content; failure removes table placeholders and renders safe error text with retry.

Desktop page smoke checks do not prove authenticated Electron IPC, live saves or hardware operation. Global cloud failures are controlled fixtures, not an audit of the deployed service.

The separate Random Forest browser harness also passed **7 page/theme/viewport scenarios**, including the real local prediction backend with a temporary database.

Evidence: [browser/results.json](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/panel-workflow-review/browser/results.json), [RF browser results](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/research-energy-model/frontend/browser-results.json).

## UI Verification

Inspected actual screenshots of dark Home loading, populated Devices, the Devices retry state and 320 px light Home loading. The layout/navigation remained recognizable; skeletons use neutral shapes rather than invented readings.

Screenshots:
- [Mobile Home loading, 320 px/light](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/panel-workflow-review/browser/mobile-home-loading-320-light.png)
- [Mobile Devices populated](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/panel-workflow-review/browser/mobile-devices-loaded.png)
- [Mobile Devices error](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/panel-workflow-review/browser/mobile-devices-error.png)
- [Desktop skeleton](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/panel-workflow-review/browser/desktop-loading.png)

Phone safe-area behavior, native font scaling, hardware keyboards and accessibility announcements were not physically tested.

## API/Database Verification

- Fifteen prediction API tests passed against a temporary SQLite database.
- Fourteen mobile Home/hardware policy and display tests passed using isolated fixtures/test database boundaries.
- Fetch tests check RLS-filtered row counts, server-shortened pagination, room/client separation, reassignment, timeouts, late responses and newer maintenance saves.
- Notification tests preserve authenticated recipient-state RPC behavior, committed read/snooze/archive state and account-switch isolation.
- No real Supabase/SQLite rows were inserted, deleted or rewritten. No schema/RLS weakening, hardware command, firmware flash or real telemetry fabrication was performed.

## Debugging/Rebuild History

1. Captured repository status and a 15-file pre-change snapshot before the first implementation edits.
2. Reproduced duplicate desktop reads, obsolete request cleanup and redundant mobile terminal pagination.
3. Implemented focused fixes and ran the narrow checks.
4. Updated affected test harnesses to provide native timer/AbortController globals and current fixture fields; maintained meaningful assertions rather than suppressing failures.
5. Simulated actual mobile screens, which exposed the false Unassigned state and failed-read zero counts.
6. Corrected those states and rebuilt.
7. Android compilation initially failed because the sandbox denied the installed Hermes executable. The local compiler ran successfully with authorized elevated execution; the final offline export passed.
8. Re-ran the final browser and targeted checks. The initial and final broad regression counts remained the same.

Backup: [EcoTrack_Before_Panel_Loading_Fixes_20261012.zip](C:/Users/reygay/Documents/Codex/2026-10-10/referenced-chatgpt-conversation-this-is-an/outputs/EcoTrack_Before_Panel_Loading_Fixes_20261012.zip). It covers the 15 files listed in its SHA256 manifest, not every file in either repository.

## Security Review

The changes retain authentication, RLS, RPC ownership and existing hardware command boundaries. Shared query cache is cleared when account identity changes; private query-success payloads are no longer broadcast across windows. Default retries cannot silently repeat writes. Loading error text is inserted safely.

This was a scoped review, not a penetration test or dependency vulnerability certification. Real deployed RLS, recovery email delivery and privileged writes were not exercised.

## Code Quality Review

Existing read scopes, refresh coordinator, styles and app structure were reused. No dependency upgrade or alternate framework was introduced. Polling frequency, model training, cloud migrations and firmware behavior were not changed.

Cancellation, timeout, empty response and retry tests exercise observable behavior. New source helper lint is clean. Broad pre-existing animation/ref/style issues were not rewritten as part of this task.

## Regression Testing

| Check | Actual | Status |
| --- | --- | --- |
| Desktop query/network/staff loading tests | 8 passed | PASS |
| Mobile fetching + notifications + deadline tests | 38 passed | PASS |
| Mobile Home/hardware policy/display checks | 14 passed | PASS |
| Prediction API tests | 15 passed | PASS |
| Daily Logs stability | Passed: stale predictions, bounded model requests, retained values, charts and refresh coalescing | PASS |
| No-mock-data integrity | 34 checks passed | PASS |
| Panel browser simulation | 22 checks; zero page runtime errors | PASS |
| RF browser simulation | 7 scenarios passed | PASS |
| Broad mobile package test:backend | Before: 156 pass / 41 fail; final: 156 pass / 41 fail | FAIL, existing |
| Desktop runtime engine / dashboard workflow tests | Missing cadence expected 30 s but implementation returns 15 min | FAIL, existing |

The 41 failures are not 41 confirmed production bugs. The suite includes desktop startup/control harnesses and older energy prediction fixtures that no longer match the current implementation. Some failures require requirements review; others require fixture updates. They remain visible in the evidence rather than being converted to passes.

## Final Acceptance Matrix

| Requirement | Result |
| --- | --- |
| Review both specified repositories | PASS |
| Find and document panel-visible bugs | PASS |
| Reduce duplicate/unnecessary reads | PASS in controlled fixtures |
| Consistent first-load skeletons | PASS for the main mobile data lists and shared desktop loading system |
| Preserve loaded data during refresh | PASS in focused/browser tests |
| Handle offline, timeout, retry, empty and stale responses | PASS for the affected shared paths |
| Compile mobile web and Android source | PASS |
| Simulate software workflows | PASS within intercepted browser/API boundaries |
| Full deployed desktop/mobile/hardware end-to-end | NOT RUN |
| Clean exhaustive regression suite | FAIL: existing baseline remains |

## Known Limitations/Remaining Work

### Before the panel demonstration

1. **Native desktop startup — high priority.** An earlier run failed in Electron’s Windows installation/sandbox ACL check before application code executed; [the existing report records it](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/research-energy-model/REPORT.md:123). This pass used Chrome renderer simulations. Repair/verify the Electron installation using the locked dependency version, then test a clean temporary profile, launch twice and confirm the existing window is focused. Native startup was not rerun here; the previous crash is not claimed fixed.
2. **Install a freshly built mobile APK.** Older APKs do not contain these source changes. Build the existing preview profile, inspect its signing/version and install it on the panel phone. This task produced web/Hermes exports, not a new APK.
3. **Physical commissioning/control.** On a real Android phone, test Bluetooth/location permissions, scan, three-stage registration, Wi-Fi failure/retry, verified cloud heartbeat, exact IR capture/protocol, queued/transmitted acknowledgement and actual AC response. Browser fixtures cannot validate this.
4. **Resolve regression contracts.** Reconcile the missing-cadence 30 s versus 15 min rule with recorded firmware cadence and gap handling. Update stale prediction/control/startup fixtures to the current contract; fix any failures that remain reproducible with current services. Do not alter runtime merely to satisfy an old assertion.
5. **Production error/role checks.** Verify a staff account, administrator account, archived account and unassigned worker against deployed RPC/RLS. Check denied saves, conflict responses, successful cross-app refresh and recipient-only notification changes.

### Remaining performance work

- Daily Logs still requests complete history with perPage=0 and filters in the browser. As telemetry grows, move to indexed date-window/incremental reads while preserving previous-period comparisons and boundary samples. Simply limiting the response would corrupt runtime/energy coverage.
- Maintenance first load still waits for private photo URL signing. Consider lazy signing when a report is opened, preserving storage references and authorization.
- Capture request timings on the actual Wi-Fi/cellular connection. Request-count reductions alone do not guarantee faster elapsed load time.

### Panel walkthrough

| Step | Desktop / mobile action | What the panel should observe |
| --- | --- | --- |
| 1 | Start the desktop backend; verify health; sign in with authorized accounts | Available service/session; clear login failure for invalid access |
| 2 | Desktop admin creates/chooses real building, floor, room and assigns the worker | Mobile assignment resolves to that room; Unassigned appears only when actually unassigned |
| 3 | Mobile admin commissions the ESP32 using the three registration stages | Permissions/errors are explicit; verified heartbeat precedes saved registration |
| 4 | Desktop views linked AC/controller and captures an actual remote frame | Exact supported protocol/capabilities; unsupported controls remain unavailable |
| 5 | Submit a supported setting; observe command stages and actual AC | Queued/transmitted acknowledgement is distinct from confirmed physical operation |
| 6 | Open telemetry/Daily Logs and choose forecast conditions when needed | Missing measurements remain unavailable; research energy estimates are labeled estimates |
| 7 | Desktop assigns maintenance; staff completes permitted work; desktop verifies it | Server-confirmed status and conflict/retry behavior; both apps refresh |
| 8 | Review recipient notifications, filter logs and export | Read/archive changes affect the correct recipient; exports use current completed analytics |

The current electricity model estimates a Haier reference unit using research-informed generated training rows. Its accuracy on the actual panel AC has not been physically validated. A saved schedule projection is not measured runtime, and online hardware alone does not prove the AC is on.

## Conclusion

The requested fetching, loading and error-handling improvements are implemented and tested within software simulation boundaries. The remaining work above is necessary before claiming a complete real-device panel demonstration. Restart/reload the desktop after applying source changes and use a freshly rebuilt mobile APK for phone testing.

