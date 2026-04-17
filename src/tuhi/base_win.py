#!/usr/bin/env python3
#
#  tuhi/base_win.py — Core device glue for the Windows port.
#
#  Contains TuhiDevice: the object that binds a BleakBLEDevice to its
#  AppDevice (in-process state) and drives the Wacom protocol state machine.
#
#  The old Tuhi orchestrator class (which required an IPC server) has been
#  replaced by TuhiApp in app.py.
#

import argparse
import enum
import logging
import sys
import time
import threading
from pathlib import Path

from tuhi.gobject_compat import Object, Property, TYPE_PYOBJECT
from tuhi.ble_bleak import BleakDeviceManager
from tuhi.wacom_win import WacomDevice, DeviceMode
from tuhi.config_win import TuhiConfig, get_default_data_dir

DEFAULT_CONFIG_PATH = get_default_data_dir()

logger = logging.getLogger('tuhi')

WACOM_COMPANY_IDS = [0x4755, 0x4157, 0x424d]


class TuhiDevice(Object):
    """
    Glue object that binds a BleakBLEDevice to its in-process AppDevice and
    drives the Wacom protocol state machine.

    The 'dbus_device' slot accepts any object that satisfies the AppDevice
    interface (signals: register-requested, notify::listening, notify::live;
    methods: add_drawing(), notify_button_press_required(); property: uhid_fd).
    """

    class BatteryState(enum.Enum):
        UNKNOWN = 0
        CHARGING = 1
        DISCHARGING = 2

    __gsignals__ = {
        'device-error': (1, None, (TYPE_PYOBJECT,)),
    }

    def __init__(self, bluez_device, config, uuid=None, mode=DeviceMode.LISTEN):
        Object.__init__(self)
        self.config = config
        self._wacom_device = None
        assert uuid is not None or mode == DeviceMode.REGISTER
        self._mode = mode
        self._battery_state = TuhiDevice.BatteryState.UNKNOWN
        self._battery_percent = 0
        self._signals = {'connected': None, 'disconnected': None}
        self._bluez_device = bluez_device
        self._tuhi_dbus_device = None

    @Property
    def dimensions(self):
        if self._wacom_device is None:
            return 0, 0
        return self._wacom_device.dimensions

    @Property
    def mode(self):
        return self._mode

    @mode.setter
    def mode(self, mode):
        if self._mode != mode:
            self._mode = mode
            self.notify('registered')

    @Property
    def registered(self):
        return self.mode == DeviceMode.LISTEN

    @Property
    def name(self):
        return self._bluez_device.name

    @Property
    def address(self):
        return self._bluez_device.address

    @Property
    def bluez_device(self):
        return self._bluez_device

    @Property
    def dbus_device(self):
        return self._tuhi_dbus_device

    @dbus_device.setter
    def dbus_device(self, device):
        assert self._tuhi_dbus_device is None
        self._tuhi_dbus_device = device
        self._tuhi_dbus_device.connect('register-requested', self._on_register_requested)
        self._tuhi_dbus_device.connect('notify::listening', self._on_listening_updated)
        self._tuhi_dbus_device.connect('notify::live', self._on_live_updated)

        drawings = self.config.load_drawings(self.address)
        if drawings:
            logger.debug(f'{self.address}: loaded {len(drawings)} drawings from disk')
        for d in drawings:
            self._tuhi_dbus_device.add_drawing(d)

    @Property
    def listening(self):
        return self._tuhi_dbus_device.listening

    @Property
    def live(self):
        return self._tuhi_dbus_device.live

    @Property
    def battery_percent(self):
        return self._battery_percent

    @battery_percent.setter
    def battery_percent(self, value):
        self._battery_percent = value

    @Property
    def battery_state(self):
        return self._battery_state

    @battery_state.setter
    def battery_state(self, value):
        self._battery_state = value

    @Property
    def sync_state(self):
        return self._sync_state

    @Property
    def busy(self):
        """True while a WacomDevice _run thread is active."""
        return self._wacom_device is not None and self._wacom_device._is_running

    def _connect_device(self, mode):
        if self._signals['connected'] is None:
            self._signals['connected'] = self._bluez_device.connect(
                'connected', self._on_bluez_device_connected, mode)
        if self._signals['disconnected'] is None:
            self._signals['disconnected'] = self._bluez_device.connect(
                'disconnected', self._on_bluez_device_disconnected)
        self._bluez_device.connect_device()

    def register(self):
        self._connect_device(DeviceMode.REGISTER)

    def listen(self):
        self._connect_device(DeviceMode.LISTEN)

    def _on_bluez_device_connected(self, bluez_device, mode):
        logger.debug(f'{bluez_device.address}: connected for {mode}')
        if self._wacom_device is None:
            self._wacom_device = WacomDevice(bluez_device, self.config)
            self._wacom_device.connect('drawing', self._on_drawing_received)
            self._wacom_device.connect('done', self._on_fetching_finished, bluez_device)
            self._wacom_device.connect('button-press-required', self._on_button_press_required)
            self._wacom_device.connect('notify::uuid', self._on_uuid_updated, bluez_device)
            self._wacom_device.connect('battery-status', self._on_battery_status, bluez_device)
            self._wacom_device.connect('notify::sync-state', self._on_sync_state)
            self._wacom_device.connect('notify::dimensions', self._on_dimensions)

        if mode == DeviceMode.REGISTER:
            self._wacom_device.start_register()
        elif mode == DeviceMode.LIVE:
            self._wacom_device.connect(
                'live-pen-data',
                lambda wdev, x, y, p, inp, ddev: ddev.emit('live-pen-data', x, y, p, inp),
                self._tuhi_dbus_device)
            self._wacom_device.start_live(self._tuhi_dbus_device.uhid_fd)
        else:
            self._wacom_device.start_listen()

        try:
            bluez_device.disconnect(self._signals['connected'])
            self._signals['connected'] = None
        except KeyError:
            pass

    def _on_dimensions(self, device, pspec):
        self.notify('dimensions')

    def _on_sync_state(self, device, pspec):
        self._sync_state = device.sync_state
        self.notify('sync-state')

    def _on_bluez_device_disconnected(self, bluez_device):
        logger.debug(f'{bluez_device.address}: disconnected')
        try:
            bluez_device.disconnect(self._signals['disconnected'])
            self._signals['disconnected'] = None
        except KeyError:
            pass

    def _on_register_requested(self, dbus_device):
        if self.mode == DeviceMode.LISTEN:
            return
        self.register()

    def _on_drawing_received(self, device, drawing):
        logger.debug('Drawing received')
        self._tuhi_dbus_device.add_drawing(drawing)
        self.config.store_drawing(self.address, drawing)

    def _on_fetching_finished(self, device, exception, bluez_device):
        if self.live:
            return
        bluez_device.disconnect_device()
        if exception is not None:
            logger.info(exception)
            self.emit('device-error', exception)

    def _on_button_press_required(self, device):
        self._tuhi_dbus_device.notify_button_press_required()

    def _on_uuid_updated(self, wacom_device, pspec, bluez_device):
        self.config.new_device(bluez_device.address, wacom_device.uuid, wacom_device.protocol,
                               name=bluez_device.name)
        self.mode = DeviceMode.LISTEN

    def _on_listening_updated(self, dbus_device, pspec):
        self.notify('listening')

    def _on_live_updated(self, dbus_device, pspec):
        if self.live:
            self._connect_device(DeviceMode.LIVE)
        else:
            if self._wacom_device is not None:
                self._wacom_device.stop_live()

    def _on_battery_status(self, wacom_device, percent, is_charging, bluez_device):
        # Fetch once on connect; no cross-invocation timer in single-process mode.
        self.battery_state = (TuhiDevice.BatteryState.CHARGING
                              if is_charging else TuhiDevice.BatteryState.DISCHARGING)
        self.battery_percent = percent


def setup_logging(config_dir):
    session_log_file = Path(config_dir, 'session-logs',
                            f'tuhi-{time.strftime("%y-%m-%d-%H-%M-%S")}.log')
    session_log_file.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        fmt='%(asctime)s %(levelname)s: %(name)s: %(message)s',
        datefmt='%H:%M:%S')

    fh = logging.FileHandler(session_log_file)
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(formatter)

    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    logger.addHandler(fh)
    logger.info(f'Session log: {session_log_file}')
