# EcoTrack authenticated monitoring and IR control

This is the current BLE/cloud provisioning sketch from `reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt`, with 20-notch GPIO40 rotation measurement and no temperature sensor. It preserves the existing IR mapping (RX4/TX5), BLE identity, private device-token validation, command acknowledgments, capture and scheduling. The old circuit's IR6/7 mapping must be reconciled with actual wiring before flashing; do not assume a successful build verifies the wiring.

The current sensor/IR pin mapping is listed below. GPIO47/48 are unused; no I2C temperature sensor is required. Apply the reviewed rotation cloud migration first. No pressure sensor is read or converted. Build using the installed ESP32-S3 huge_app partition. Physical testing and flashing are separate steps.

## Durable delivery (cloud-ir-device-1.9-outbox)

Apply `../../supabase/migrations/202610230001_measurement_outbox.sql` after the existing cloud-hardware and rotation migrations, then flash this sketch. The new upload RPC validates each device token and returns explicit reading IDs; a missing migration leaves readings queued rather than dropping them. The desktop importer still commits to SQLite before removing only confirmed cloud rows.

While awake, measurements use the AC Device Scheduler send interval. Each reading keeps its actual observation time, original device/boot/sequence ID and recorded interval. LittleFS holds up to 1,024 pending readings, subject to available flash and a 32 KiB reserve. FIFO retries resume after reconnecting and rebooting; acknowledged IDs alone are removed. A queue that fills retains unconfirmed readings, reports the problem and counts samples it could not store. It cannot retain unlimited outage history.

The board must have synchronized its clock before creating timestamped history. A cold boot without a usable clock reports that condition and waits for NTP; it does not invent observation times. Sampling pauses while the configured device sleeps. Network operations share the main loop, so the actual observation timestamp remains authoritative if a request delays a sample.

Device heartbeats expose the last reported buffer count, capacity, error and clock status in `applied_config`. A heartbeat never changes the original measurement time. Existing cloud-only telemetry remains compatible. Use the same self-contained sketch in the mobile repository's firmware directory.

Build: `arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app firmware/ecotrack_cloud_measurements`. Verify reconnect, power loss during append, queue-full behavior, sensor readings and wiring on physical hardware before deployment. Compilation alone does not verify those behaviors.

## Combined monitoring and control

This is the combined version of the supplied `cloud-ir-controller-1.8-capabilities` control sketch and the maintained sensor/outbox additions. Bluetooth provisioning, HTTPS, IR capability profiles, encoding/decoding, command handling, scheduling and reconnect/sleep routines match the supplied control code. Measurement capture and acknowledged uploads run separately from heartbeats.

| Connection | Configured pin/value |
| --- | --- |
| LM393-based optical module digital output | GPIO40 |
| Encoder wheel | 20 pulses per revolution; one falling edge per notch |
| AC remote IR receiver | GPIO4 |
| AC command IR transmitter | GPIO5 |
| Blue battery LED (active high; own series resistor) | GPIO6; on above 20% |
| Red battery LED (active high; own series resistor) | GPIO7; on at/below 20% |

Use the previously supplied 3.3 V sensor circuit and common ground. The optical rotation input is separate from the AC remote IR receiver. Match the pin constants and pulses-per-revolution constant to the physical wiring/wheel before flashing. Temperature sensing, its Wire dependency and GPIO47/48 initialization have been removed. New outlet-temperature fields are explicitly null; startup RPM remains null until a measurement window completes. Zero pulses cannot distinguish a stopped wheel from a disconnected or misaligned module.

The current `ecotrack_cloud_measurements.ino` embeds its persistent queue and needs no custom header. The old `telemetry-outbox.h` is retained as a reference for the previous version. Preserve saved Wi-Fi/device credentials; neither the source nor the downloadable package embeds credentials. The cloud measurement migration must be applied before the new upload RPC can acknowledge stored readings. Hardware flashing and physical sensor verification are separate from compilation.

## Current version: mock battery and charging (cloud-ir-device-2.3-battery)

Battery percentage, pack voltage and charging status come from the explicitly marked `MOCK BATTERY SOURCE` section. There is no ADC battery read, USB detector or charger-status input. GPIO2 stays unused; no raw battery tap, divider, ADC filter capacitor or isolation IC is required. The two parallel 2600 mAh 18650 cells are modeled as one 1S2P **5200 mAh** pack. The mock voltage is a simple 3.0–4.2 V demonstration mapping, not a calibrated cell-discharge curve or a measurement of the shield's regulated 5 V output.

The default is 80%, with a virtual USB input present. While awake, the mock adds one percentage point every 10 seconds, reaches 100%, reports `full` and stays there. It never loops back to a lower value. Set `MOCK_BATTERY_USB_PRESENT` to false to demonstrate discharging toward 0%. Set `MOCK_BATTERY_INITIAL_PERCENT` to 0, 20, 21 or 100 for boundary checks; `MOCK_BATTERY_STEP_MS` controls the interval. These are code-only test settings, not remotely exposed controls. Power-cycle after changing initial settings: the mock percentage otherwise survives scheduled deep sleep in RTC memory. Progression pauses during deep sleep; there are no per-step NVS writes or blocking waits.

GPIO6 drives the blue LED on when the percentage is greater than 20. GPIO7 drives the red LED on at 20 or below, including 0. Both use active-high wiring and their own series resistor to common ground. This is a powered battery-level indication; blue does not mean fully charged. The sketch requests GPIO hold for both levels during the existing scheduled deep sleep and releases those holds on wake. Verify the resistor, polarity, GPIO behavior and retained output on the actual board: the build and software tests do not establish physical operation.

The external SPDT switch interrupts the shield's regulated 5 V supply to the ESP32. It has no firmware pin and no software override. With only this drawn supply, hard OFF removes board power and extinguishes both LEDs. An additional USB cable can provide an alternate power path, so disconnect it when checking the physical switch. Use a switch with an adequate DC load rating; no raw-battery connection is needed.

New measurement packets put mock **volts** in `reading.battery`; never send a percentage in that existing field. Apply the existing `202610230002_measurement_battery.sql` after the outbox migration to retain that voltage in cloud history. Existing null/missing battery packets and immutable queued readings remain compatible; no queued data or history is edited or erased. No new database migration is needed for the live fields: the existing exchange stores `applied_config` with `battery_voltage`, `battery_percent_estimate` (0–100), `battery_charging` (boolean), `battery_charge_state` (`charging`, `full` or `discharging`), `battery_source: "mock"` and `battery_capacity_mah: 5200`. Apps use fresh online heartbeats for current charging; connectivity itself is not evidence of a real charger. Product UI uses ordinary battery labels, while the source and this technical documentation explicitly identify the mock.

Replace this source with actual sensing only when the battery/charger hardware and signal contract are known. Keep volts and percentage separate and preserve nullable unknowns. Temperature remains null. GPIO40/20-notch RPM, RX4/TX5 IR, BLE/cloud provisioning, original timestamps, FIFO delivery and AC Device Scheduler behavior are retained. Older report packages and wiring tables are historical and may contain excluded hardware.

## Temperature removal (30 October 2026)

MCP9808 support has been removed from the maintained cloud sketch and the local firmware in both application projects. The cloud version is `cloud-ir-device-2.2-no-temperature`. New readings keep `outlet_temperature_c: null` for schema compatibility. Existing queued readings retain their original temperature values and timestamps, and existing database history is not deleted. AC target-temperature commands still work; a target is not a measured temperature.

The temperature-based sensor-energy estimator cannot use new rotation-only readings. No target-temperature or RPM value is substituted for the missing measurement. Other control-history estimates retain their existing requirements. No schema migration is needed for this removal, but the firmware must be flashed separately before a board changes behavior.
