# Hardware handoff for Nenad

The September 26 video describes connection checks and preparation for a first
power-on and movement test. It does not establish a working machine telemetry
interface. Please supply the following before replacing the simulator:

1. Exact controller board, firmware version, and machine type.
2. Which signal shows `RUNNING` and which independently shows `FINISHED`?
   Are these GRBL serial responses, GPIO levels, spindle/laser power, or sensors?
3. What does the ESP32 actually receive today? Share three raw examples with
   timestamps: idle, active, finished/error. Mask Wi-Fi and wallet secrets.
4. Is LaserGRBL already connected to the controller's serial port? If so, can
   the ESP32 read status without contending for or disrupting that connection?
5. Can the controller report the specific G-code file/job identity, or does
   BADEM have to associate it before start? How do we detect a swapped file?
6. How will the ESP32 reach the backend (Wi-Fi/HTTP, serial gateway, other)?
7. What happens after network failure or reboot? Can sequence and unsent events
   be retained without falsely showing a completed job?

The first physical test should show the raw signal and the resulting BADEM API
event side by side, with safety-critical controls isolated from the adapter.
