# Mobile Home and Controller Registration
Date: 2026-10-11 (Asia/Singapore)

## Result
Home controller cards are retained. Device Management is retained and registration now presents the desktop's three stages: Bluetooth, Wi-Fi, Details. The separate mobile Aircon Control page remains removed.

The Android bundle and replacement Expo APK build are verified. Expo reported FINISHED at 2026-10-11 18:43:14 Asia/Singapore; Gradle completed successfully in 12m 10s. The first submitted build (2d5cc310-9abf-4d6c-bf21-728cf38684cc) was canceled after archive inspection found Git metadata. The corrected .easignore pattern excludes .git itself. The replacement archive passed all checks before submission.

## Findings and changes
- Cloud hardware status was restricted to administrators. Staff could read assigned device metadata but received no hardware rows; Home interpreted that absence as Offline.
- The supplied SQL adds SELECT access to ecotrack_device_state for active, authenticated staff whose current assigned room contains that node. Existing administrator access remains. It grants no cloud command, registration, credential or global private Broadcast access.
- The user returned the expected policy expression from Supabase SQL Editor. Deployment is user-confirmed; we have not independently tested a production staff session.
- Missing hardware evidence now displays Status unavailable. Actual fresh heartbeats determine Online; heartbeat age and sleep determine Offline/Sleeping. AC power is a separate field.
- Receiver updates merge directly into the linked Home card using existing per-field timestamps. Older rows and full fetches cannot overwrite newer receiver observations. Metadata events still refresh inventory.
- The open details sheet derives its controller from current Home data. Heartbeat freshness is reevaluated every 15 seconds when Auto Sync is enabled. The existing regular refresh remains a fallback.
- Controller names use the administrator's saved device name. Locations, hardware identity, AC type, reported state and special functions remain data-driven.
- Cards and details separate Power, Operating mode, Blower fan and Target setpoint. Active special functions are included. Missing battery data is neutral; actual 0% is preserved.
- Card labels, AC model and location wrap. The details sheet scrolls with a fixed close button. No combined clipped Offline/OFF/mode string or misleading Alert/LIVE badge remains.
- Registration reuses existing BLE, Wi-Fi, cloud verification, custom AC naming and deployment logic. Connecting belongs to Bluetooth; verification belongs to Wi-Fi; naming/success belongs to Details. The Register action is shown only to administrators, consistent with existing server authorization.
- Home navigation remains available if an open controller disappears. Home's animation is disposed on unmount.

## Validation
- Full TypeScript check: passed.
- Scoped ESLint: zero errors. Existing files have 32 warnings in total; new components and state/display helpers have zero warnings.
- Final focused regression run: 119 passed, zero failed, run with --test-concurrency=1.
  - 71 existing registration, device integration, cloud hardware and render regressions.
  - 8 Home state/registration display regressions.
  - 6 disposable PostgreSQL hardware policy access tests (migration applied twice).
  - 34 database contract regressions using the complete prerequisite fixture.
- A preliminary parallel run exceeded local memory. The sequential final run passed. The database fixture was also extended with the installed cloud hardware prerequisite.
- Android Expo export: passed; Hermes bundle produced.
- Archive verification: 13 source/config hashes match tested files; .env, .git, agent instructions, tests, reports and local artifacts are excluded.
- Browser layout checks: real component JSX with React Native Web styles, fixture data and stub icons/safe-area wrapper; dark/light, 390px normal text and 320px at 1.35 text scale. All 12 fixtures had no horizontal overflow; all details variants had a scrollable body. Screenshots inspected for narrow Home card, details and registration stages.
- Physical Android device, safe-area insets, keyboard behavior, BLE discovery, real Wi-Fi provisioning, fresh remote-to-phone delivery and production staff login: not exercised here. Automated checks use controlled fixtures, not physical AC evidence.

## Evidence
Mobile repository: C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control
- artifacts/mobile-home-final-tests.log
- artifacts/mobile-home-typecheck.log
- artifacts/mobile-home-eslint.json and mobile-home-index-eslint.json
- artifacts/mobile-home-android-export.log
- artifacts/mobile-home-archive-verification.json
- artifacts/mobile-home-visual/ (12 HTML fixtures)
- artifacts/mobile-home-eas-build-final.json and mobile-home-eas-build-final.log
- supabase/migrations/202610110001_assigned_staff_hardware_read.sql

Desktop report folder:
- APPLY_SUPABASE.sql
- before/ starting copies of edited existing files
- CHANGES.diff
- verification/ selected checks and browser measurements

## Expo APK
- Build: 60237599-4f05-4c1f-8bad-a30fdf2b9860, Android, preview/internal APK, FINISHED.
- [Expo build](https://expo.dev/accounts/rey12345/projects/ecotrackapp/builds/60237599-4f05-4c1f-8bad-a30fdf2b9860)
- [Download APK](https://expo.dev/artifacts/eas/WJ9RLUZvY6_INL5UGovMlKzRzNbZ3eOcTYHNyVyBDbM.apk)
- Local: C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/EcoTrack-mobile-home-registration-20261011.apk
- Package: com.ecotrack.app; existing signing credentials reused.
- Bytes: 112398286
- SHA-256: 9f392c84092acee9adaa3335a76d8e83ed5689ba9c16289125f093a0b00d21ef
- All APK ZIP members passed integrity checks. Manifest, DEX, Bluetooth scan/connect and location permissions are present.
- Architectures: arm64-v8a, armeabi-v7a, x86, x86_64.
- Updated registration, setpoint, fan and unavailable-status labels are present in the bundled app. The removed AC Remote Controls label is absent.
- APK signing block is present; independent cryptographic signature verification was not performed.
- Evidence: verification/mobile-home-apk-verification.json and mobile-home-eas-status.json.

## Phone follow-up
Install this APK and sign in with the current assigned-room staff account. Compare Home with the desktop while the controller is online and the AC is OFF, then press the physical remote and confirm power, mode, fan and setpoint change without reloading. With an admin account, exercise Bluetooth discovery, Wi-Fi setup and saving controller/AC profile details against the real ESP32. These physical checks remain pending.

