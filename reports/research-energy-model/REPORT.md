# Single Random Forest backend replacement

Completed 12 October 2026, Asia/Singapore.

The old three-artifact prediction service was replaced with one Random Forest
research-estimate service. The three original PKL files were removed only after
their recovery copies were verified against SHA-256 hashes.

## Changes

- backend/app.py: new prediction resources and health metadata; prediction URLs retained.
- backend/energy_prediction.py: cached pipeline loading, artifact/version validation,
  complete control input validation, explicit scenario selection and one-hour inference.
- backend/ml/research_random_forest/: compatible model, assumptions, source attribution,
  scoped input support, test predictions, metrics and prediction probes.
- scripts/train_energy_random_forest.py: reproducible training using the existing app environment.
- scripts/test_energy_prediction.py: forecast API, invalid-input, model persistence and isolation coverage.

The removed original files were hvac_consumption_model_randomforestregressionFinal.pkl,
hvac_decision_tree_model_decision_tree_regression Final.pkl and
hvac_xgboost_final_XGBoost_RegressionFinal.pkl.
Their backup, together with the original app.py, is at:

C:/Users/reygay/Documents/Codex/2026-10-10/referenced-chatgpt-conversation-this-is-an/outputs/EcoTrack_Old_Prediction_Backup_20261012.zip

## Training and result meaning

The new model was fitted with the project's existing Python 3.14.7,
scikit-learn 1.9.0, NumPy 2.5.2, pandas 3.0.5, SciPy 1.18.1 and joblib 1.5.3.
No dependency upgrades or downgrades were made.

Training: 12,320 generated rows. Validation: 2,464. Test: 3,712.
The best of two starting configurations was selected on validation MAE.
All saved test predictions were verified after reloading the exported pipeline.

Test MAE: 0.0830696546 kWh.
Test RMSE: 0.1184183493 kWh.
Test R²: 0.9549886428.
These scores compare with generated estimates, not independently measured AC energy.
The 319 original published observations remain separate and unchanged.

## API and boundaries

The model ID is random_forest. XGBoost and Decision Tree IDs are retired.
GET /api/prediction-features exposes required controls and the six modeled scenarios.
GET /api/prediction-metrics returns stored evaluation metrics with estimate provenance.
POST /api/predict-energy requires settings and scenario_id, and returns estimated
next-hour kWh. The full request example is in the model folder's README.md.

Every function state must be provided. Missing flags are not replaced by OFF.
Only the modeled 16–30 C integer grid and supported reference combinations are accepted.
Filter and other unmodeled functions are rejected. Numerical failures return unavailable
rather than fabricated zero energy. Model versions and checksums are verified before loading.

The environment scenario is explicitly assumed. Forecasts do not write sensor readings,
confirm AC-on state, accumulate measured energy, send hardware commands or modify telemetry.
The service is inspired by one Haier reference device and is not validated for every
IR-compatible brand/model.

## Verification

| Check | Status | Evidence |
|---|---|---|
| New prediction tests | PASS | 15 tests |
| Existing cloud telemetry tests | PASS | 10 tests |
| Existing no-mock-data audit | PASS | 34 checks |
| Existing schedule tests | FAIL, pre-existing | Same five failures reproduced with the backed-up original backend |
| Existing database tests | FAIL, pre-existing | Same seven failures reproduced with the backed-up original backend |
| Live app, cloud writes and physical hardware | NOT RUN | Validation used temporary SQLite databases and mocked networking |

The older failures occur because the current telemetry recording guard returns
200/skipped for OFF or unknown-power fixtures where the tests expect 201/insertion.
That telemetry behavior and those tests were not changed as part of this request.
The backend replacement did not change production database records, credentials,
firmware, dependency manifests or UI files. The subsequent frontend work is documented below.

## Frontend connection completed — 2026-10-12

Prediction Metrics, Daily Logs and PDF reports now use the single Random Forest model.
The shared public/js/energy-prediction.js client sends explicit settings and scenario_id,
validates the model response, and uses the configured backend address. No frontend requests
use the retired model ID or temperature/runtime-only payload.

The metrics page displays the actual stored test scores and 18,496 estimated training rows,
with the 12,320 / 2,464 / 3,712 train/validation/test split. The former Kaggle/damper/timestamp
description and production-accuracy claims have been replaced. Metric explanations distinguish
agreement with generated targets from real AC accuracy.

The new reference forecast form requires temperature, fan, mode, all six supported function
states and a chosen environment scenario. There are no automatic weather or function defaults.
Unsupported combinations return an explanation and remain unavailable.

Daily Logs uses reported or observed controls saved with each historical reading. Requested
settings do not backfill observed controls. Known control intervals use the existing bounded
runtime calculation; duplicate intervals do not double-count, and conflicting simultaneous
settings are excluded. The one-hour output is explicitly time-scaled as a static rate
approximation. It is not a transient HVAC simulation or measured interval energy.

Saved-schedule projections are separate assumptions about future operation. They now respect
the saved wake/sleep window, require complete controls and explicit power, and remain labeled
as projections. Confirmed runtime/telemetry calculations are otherwise preserved. Standby
energy is excluded from periods with no modeled operating hours.

Each chart allocates the energy associated with the controls during its interval, rather than
spreading a period total uniformly. Identical requests share an evaluation cache, requests
are bounded to three concurrent workers, and cancelled sessions cannot overwrite newer results.
Pending or mismatched filter results are excluded from PDF/Excel exports. PDFs reuse the
evaluated result instead of making a second obsolete prediction request; average estimated
power is labeled kW, not kW/h.

### Frontend verification

| Check | Status | Evidence |
|---|---|---|
| Random Forest API tests | PASS | 15 cases, temporary SQLite database |
| Logs stability and contract checks | PASS | RF payload, cancellation, concurrency, null ambient sensor, missing controls, partial intervals, duplicate/conflicting snapshots, schedule projection, chart allocation, export freshness |
| Historical climate state checks | PASS | 7 scenario groups |
| No-mock-data audit | PASS | 34 checks |
| Browser checks against the real RF backend | PASS | 7 isolated page/theme/viewport scenarios, including backend unavailable and unsupported inputs |
| JavaScript syntax and diff checks | PASS | Changed scripts parse; no whitespace errors |
| Runtime engine regression suite | FAIL, pre-existing | Missing cadence fixture expects 30 seconds; original code returns 15 minutes. Reproduced before edits |
| Dashboard workflow suite | FAIL, pre-existing | Same missing-cadence mismatch reproduced with logs.js from the frontend backup |
| Electron test launch | FAIL, environment | Windows rejected the checkout's Electron sandbox ACL before the test script could run |
| Full authenticated desktop app, cloud writes, physical AC | NOT RUN | Browser fixtures used an isolated headless Chrome profile and a private backend port |

The browser test fallback did not change Electron startup settings or filesystem ACLs.
Screenshots and structured results are in frontend/; browser-results.json records the successful
real-backend forecast (1.380 kWh for the selected reference scenario), model metrics, input
validation and unavailable states. Fixtures and test data stay outside production telemetry.

The existing runtime failures were documented rather than changing unrelated historical
cadence behavior. No credentials, production database rows, IR commands or firmware were changed.

Restart the running Flask backend and reload EcoTrack to load both changes. In Prediction
Metrics, select every control and the assumed environment before choosing Estimate One Hour.
In Daily Logs, choose an assumed scenario; incomplete recorded controls remain unavailable
and can be explored explicitly in the reference forecast form.

## Daily Logs display simplified — 2026-10-12

The user confirmed there are no meter readings and requested retaining estimates while
removing the large panel shown in their screenshot. That panel is removed. Required
conditions are now in collapsed Prediction options in the existing filter header; no
scenario is silently chosen. Long main-page model explanations were shortened, and
the cards use Estimated Energy / Estimated Cost or Forecast Energy / Forecast Cost.
The expanded options retain the reference-device scope and the unverified-accuracy note.

This is a display change, not an accuracy improvement. The model, training sources,
estimate provenance, backend validation and telemetry records are unchanged. Accuracy
against real electricity use cannot be established from the available project data.

Validation: logs stability checks PASS, no-mock-data audit PASS (34 checks), syntax/diff
checks PASS, browser checks PASS (7 isolated scenarios). Updated desktop and narrow-screen
screenshots were visually inspected; the removed panel is absent and the options remain
usable. Reload EcoTrack to load the updated Daily Logs script.

## Model folder cleanup and missing-file recovery — 2026-10-12

The requested folder cleanup identified an actual forecast blocker: the required
supported_inputs.json.gz file was missing. An isolated health check reproduced the
failure (models_available was empty). Documentation and test-output files did not
cause that failure and are not read during normal inference.

The missing table was reconstructed from the exact original training ZIP, whose
SHA-256 matches the model manifest. The recovered compressed file matches the
original expected SHA-256 byte for byte:
ace53c0f19fc20a23e505224c5de8f4b825205f70e7c902ad26577f14693fe7b.
It contains the original 18,496 supported combinations. The active model.joblib
contents, assumptions, library versions, inputs and prediction values are unchanged.

The runtime directory now contains only:

- model.joblib
- manifest.json
- assumptions.json
- supported_inputs.json.gz

README.md, sources.json, held_out_predictions.csv and prediction_probes.json were
moved into reports/research-energy-model/artifacts, preserving source attribution
and evaluation evidence. The manifest now separates runtime and report checksums.
The trainer writes those reports outside the runtime directory, and prediction
tests read the relocated evidence. Existing APIs and model validation were not relaxed.

Before cleanup, all seven existing model-folder files and both affected scripts
were backed up and checksum-verified in:
C:/Users/reygay/Documents/Codex/2026-10-10/referenced-chatgpt-conversation-this-is-an/outputs/EcoTrack_RF_Before_Cleanup_20261012.zip.

Validation: all 15 real prediction API tests PASS; logs stability checks PASS;
no-mock-data audit PASS (34 checks); diff checks PASS. A complete training/export
check in a temporary directory also PASS: four runtime files, three separate
report files, valid checksums, and all 3,712 saved predictions replayed. That test
did not replace or retrain the active deployed model. No production telemetry,
credentials, firmware or unrelated files were modified.
