# EcoTrack data flow diagrams

Updated 6 November 2026. Logical DFDs cover the desktop administrator, assigned mobile staff and ESP32 hardware. D1 groups related cloud and desktop history records. Level 1 adds timed AC automation and updates battery, notification and repair-review flows using the current source.

## Level 0 - context

<!-- mermaid:id=level_0 -->
```mermaid
flowchart LR
  Admin["Admin - desktop"]
  Staff["Staff - mobile"]
  Device["ESP32-S3 - RPM, IR and reported battery"]
  P0("0. EcoTrack")
  Admin -->|"Credentials"| P0
  Admin -->|"Device details"| P0
  Admin -->|"Monitor query"| P0
  Admin -->|"AC controls"| P0
  Admin -->|"Rules / inbox data"| P0
  Admin -->|"Work / review"| P0
  Admin -->|"Report / cost query"| P0
  Admin -->|"Presets / hours"| P0
  P0 -->|"Login result"| Admin
  P0 -->|"Device list"| Admin
  P0 -->|"Readings / charge"| Admin
  P0 -->|"Alerts / work status"| Admin
  P0 -->|"Reports / run status"| Admin
  P0 -->|"Setup config"| Device
  P0 -->|"Upload ACK"| Device
  P0 -->|"Control / capture"| Device
  P0 -->|"Commands / hours"| Device
  Device -->|"Device ID"| P0
  Device -->|"RPM / battery"| P0
  Device -->|"IR / response"| P0
  Device -->|"Timer receipt"| P0
  Staff -->|"Sign-in data"| P0
  Staff -->|"Room setup"| P0
  Staff -->|"Status request"| P0
  Staff -->|"Inbox actions"| P0
  Staff -->|"Progress / submit"| P0
  P0 -->|"Session access"| Staff
  P0 -->|"Assigned nodes"| Staff
  P0 -->|"Live status"| Staff
  P0 -->|"Mobile notices"| Staff
  P0 -->|"Tasks / approval"| Staff
```

## Level 1 - decomposition

<!-- mermaid:id=level_1 -->
```mermaid
flowchart LR
  Admin["Admin - desktop"]
  Staff["Staff - mobile"]
  Device["ESP32-S3 - RPM, IR and reported battery"]
  D1[("D1 EcoTrack data - Supabase cloud and SQLite history")]
  P1("1.0 Authenticate users")
  P2("2.0 Register devices")
  P3("3.0 Monitor RPM and battery")
  P4("4.0 Control AC and learn IR")
  P5("5.0 Rules and native notifications")
  P6("6.0 Maintenance and repair review")
  P7("7.0 Analyze, forecast and export")
  P8("8.0 Schedule AC automation")
  Admin -->|"Credentials"| P1
  P1 -->|"Login result"| Admin
  Admin -->|"Device details"| P2
  P2 -->|"Device list"| Admin
  Admin -->|"Node selection"| P3
  P3 -->|"Readings / charge"| Admin
  Admin -->|"Control settings"| P4
  P4 -->|"Command status"| Admin
  Admin -->|"Rules / inbox data"| P5
  P5 -->|"Desktop alerts"| Admin
  Admin -->|"Assign / verify"| P6
  P6 -->|"Repair outcomes"| Admin
  Admin -->|"Report / cost inputs"| P7
  P7 -->|"Reports / estimates"| Admin
  Admin -->|"Presets / hours"| P8
  P8 -->|"Run status"| Admin
  Staff -->|"Sign-in data"| P1
  P1 -->|"Session access"| Staff
  Staff -->|"Room setup"| P2
  P2 -->|"Assigned nodes"| Staff
  Staff -->|"Status request"| P3
  P3 -->|"Live status"| Staff
  Staff -->|"Inbox actions"| P5
  P5 -->|"Mobile notices"| Staff
  Staff -->|"Progress / submit"| P6
  P6 -->|"Tasks / approval"| Staff
  Device -->|"Device ID"| P2
  P2 -->|"Setup config"| Device
  Device -->|"RPM / battery"| P3
  P3 -->|"Upload ACK"| Device
  Device -->|"IR results"| P4
  P4 -->|"Control / capture"| Device
  Device -->|"Dispatch receipt"| P8
  P8 -->|"Timing / commands"| Device
  P1 -->|"Account query"| D1
  D1 -->|"User profile"| P1
  P2 -->|"Registry changes"| D1
  D1 -->|"Saved devices"| P2
  P3 -->|"History / heartbeat"| D1
  D1 -->|"Latest samples"| P3
  P4 -->|"Commands / IR codes"| D1
  D1 -->|"Control context"| P4
  P5 -->|"Rules / messages"| D1
  D1 -->|"Alert context"| P5
  P6 -->|"Work / evidence"| D1
  D1 -->|"Maintenance records"| P6
  P7 -->|"History query"| D1
  D1 -->|"Archived logs"| P7
  P8 -->|"Timers / run log"| D1
  D1 -->|"Presets / receipts"| P8
```
