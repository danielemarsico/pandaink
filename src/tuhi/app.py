#!/usr/bin/env python3
#
#  tuhi/app.py — Single-process Tuhi application.
#
#  TuhiApp replaces the Tuhi + TuhiIPCServer combination with a
#  single-process architecture: no TCP socket, CLI commands call app
#  methods directly.  The BLE asyncio loop runs in a background thread
#  started by TuhiApp.start().
#
#  Typical CLI usage:
#
#      app = TuhiApp()
#      app.start()        # starts BLE loop
#      # ... call list_devices(), search(), register(), start_listening()
#      app.stop()         # tears down BLE
#

import logging
import threading

from tuhi.gobject_compat import Object, Property, TYPE_PYOBJECT, TYPE_INT, TYPE_BOOLEAN
from tuhi.ble_bleak import BleakDeviceManager
from tuhi.wacom_win import DeviceMode
from tuhi.config_win import TuhiConfig

logger = logging.getLogger('tuhi')

WACOM_COMPANY_IDS = [0x4755, 0x4157, 0x424d]


class AppDevice(Object):
    """
    Lightweight in-process device state.

    Implements the same contract that TuhiDevice (base_win.py) expects from
    its 'dbus_device' slot:
      • signals: register-requested, notify::listening, notify::live
      • methods: add_drawing(), notify_button_press_required()
      • properties: listening, live, uhid_fd

    No TCP socket, no JSON encoding — just Python objects and gobject_compat
    signals.
    """

    __gsignals__ = {
        'register-requested': (1, None, ()),
        'button-press-required': (1, None, ()),
        'live-pen-data': (1, None, (TYPE_INT, TYPE_INT, TYPE_INT, TYPE_BOOLEAN)),
    }

    def __init__(self):
        Object.__init__(self)
        self._listening = False
        self._live = False
        self._uhid_fd = -1
        self.drawings = {}  # timestamp -> Drawing

    @Property
    def listening(self):
        return self._listening

    @listening.setter
    def listening(self, value):
        if self._listening != value:
            self._listening = value
            self.notify('listening')

    @Property
    def live(self):
        return self._live

    @live.setter
    def live(self, value):
        if self._live != value:
            self._live = value
            self.notify('live')

    @Property
    def uhid_fd(self):
        return self._uhid_fd

    # -- called by TuhiDevice --------------------------------------------------

    def add_drawing(self, drawing):
        self.drawings[drawing.timestamp] = drawing
        self.notify('drawings-available')

    def notify_button_press_required(self):
        self.emit('button-press-required')

    # -- called by CLI commands ------------------------------------------------

    def start_listening(self):
        self.listening = True

    def stop_listening(self):
        self.listening = False


class TuhiApp:
    """
    Single-process Tuhi entry point.

    Each CLI invocation should:
      1. Create TuhiApp()  (pass config_dir if non-default)
      2. Call start()      — initialises the BLE event loop
      3. Use the public API (list_devices, search, register, start_listening …)
      4. Call stop()       — tears down BLE scanning

    Thread safety: all public methods are safe to call from the main thread.
    BLE callbacks arrive on the BleakDeviceManager's background thread;
    signal handlers in gobject_compat are called on that thread but the
    threading.Event machinery in search() / register() makes them safe.
    """

    def __init__(self, config_dir=None):
        if config_dir:
            TuhiConfig.set_base_path(config_dir)
        self.config = TuhiConfig()
        self.bluez = BleakDeviceManager()
        self.devices = {}       # address -> TuhiDevice
        self._app_devices = {}  # address -> AppDevice
        self._on_unregistered = None  # callable(address, name) set during search()

        self.bluez.connect('discovery-stopped', self._on_discovery_stopped)

    # ------------------------------------------------------------------ #
    # Lifecycle                                                            #
    # ------------------------------------------------------------------ #

    def start(self):
        """Start the BLE event loop and register discovery callbacks."""
        self.bluez.connect_to_bluez()
        self.bluez.connect('device-added',
                           lambda mgr, dev: self._add_device(mgr, dev, True))
        self.bluez.connect('device-updated',
                           lambda mgr, dev: self._add_device(mgr, dev, True))

    def stop(self):
        """Stop BLE scanning."""
        self.bluez.stop_discovery()

    # ------------------------------------------------------------------ #
    # Public CLI API                                                       #
    # ------------------------------------------------------------------ #

    def list_devices(self):
        """
        Return a list of dicts for every registered device in config.
        Reads drawings from disk; no BLE scan required.

        Each dict has keys: address, name, uuid, protocol, drawings,
        battery_percent, dimensions.
        """
        result = []
        for addr, cfg in self.config.devices.items():
            drawings = self.config.load_drawings(addr)
            d = self.devices.get(addr)
            result.append({
                'address': addr,
                'name': cfg.get('name', cfg.get('Name', 'UNKNOWN')),
                'uuid': cfg.get('uuid', cfg.get('UUID', '')),
                'protocol': cfg.get('protocol', cfg.get('Protocol', '')),
                'drawings': drawings,
                'battery_percent': d.battery_percent if d else 0,
                'dimensions': d.dimensions if d else (0, 0),
            })
        return result

    def search(self, timeout=30, on_found=None, stop_early=False):
        """
        Scan for unregistered devices for up to *timeout* seconds.

        on_found(address, name) is called (from the BLE thread) each time
        a new unregistered device is detected.  If *stop_early* is True
        the scan stops after the first device is found.

        Returns a list of (address, name) tuples of found devices.
        Blocks until timeout or stop_early fires, respects KeyboardInterrupt.
        """
        found = []
        stop_evt = threading.Event()

        def _cb(address, name):
            found.append((address, name))
            if on_found:
                on_found(address, name)
            if stop_early:
                stop_evt.set()

        self._on_unregistered = _cb
        self.bluez.start_discovery()

        try:
            stop_evt.wait(timeout=timeout)
        except KeyboardInterrupt:
            pass
        finally:
            self.bluez.stop_discovery()
            self._on_unregistered = None

        return found

    def register(self, address, on_button_press=None, timeout=60):
        """
        Initiate registration for a device that was found via search().

        Blocks until registration completes (UUID saved to config) or
        *timeout* seconds elapse.  on_button_press() is called when the
        device asks the user to press its physical button.

        Raises KeyError if *address* is not known (search must be run first).
        """
        d = self.devices.get(address)
        if d is None:
            raise KeyError(f'{address}: not found — run search first')

        app_dev = self._app_devices[address]
        done = threading.Event()

        if on_button_press:
            app_dev.connect('button-press-required',
                            lambda dev: on_button_press())

        def _on_registered(device, pspec):
            if device.registered:
                done.set()

        d.connect('notify::registered', _on_registered)
        d.register()
        done.wait(timeout=timeout)

    def start_listening(self, address, on_drawings=None):
        """
        Start listening for drawings on *address*.  Non-blocking.

        Creates the AppDevice eagerly (before BLE discovery) so that when
        the device is seen in the BLE scan its TuhiDevice will pick up the
        pre-created AppDevice and trigger BLE connection automatically.

        on_drawings(app_device) is called whenever new drawings arrive.

        Raises KeyError if *address* is not registered in config.
        """
        if address not in self.config.devices:
            raise KeyError(f'{address}: not a registered device')

        # Create AppDevice upfront so _add_device can wire TuhiDevice to it
        if address not in self._app_devices:
            self._app_devices[address] = AppDevice()

        app_dev = self._app_devices[address]

        if on_drawings:
            app_dev.connect('notify::drawings-available',
                            lambda dev, pspec: on_drawings(dev))

        app_dev.start_listening()
        self.bluez.start_discovery()

    def stop_listening(self, address):
        """Stop listening for drawings on *address*."""
        app_dev = self._app_devices.get(address)
        if app_dev:
            app_dev.stop_listening()
        # Stop scanning only when no device still needs it
        if not any(dev.listening for dev in self._app_devices.values()):
            self.bluez.stop_discovery()

    def start_live(self, address, on_pen_point=None):
        """
        Start live pen streaming for *address*.  Non-blocking.

        on_pen_point(x, y, pressure, in_proximity) is called on the BLE
        thread for every incoming pen event.  Use root.after(0, ...) in a
        GUI to marshal back to the UI thread.

        Raises KeyError if *address* is not registered in config.
        """
        if address not in self.config.devices:
            raise KeyError(f'{address}: not a registered device')

        if address not in self._app_devices:
            self._app_devices[address] = AppDevice()

        app_dev = self._app_devices[address]

        if on_pen_point:
            app_dev.connect('live-pen-data',
                            lambda dev, x, y, p, inp: on_pen_point(x, y, p, inp))

        app_dev.live = True
        self.bluez.start_discovery()

    def stop_live(self, address):
        """Stop live pen streaming for *address*."""
        app_dev = self._app_devices.get(address)
        if app_dev:
            app_dev.live = False
        if not any(dev.live for dev in self._app_devices.values()):
            self.bluez.stop_discovery()

    def get_app_device(self, address):
        """Return the AppDevice for *address*, or None if not yet created."""
        return self._app_devices.get(address)

    # ------------------------------------------------------------------ #
    # Internal: BLE discovery → TuhiDevice wiring                        #
    # ------------------------------------------------------------------ #

    def _add_device(self, manager, bluez_device, from_live_update=False):
        # Local import avoids a circular dependency at module level:
        # app.py → base_win.py → (no longer imports ipc_server.py after task 5)
        from tuhi.base_win import TuhiDevice

        if (bluez_device.vendor_id is not None
                and bluez_device.vendor_id not in WACOM_COMPANY_IDS):
            return

        try:
            cfg = self.config.devices[bluez_device.address]
            uuid = cfg['uuid']
        except KeyError:
            if bluez_device.vendor_id is None:
                return
            uuid = None

        if uuid is None and from_live_update and len(bluez_device.manufacturer_data or []) == 4:
            mode = DeviceMode.REGISTER
        else:
            mode = DeviceMode.LISTEN
            if uuid is None:
                logger.info(f'{bluez_device.address}: no config — must be registered first')
                return
            logger.debug(f'{bluez_device.address}: UUID {uuid}')

        addr = bluez_device.address

        if addr not in self.devices:
            d = TuhiDevice(bluez_device, self.config, uuid, mode)
            # Reuse a pre-created AppDevice (e.g. from start_listening) or make a new one
            if addr not in self._app_devices:
                self._app_devices[addr] = AppDevice()
            d.dbus_device = self._app_devices[addr]
            d.connect('notify::listening', self._on_listening_updated)
            self.devices[addr] = d

            if mode == DeviceMode.REGISTER and self._on_unregistered:
                self._on_unregistered(addr, bluez_device.name)

        d = self.devices[addr]
        app_dev = self._app_devices[addr]

        if mode == DeviceMode.REGISTER:
            d.mode = mode
        elif app_dev.listening and not d.busy:
            d.listen()

    def _on_discovery_stopped(self, manager):
        self._on_listening_updated(None, None)

    def _on_listening_updated(self, device, pspec):
        needs_scan = any(dev.listening for dev in self._app_devices.values())
        if needs_scan:
            self.bluez.start_discovery()
        else:
            self.bluez.stop_discovery()
