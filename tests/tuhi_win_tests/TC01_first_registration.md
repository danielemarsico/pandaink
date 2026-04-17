# TC01 — First-time device registration

**Goal:** Register a brand-new (never paired) Wacom device with the application.

**Preconditions:**
- No device is registered yet (`%APPDATA%\tuhi` is empty or missing).
- The Wacom device is powered on and in pairing mode (LED blinking white).
- Bluetooth is enabled on the PC.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Verify the top label reads "No device registered".
3. Verify the mode is set to Normal.
4. Click **Register**.
5. Observe the status bar shows "Searching for devices… (30 s)".
6. Wait for the device to be detected.
7. Observe a dialog appears with the device name and address and the message "Press the button on your device".
8. Press the physical button on the Wacom device.
9. Observe the dialog message changes to "Registering…".
10. Wait for the dialog to close automatically.
11. Observe the top label now shows the device name and Bluetooth address.
12. Observe the status bar shows "Registration complete."
13. Close the application.
14. Re-launch the application: `python tuhi_gui.py`
15. Observe the top label still shows the registered device name and address at startup.

## Expected result

The device is registered and the name persists across restarts.
