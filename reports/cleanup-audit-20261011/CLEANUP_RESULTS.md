# Approved cleanup results

Date: October 11, 2026 (Asia/Singapore)

**PASS: all 5,269 approved Group A files were deleted, totaling 1,618,519,617 bytes (approximately 1.62 GB / 1.51 GiB).** No files failed deletion or were skipped. Sizes reflect removed files' logical byte sizes; actual reclaimed disk space may differ.

| Project | Deleted files | Removed bytes | Approximate size |
|---|---:|---:|---:|
| Desktop | 3,800 | 736,385,883 | 736 MB |
| Mobile | 1,469 | 882,133,734 | 882 MB |
| Total | 5,269 | 1,618,519,617 | 1.62 GB |

## Authorization and scope

You approved the recommended Group A list with **“delete them”**, after receiving the report and exact file list. Approval was applied to A01–A07 only. Optional Group B items were retained.

Deleted files were regenerable firmware compiler intermediates, isolated desktop test profiles, Python bytecode, five older APKs, generated Expo exports/upload copies, earlier build checks, and local Expo caches. Only individual reviewed files were removed with native PowerShell and literal paths. No recursive folder deletion was used; empty directories may remain.

## Preservation verification

| Check | Desktop | Mobile | Result |
|---|---:|---:|---|
| Approved files matched reviewed size and SHA-256 before deletion | 3,800 | 1,469 | PASS |
| Remaining project files matched their pre-cleanup SHA-256 | 1,235 | 493 | PASS |
| Protected SQL/templates/query-bearing files matched the original audit and pre-cleanup SHA-256 | 68 | 27 | PASS |
| Missing required retained paths | 0 | 0 | PASS |
| Deleted files unexpectedly still present | 0 | 0 | PASS |

All **95 protected SQL/query files** remain unchanged. The remaining-file check excluded primary dependency/Git/virtual-environment trees and this audit-output folder; those directories were outside every deletion scope and their required paths still exist.

Active application source, configuration, databases and backups, dependencies, agent instructions, original firmware and retained flash images were preserved. Optional tools, research artifacts, starter components and historical backups were retained. Both mobile installers remain:

- `artifacts/EcoTrack-mobile-home-registration-20261011.apk` — latest delivery.
- `artifacts/EcoTrack-mobile-ui-cleanup-20261011.apk` — immediate fallback.

## Project validation

- **Desktop: PASS.** Existing `npm test` integrity audit: 34 passed, 0 failed.
- **Mobile: PASS.** Existing `npm run typecheck`: exit code 0.
- Interactive UI, physical Bluetooth/IR behavior and a new cloud build were not exercised for this file cleanup. No source behavior changes were made.

## Execution decision and evidence

**COMPLETE.** The pre-cleanup decision was READY_TO_IMPLEMENT: the exact Group A scope had user approval, all candidates matched the reviewed manifest, and the protected paths passed checks. There were no open decisions or scope expansions.

Evidence in this folder:

- `cleanup-proposal.json` and `file-list.csv` — original reviewed manifest, unchanged.
- `protected-query-manifest.json` — original 95-file preservation manifest.
- `desktop-preflight.json` / `mobile-preflight.json` — candidate checks and remaining-file hashes.
- `desktop-deletion-results.json` / `mobile-deletion-results.json` — outcome for every reviewed file.
- `desktop-post-cleanup.json` / `mobile-post-cleanup.json` — preservation verification.
- `desktop-validation.log` / `mobile-validation.log` and matching JSON files — observed check results.
- `execute-approved-cleanup.ps1` — exact execution and verification procedure; a second deletion run is blocked when results already exist.
