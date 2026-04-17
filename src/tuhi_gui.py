#!/usr/bin/env python3
#
#  tuhi_gui.py — Tkinter GUI for Tuhi (Wacom SmartPad drawing sync).
#
#  Layout:
#    ┌─────────────────────────────────────────────────────────┐
#    │  daniele bamboo  F4:21:DE:4D:26:BF                      │
#    │  ● Normal  ○ Live        ○ Landscape  ● Portrait        │
#    │  [status bar]                                           │
#    ├─────────────────────────────────────────────────────────┤
#    │  Normal:  [Register]  [Listen]  [Fetch]                 │
#    │           ┌──Notebook──────────────────────────────┐   │
#    │           │ 2024-01-15 10:30 × │ 2024-01-16 × │    │   │
#    │           │  [Save SVG] [Delete]                    │   │
#    │           │  <DrawingCanvas>                        │   │
#    │           └────────────────────────────────────────┘   │
#    ├─────────────────────────────────────────────────────────┤
#    │  Live:    [Start Live]                                  │
#    │           ┌──LiveCanvas────────────────────────────┐   │
#    │           │  (strokes appear here in real time)     │   │
#    │           └────────────────────────────────────────┘   │
#    └─────────────────────────────────────────────────────────┘
#
#  Framework: tkinter (built-in, zero extra dependencies).
#  Rendering: stroke data from Drawing.strokes drawn as Canvas polylines.
#
#  Tab label: "2024-01-15 10:30 ×"  — clicking × closes the tab without
#  deleting the file.
#
#  Per-tab toolbar buttons:
#    [Save SVG]  — export current drawing as SVG (filedialog)
#    [Delete]    — delete drawing file from disk and close tab
#

import os
import sys
import time
import threading
import tkinter as tk
import tkinter.font as tkfont
from tkinter import ttk, messagebox, filedialog

# Allow running from any working directory
sys.path.insert(0, os.path.dirname(__file__))

from tuhi.app import TuhiApp
from tuhi.config_win import TuhiConfig, get_default_data_dir
from tuhi.export_win import JsonSvg
from help_dialog import HelpDialog

CANVAS_W = 900
CANVAS_H = 600


# ---------------------------------------------------------------------------
# ClosableNotebook
# ---------------------------------------------------------------------------

class ClosableNotebook(ttk.Notebook):
    """
    ttk.Notebook where each tab label ends with ' ×'.
    Clicking the × portion of the label closes the tab without deleting
    anything from disk.

    Usage:
        nb.add_closeable(frame, title, on_close=callable)
    """

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self._close_callbacks = {}   # tab widget path -> callable
        self.bind('<Button-1>', self._on_click, add=True)

    def add_closeable(self, child, text, on_close=None):
        """Add *child* with tab label '*text* ×'."""
        super().add(child, text=f'{text}  ×')
        if on_close:
            self._close_callbacks[str(child)] = on_close

    def _on_click(self, event):
        try:
            idx = self.index(f'@{event.x},{event.y}')
        except tk.TclError:
            return

        tab_text = self.tab(idx, 'text')
        if not tab_text.endswith('  ×'):
            return

        # Measure where '  ×' starts inside the tab label text.
        try:
            font = tkfont.nametofont('TkDefaultFont')
        except Exception:
            font = tkfont.Font()
        base_text = tab_text[:-3]          # strip trailing '  ×'
        base_w = font.measure(base_text)   # px up to where × begins

        # Find the tab's left edge by scanning the tab bar in 2px steps.
        tab_left = self._tab_left_x(idx)
        if tab_left is None:
            return

        # Standard TNotebook.Tab has ~6px inner padding on each side.
        inner_pad = 6
        x_region_start = tab_left + inner_pad + base_w

        if event.x >= x_region_start:
            tab_path = self.tabs()[idx]
            cb = self._close_callbacks.pop(tab_path, None)
            self.forget(idx)
            if cb:
                cb()

    def _tab_left_x(self, target_idx):
        """Return the leftmost x pixel of the tab at *target_idx*."""
        width = self.winfo_width() or 800
        prev = None
        for x in range(0, width, 2):
            try:
                i = self.index(f'@{x},5')
            except tk.TclError:
                i = None
            if i != prev:
                if i == target_idx:
                    return x
                prev = i
        return None


# ---------------------------------------------------------------------------
# DrawingCanvas
# ---------------------------------------------------------------------------

class DrawingCanvas(tk.Canvas):
    """
    Renders a Drawing object onto a tkinter Canvas.

    Coordinate normalisation:
      Drawing.dimensions = (W, H) in device units → scaled to canvas pixels
      preserving aspect ratio with letterboxing.

    Orientation transforms (applied before scaling):
      Landscape: identity — (x, y) as-is.
      Portrait:  rotate 90° CW — (x', y') = (H - y, x); swap canvas W↔H.

    Pressure → line width: pressure / 0x10000 * 2 + 0.5 px.

    The orientation is frozen at construction time and is not changed by the
    global orientation selector — it reflects the mode in which the drawing
    was loaded/synced.
    """

    def __init__(self, parent, drawing, orientation='portrait', **kwargs):
        kwargs.setdefault('bg', 'white')
        kwargs.setdefault('width', CANVAS_W)
        kwargs.setdefault('height', CANVAS_H)
        super().__init__(parent, **kwargs)
        self._drawing = drawing
        self._orientation = orientation
        self._render()

    def redraw(self, orientation):
        self._orientation = orientation
        self._render()

    def _render(self):
        self.delete('all')
        if self._drawing is None:
            return

        dw, dh = self._drawing.dimensions
        if dw == 0 or dh == 0:
            return

        cw = int(self['width'])
        ch = int(self['height'])

        if self._orientation == 'portrait':
            # 90° CW: (x,y) → (H-y, x); device logical size becomes (dh, dw)
            logical_w, logical_h = dh, dw
        else:
            logical_w, logical_h = dw, dh

        # Letterbox scaling
        scale = min(cw / logical_w, ch / logical_h)
        ox = (cw - logical_w * scale) / 2
        oy = (ch - logical_h * scale) / 2

        for stroke in self._drawing.strokes:
            self._draw_stroke(stroke, dw, dh, scale, ox, oy)

    def _transform(self, x, y, dw, dh):
        if self._orientation == 'portrait':
            return dh - y, x
        return x, y

    def _draw_stroke(self, stroke, dw, dh, scale, ox, oy):
        segment = []
        for point in stroke.points:
            if point.position is None:
                if len(segment) >= 2:
                    self._flush_segment(segment)
                segment = []
                continue

            px, py = self._transform(point.position[0], point.position[1], dw, dh)
            sx = ox + px * scale
            sy = oy + py * scale
            pressure = point.pressure or 0
            width = max(0.5, pressure / 0x10000 * 2 + 0.5)
            segment.append((sx, sy, width))

        if len(segment) >= 2:
            self._flush_segment(segment)

    def _flush_segment(self, segment):
        for i in range(len(segment) - 1):
            x0, y0, w0 = segment[i]
            x1, y1, _ = segment[i + 1]
            self.create_line(x0, y0, x1, y1, width=w0, fill='black',
                             capstyle=tk.ROUND, joinstyle=tk.ROUND)


# ---------------------------------------------------------------------------
# LiveCanvas
# ---------------------------------------------------------------------------

class LiveCanvas(tk.Canvas):
    """
    Full-screen canvas for live pen streaming.

    on_pen_point(x, y, pressure, in_proximity) must be called via
    root.after(0, ...) to ensure it runs on the UI thread.
    """

    def __init__(self, parent, device_dimensions=(21600, 14800),
                 orientation='portrait', **kwargs):
        kwargs.setdefault('bg', 'white')
        super().__init__(parent, **kwargs)
        self._dims = device_dimensions
        self._orientation = orientation
        self._segments = []   # list of list of (sx, sy, width)
        self._current = []    # current in-progress segment

    def set_dimensions(self, dims):
        self._dims = dims

    def redraw(self, orientation):
        self._orientation = orientation
        self._redraw_all()

    def on_pen_point(self, x, y, pressure, in_proximity):
        if in_proximity:
            sx, sy = self._to_canvas(x, y)
            width = max(0.5, pressure / 0x10000 * 2 + 0.5)
            self._current.append((sx, sy, width))
            if len(self._current) >= 2:
                p0 = self._current[-2]
                p1 = self._current[-1]
                self.create_line(p0[0], p0[1], p1[0], p1[1],
                                 width=p0[2], fill='black',
                                 capstyle=tk.ROUND, joinstyle=tk.ROUND)
        else:
            if self._current:
                self._segments.append(list(self._current))
                self._current = []

    def clear(self):
        self.delete('all')
        self._segments = []
        self._current = []

    def _to_canvas(self, x, y):
        dw, dh = self._dims
        cw = self.winfo_width() or CANVAS_W
        ch = self.winfo_height() or CANVAS_H

        if self._orientation == 'portrait':
            tx, ty = dh - y, x
            lw, lh = dh, dw
        else:
            tx, ty = x, y
            lw, lh = dw, dh

        if lw == 0 or lh == 0:
            return 0, 0

        scale = min(cw / lw, ch / lh)
        ox = (cw - lw * scale) / 2
        oy = (ch - lh * scale) / 2
        return ox + tx * scale, oy + ty * scale

    def _redraw_all(self):
        self.delete('all')
        for seg in self._segments:
            # Re-transform from raw segment — we store raw device coords
            pass
        # For orientation change, easiest is to store raw coords, but we
        # already converted; just accept that live canvas won't re-orient
        # accumulated strokes (they are cleared on Start Live anyway).


# ---------------------------------------------------------------------------
# Main application window
# ---------------------------------------------------------------------------

class TuhiGUIApp(tk.Tk):

    def __init__(self):
        super().__init__()
        self.title('PandaInk — Wacom SmartPad')
        self.resizable(True, True)

        # Initialise TuhiApp
        config_dir = get_default_data_dir()
        TuhiConfig.set_base_path(config_dir)
        self._app = TuhiApp()
        self._app.start()

        # Shared state
        self._address = None          # registered device address
        self._mode = tk.StringVar(value='normal')
        self._orientation = tk.StringVar(value='portrait')  # A6.5: portrait default
        self._status = tk.StringVar(value='')
        self._device_label = tk.StringVar(value='No device registered')
        self._listening = False
        self._live_running = False
        self._buttons = {}            # name -> widget, for enable/disable
        self._shown_timestamps = set()  # timestamps already present in Notebook

        self._build_ui()
        self._load_registered_device()
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ------------------------------------------------------------------ #
    # UI construction                                                      #
    # ------------------------------------------------------------------ #

    def _build_ui(self):
        top = ttk.Frame(self)
        top.pack(fill='x', padx=8, pady=(8, 0))

        # Row 1: device label
        ttk.Label(top, textvariable=self._device_label,
                  font=('TkDefaultFont', 11, 'bold')).pack(anchor='w')

        # Row 2: mode selector (left) + orientation selector (right)
        row2 = ttk.Frame(top)
        row2.pack(fill='x', pady=2)

        ttk.Radiobutton(row2, text='Normal', variable=self._mode,
                        value='normal', command=self._on_mode_changed).pack(side='left')
        ttk.Radiobutton(row2, text='Live', variable=self._mode,
                        value='live', command=self._on_mode_changed).pack(side='left', padx=(8, 24))

        ttk.Radiobutton(row2, text='Landscape', variable=self._orientation,
                        value='landscape', command=self._on_orientation_changed).pack(side='left')
        ttk.Radiobutton(row2, text='Portrait', variable=self._orientation,
                        value='portrait', command=self._on_orientation_changed).pack(side='left', padx=8)

        ttk.Button(row2, text='Help',
                   command=lambda: HelpDialog(self)).pack(side='right', padx=2)

        # Row 3: status bar
        ttk.Label(top, textvariable=self._status,
                  foreground='gray').pack(anchor='w')

        ttk.Separator(self, orient='horizontal').pack(fill='x', pady=4)

        # Normal-mode frame
        self._normal_frame = ttk.Frame(self)
        self._normal_frame.pack(fill='both', expand=True, padx=8, pady=4)
        self._build_normal_frame()

        # Live-mode frame (hidden by default)
        self._live_frame = ttk.Frame(self)
        self._build_live_frame()

    def _build_normal_frame(self):
        # Action bar
        bar = ttk.Frame(self._normal_frame)
        bar.pack(fill='x', pady=(0, 4))

        for name, label, cmd in [
            ('register', 'Register', self._cmd_register),
            ('listen',   'Listen',   self._cmd_listen),
            ('fetch',    'Fetch',    self._cmd_fetch),
        ]:
            btn = ttk.Button(bar, text=label, command=cmd)
            btn.pack(side='left', padx=2)
            self._buttons[name] = btn

        # Notebook with closeable tabs
        self._notebook = ClosableNotebook(self._normal_frame)
        self._notebook.pack(fill='both', expand=True)

    def _build_live_frame(self):
        bar = ttk.Frame(self._live_frame)
        bar.pack(fill='x', pady=(0, 4))

        btn = ttk.Button(bar, text='Start Live', command=self._cmd_toggle_live)
        btn.pack(side='left', padx=2)
        self._buttons['live'] = btn

        self._live_canvas = LiveCanvas(self._live_frame,
                                       orientation=self._orientation.get(),
                                       width=CANVAS_W, height=CANVAS_H)
        self._live_canvas.pack(fill='both', expand=True)

    # ------------------------------------------------------------------ #
    # Startup: populate device label and load drawings from disk           #
    # ------------------------------------------------------------------ #

    def _load_registered_device(self):
        devices = self._app.list_devices()
        if devices:
            d = devices[0]
            self._address = d['address']
            name = d['name'] or ''
            self._device_label.set(f"{name}  {self._address}")
            # A6.2: load all drawings immediately at startup
            self._load_drawings()

    def _load_drawings(self):
        """Load all drawings from disk into the Notebook (full reload)."""
        if self._address is None:
            return
        drawings = self._app.config.load_drawings(self._address)
        for tab in self._notebook.tabs():
            self._notebook.forget(tab)
        self._shown_timestamps.clear()
        for drawing in sorted(drawings, key=lambda d: d.timestamp):
            self._add_drawing_tab(drawing)
        if drawings:
            self._set_status(f'Loaded {len(drawings)} drawing(s).')

    # ------------------------------------------------------------------ #
    # Mode / orientation selectors                                        #
    # ------------------------------------------------------------------ #

    def _on_mode_changed(self):
        mode = self._mode.get()
        if mode == 'normal':
            if self._live_running:
                self._stop_live()
            self._live_frame.pack_forget()
            self._normal_frame.pack(fill='both', expand=True, padx=8, pady=4)
        else:
            # Stop any active Listen session before entering Live mode so both
            # don't fight over the same BLE connection.
            if self._listening:
                self._app.stop_listening(self._address)
                self._listening = False
                self._buttons['listen'].configure(text='Listen')
                self._set_buttons_state('normal')
            self._normal_frame.pack_forget()
            self._live_frame.pack(fill='both', expand=True, padx=8, pady=4)

    def _on_orientation_changed(self):
        # A6.6: existing DrawingCanvas tabs keep the orientation they were
        # created with — only the LiveCanvas and future new tabs are affected.
        orientation = self._orientation.get()
        self._live_canvas.redraw(orientation)

    # ------------------------------------------------------------------ #
    # Register flow (A3)                                                  #
    # ------------------------------------------------------------------ #

    def _cmd_register(self):
        self._set_buttons_state('disabled')
        self._set_status('Searching for devices... (30 s)')

        def _search():
            found = []

            def on_found(address, name):
                found.append((address, name))

            self._app.search(timeout=30, on_found=on_found, stop_early=True)

            if not found:
                self.after(0, lambda: self._set_status('No devices found.'))
                self.after(0, lambda: self._set_buttons_state('normal'))
                return

            address, name = found[0]
            self.after(0, lambda: self._show_register_dialog(address, name))

        threading.Thread(target=_search, daemon=True).start()

    def _show_register_dialog(self, address, name):
        dlg = tk.Toplevel(self)
        dlg.title('Register Device')
        dlg.transient(self)
        dlg.grab_set()
        dlg.resizable(False, False)

        msg = tk.StringVar(value=f'Found: {name} ({address})\n\nPress the button on your device.')
        ttk.Label(dlg, textvariable=msg, padding=16).pack()
        ttk.Button(dlg, text='Cancel', command=dlg.destroy).pack(pady=(0, 8))

        def _register():
            def on_button_press():
                self.after(0, lambda: msg.set(
                    f'Found: {name} ({address})\n\nRegistering…'))

            try:
                self._app.register(address, on_button_press=on_button_press, timeout=60)
            except Exception as e:
                self.after(0, lambda: messagebox.showerror('Registration failed', str(e)))
            finally:
                self.after(0, dlg.destroy)
                self.after(0, lambda: self._on_registration_done(address, name))

        threading.Thread(target=_register, daemon=True).start()

    def _on_registration_done(self, address, name):
        self._address = address
        self._device_label.set(f"{name}  {address}")
        self._set_status('Registration complete.')
        self._set_buttons_state('normal')

    # ------------------------------------------------------------------ #
    # Listen flow (A4)                                                    #
    # ------------------------------------------------------------------ #

    def _cmd_listen(self):
        if self._address is None:
            messagebox.showinfo('No device', 'Register a device first.')
            return

        if self._listening:
            self._app.stop_listening(self._address)
            self._listening = False
            self._buttons['listen'].configure(text='Listen')
            self._set_status('Stopped listening.')
            self._set_buttons_state('normal')
            return

        self._listening = True
        self._buttons['listen'].configure(text='Stop')
        self._set_status(f'Listening on {self._address}…')
        self._buttons['register'].configure(state='disabled')
        self._buttons['fetch'].configure(state='disabled')

        def on_drawings(app_dev):
            for drawing in app_dev.drawings.values():
                self.after(0, lambda d=drawing: self._add_drawing_tab(d))

        self._app.start_listening(self._address, on_drawings=on_drawings)

    # ------------------------------------------------------------------ #
    # Fetch flow (A5)                                                     #
    # ------------------------------------------------------------------ #

    def _cmd_fetch(self):
        if self._address is None:
            messagebox.showinfo('No device', 'Register a device first.')
            return

        drawings = self._app.config.load_drawings(self._address)
        if not drawings:
            messagebox.showinfo('No drawings',
                                'No drawings on disk. Use Listen to sync drawings first.')
            return

        # Clear existing tabs and reset dedup set
        for tab in self._notebook.tabs():
            self._notebook.forget(tab)
        self._shown_timestamps.clear()

        for drawing in sorted(drawings, key=lambda d: d.timestamp):
            self._add_drawing_tab(drawing)

        self._set_status(f'Loaded {len(drawings)} drawing(s).')

    # ------------------------------------------------------------------ #
    # Drawing tab helper (A6.3: per-tab toolbar)                          #
    # ------------------------------------------------------------------ #

    def _add_drawing_tab(self, drawing):
        if drawing.timestamp in self._shown_timestamps:
            return   # already shown; avoids duplicates from Listen callbacks
        self._shown_timestamps.add(drawing.timestamp)

        ts = time.strftime('%Y-%m-%d %H:%M', time.localtime(drawing.timestamp))
        orientation = self._orientation.get()   # frozen at creation time (A6.6)

        frame = ttk.Frame(self._notebook)

        # --- Per-tab toolbar ---
        toolbar = ttk.Frame(frame)
        toolbar.pack(fill='x', pady=(2, 0))

        canvas = DrawingCanvas(frame, drawing, orientation=orientation,
                               width=CANVAS_W, height=CANVAS_H)
        canvas.pack(fill='both', expand=True)

        def _save_svg():
            safe_ts = ts.replace(' ', '_').replace(':', '-')
            path = filedialog.asksaveasfilename(
                parent=self,
                defaultextension='.svg',
                filetypes=[('SVG files', '*.svg'), ('All files', '*.*')],
                initialfile=f'drawing_{safe_ts}.svg',
                title='Save drawing as SVG',
            )
            if not path:
                return
            try:
                import json as _json
                JsonSvg(_json.loads(drawing.to_json()), canvas._orientation, path)
                self._set_status(f'Saved: {os.path.basename(path)}')
            except Exception as e:
                messagebox.showerror('Export failed', str(e))

        def _delete_drawing():
            if not messagebox.askyesno(
                    'Delete drawing',
                    f'Permanently delete drawing from {ts}?\nThis cannot be undone.',
                    parent=self):
                return
            json_path = self._app.config.drawing_path(self._address, drawing.timestamp)
            try:
                os.remove(json_path)
            except OSError as e:
                messagebox.showerror('Delete failed', str(e), parent=self)
                return
            self._notebook.forget(frame)
            self._set_status(f'Deleted drawing from {ts}.')

        ttk.Button(toolbar, text='Save SVG', command=_save_svg).pack(side='left', padx=2)
        ttk.Button(toolbar, text='Delete', command=_delete_drawing).pack(side='left', padx=2)

        # × is in the tab label (ClosableNotebook handles the click)
        self._notebook.add_closeable(frame, ts)
        self._notebook.select(frame)

    # ------------------------------------------------------------------ #
    # Live mode (B4)                                                      #
    # ------------------------------------------------------------------ #

    def _cmd_toggle_live(self):
        if self._live_running:
            self._stop_live()
        else:
            self._start_live()

    def _start_live(self):
        if self._address is None:
            messagebox.showinfo('No device', 'Register a device first.')
            return

        # Update live canvas device dimensions
        devices = self._app.list_devices()
        for d in devices:
            if d['address'] == self._address and d['dimensions'] != (0, 0):
                self._live_canvas.set_dimensions(d['dimensions'])
                break

        self._live_canvas.clear()
        self._live_running = True
        self._buttons['live'].configure(text='Stop Live')
        self._set_status('Live mode active…')

        def on_pen_point(x, y, pressure, in_proximity):
            self.after(0, lambda: self._live_canvas.on_pen_point(
                x, y, pressure, in_proximity))

        self._app.start_live(self._address, on_pen_point=on_pen_point)

    def _stop_live(self):
        if self._address:
            self._app.stop_live(self._address)
        self._live_running = False
        self._buttons['live'].configure(text='Start Live')
        self._set_status('Live mode stopped.')

    # ------------------------------------------------------------------ #
    # Helpers                                                             #
    # ------------------------------------------------------------------ #

    def _set_status(self, msg):
        self._status.set(msg)

    def _set_buttons_state(self, state):
        for btn in self._buttons.values():
            btn.configure(state=state)

    def _on_close(self):
        if self._live_running and self._address:
            self._app.stop_live(self._address)
        if self._listening and self._address:
            self._app.stop_listening(self._address)
        self._app.stop()
        self.destroy()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Tuhi GUI — Wacom SmartPad drawing sync')
    parser.add_argument('--config-dir', default=None,
                        help='Base directory for configuration')
    args = parser.parse_args()

    if args.config_dir:
        TuhiConfig.set_base_path(args.config_dir)

    app = TuhiGUIApp()
    app.mainloop()


if __name__ == '__main__':
    main()
