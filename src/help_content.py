GETTING_STARTED = """\
Getting Started with PandaInk
==============================

1. Register your device
   - Click [Register] to scan for nearby Wacom SmartPad devices via Bluetooth.
   - When your device appears, press the physical button on the device to confirm.
   - The device name and address will appear in the title bar once registered.

2. Sync offline drawings (Listen)
   - Click [Listen] to connect to your registered device and download drawings
     that were created while the device was offline.
   - New drawings appear as tabs in the Notebook as they are received.
   - Click [Stop] (same button) to end the session.

3. View drawings
   - Each synced drawing opens in its own tab labelled with the date and time.
   - Click any tab to switch to that drawing.
   - Close a tab by clicking the × in its label — this does NOT delete the file.

4. Reload drawings from disk (Fetch)
   - Click [Fetch] at any time to reload all drawings stored on disk.
   - Useful after restarting the app or when drawings were synced on another run.

5. Export as SVG
   - Inside any drawing tab, click [Save SVG] to export the drawing.
   - A save dialog lets you choose the destination and filename.

6. Delete a drawing
   - Inside a drawing tab, click [Delete] to permanently remove the file from disk.
   - A confirmation dialog will appear before the file is deleted.
"""

LIVE_MODE = """\
Live Mode
=========

Live mode streams pen strokes to the screen in real time as you draw.

How to use:
   1. Make sure your device is registered (see Getting Started).
   2. Select the "Live" radio button at the top of the window.
   3. Click [Start Live] to begin streaming.
   4. Draw on your Wacom SmartPad — strokes appear on screen immediately.
   5. Click [Stop Live] to end the session.

Notes:
   - Switching between Normal and Live mode automatically stops any active
     session (Listen or Live) to avoid Bluetooth conflicts.
   - Live strokes are NOT saved to disk automatically. Use Normal / Listen mode
     to save drawings persistently.
   - The orientation selector (Landscape / Portrait) applies to the Live canvas.
     Changing orientation while a live session is in progress takes effect for
     new strokes only.
   - The canvas is cleared each time you click [Start Live].
"""

SHORTCUTS_AND_TIPS = """\
Shortcuts & Tips
================

Keyboard shortcuts
------------------
  (No keyboard shortcuts are defined in this version.)

Orientation
-----------
  - Use the Landscape / Portrait selector to control how drawings are displayed.
  - Portrait rotates coordinates 90° clockwise, which matches how most users
    hold the Bamboo Slate / Folio device in portrait orientation.
  - Each drawing tab keeps the orientation it was opened with. Changing the
    selector only affects new tabs and the Live canvas.

File locations
--------------
  Drawings and device configuration are stored here:

      %APPDATA%\\pandaink\\

  Each device has its own sub-folder named after its Bluetooth address.
  Drawings are saved as JSON files and can be re-loaded at any time with [Fetch].

Tips
----
  - If [Listen] appears to hang, make sure Bluetooth is enabled on your PC and
    that the device is awake (tap the button on the device).
  - If no device is found during [Register], move the device closer to the PC
    and try again.
  - SVG exports preserve stroke pressure as line width, making them suitable for
    further editing in Inkscape or other vector editors.
"""

ABOUT = """\
About PandaInk
==============

Version:   v0.1.0-alpha
License:   GNU General Public License v2 (GPLv2)

PandaInk is a Windows GUI for syncing and viewing drawings from Wacom SmartPad
devices (Bamboo Slate, Bamboo Folio, etc.).

It is built on top of the Tuhi project, which provides the Bluetooth protocol
implementation and drawing data model.

Upstream project (Tuhi):
    https://github.com/tuhiproject/tuhi

PandaInk on GitHub:
    https://github.com/danielemarsico/pandaink

PandaInk is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 2 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.
"""
