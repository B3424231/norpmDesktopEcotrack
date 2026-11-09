# EcoTrack Random Forest research-estimate model

This is the only active prediction model. It estimates one future hour with the
selected controls and an explicitly chosen hypothetical environment scenario.
It is inspired by Haier AS35XCAHRA / 1U35S2SM1FA-2. It is not calibrated for every
AC model supported by the dashboard's IR registry.

The model was trained in the existing EcoTrack Python environment. The old
scikit-learn 1.7.2 model objects were not loaded into the app's 1.9.0 runtime.
Artifact hashes, package versions, train/validation/test counts and actual test
metrics are recorded in manifest.json. The test labels are generated estimates.
Physical energy accuracy remains unverified.

## API

GET /api/prediction-features returns required controls, accepted aliases, the
six supported assumed environment scenarios and the model limitations.

GET /api/prediction-metrics returns metrics for Random Forest, with an explicit
held_out_generated_formula_targets evaluation label.

POST /api/predict-energy accepts:

~~~json
{
  "model": "random_forest",
  "scenario_id": "lab_hot",
  "settings": {
    "setpoint_c": 24,
    "fan_command": "medium",
    "operating_mode": "cool",
    "eco": false,
    "turbo": false,
    "swing": true,
    "quiet": false,
    "horizontal_swing": false,
    "display": true
  }
}
~~~

The response provides kwh and estimated_energy_kwh for one hour, with
physical_accuracy_validated=false and measured_energy_kwh=null.
The scenario's indoor/outdoor temperature and humidity are assumptions, never
written into measured telemetry. All function states must be explicitly supplied.
Missing values are not silently replaced by zero or OFF.

The aliases temp/temperature, fan, mode, swing_vertical and swing_horizontal map
to the canonical training inputs. Function states also accept "on"/"off".
Conflicting aliases, unsupported fan commands, Filter/Sleep/Clean features,
half-degree or 31 C setpoints, and combinations outside the modeled reference
grid return clear errors.

The endpoint does not turn an AC on, send IR, confirm physical operation, infer
runtime, or calculate measured daily/weekly energy. It assumes the selected AC
operates for one hour with the specified inputs held constant. Scaling that
static estimate over longer periods would require additional assumptions.

XGBoost and Decision Tree IDs are retired and return MODEL_NOT_AVAILABLE.
The frontend uses Random Forest with explicit controls and selected conditions.
Daily Logs keeps the conditions selector in collapsed Prediction options.

## Runtime files and reports

Only model.joblib, manifest.json, assumptions.json and supported_inputs.json.gz
belong in backend/ml/research_random_forest. The service needs all four files.
The supported-input table validates which control/scenario combinations are covered.

This documentation, sources.json, prediction_probes.json and held_out_predictions.csv
are preserved here in reports/research-energy-model/artifacts. They are not read
for normal forecasts. The manifest separates runtime artifact checksums from report
artifact checksums. Retraining keeps reports outside the runtime folder; use
--reports-output to choose a different report directory.

## Reproduce and verify

From the project root, using its existing environment:

~~~powershell
venv\Scripts\python.exe scripts/train_energy_random_forest.py --dataset "PATH\AC_Research_Estimates.zip"
venv\Scripts\python.exe scripts/test_energy_prediction.py
~~~

The trainer checks the dataset ZIP and file checksums, trains only labeled
estimated targets, selects between two starting configurations by validation
MAE, and verifies saved-model predictions on all 3,712 held-out rows.
The 319 original published measurements are separate from these training labels.

Do not downgrade application dependencies to load an older artifact. Retrain in
the current environment if saved-model versions no longer match. Only load the
trusted local model package. Sources are retained here in sources.json; numerical
assumptions remain in the runtime package's assumptions.json.
