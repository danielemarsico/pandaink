#!/usr/bin/env python3
#
#  BLE backend using the bleak library (cross-platform, works on Windows).
#  Replaces ble.py which depends on BlueZ (Linux-only).
#

import asyncio
import logging
import threading
from tuhi.gobject_compat import Object, Property, timeout_add_seconds, TYPE_PYOBJECT

logger = logging.getLogger('tuhi.ble')

# Import bleak - must be installed: pip install bleak
from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic


class BleakCharacteristic:
    """
    Abstraction for a BLE GATT characteristic, using bleak.
    Replaces BlueZCharacteristic.
    """
    def __init__(self, client, characteristic):
        self._client = client
        self._characteristic = characteristic
        self._property_callbacks = {}
        self._notifying = False

    @property
    def uuid(self):
        return self._characteristic.uuid

    def connect_property(self, propname, callback):
        self._property_callbacks[propname] = callback

    def start_notify(self):
        """Start notifications on this characteristic."""
        if self._notifying:
            return
        loop = self._client._loop
        asyncio.run_coroutine_threadsafe(
            self._client._bleak_client.start_notify(
                self._characteristic.uuid,
                self._on_notification
            ),
            loop
        ).result(timeout=10)
        self._notifying = True

    def write_value(self, data):
        """Write data to this characteristic."""
        loop = self._client._loop
        asyncio.run_coroutine_threadsafe(
            self._client._bleak_client.write_gatt_char(
                self._characteristic.uuid,
                bytes(data),
                response=False
            ),
            loop
        ).result(timeout=10)

    def _on_notification(self, sender, data):
        """Called by bleak when a notification is received."""
        value = list(data)
        for name, callback in self._property_callbacks.items():
            try:
                callback(name, value)
            except Exception:
                logger.exception('Error in characteristic notification callback')

    def __repr__(self):
        return f'Characteristic {self.uuid}'


class BleakBLEDevice(Object):
    """
    Abstraction for a BLE device using bleak.
    Replaces BlueZDevice.
    """
    __gsignals__ = {
        'connected': (1, None, ()),
        'disconnected': (1, None, ()),
        'updated': (1, None, ()),
    }

    def __init__(self, scanner_device, advertisement_data, loop):
        Object.__init__(self)
        self._scanner_device = scanner_device
        self._advertisement_data = advertisement_data
        self._loop = loop
        self._bleak_client = None
        self._connected = False
        self._connecting = False   # prevents concurrent connection attempts
        self.characteristics = {}
        self.logger = logger.getChild(self.address)

    @Property
    def objpath(self):
        # No object path on Windows, use address as identifier
        return self.address.replace(':', '_')

    @Property
    def name(self):
        return self._scanner_device.name or 'UNKNOWN'

    @Property
    def address(self):
        return self._scanner_device.address

    @Property
    def uuids(self):
        if self._advertisement_data is not None:
            return list(self._advertisement_data.service_uuids)
        return []

    @Property
    def vendor_id(self):
        if self._advertisement_data is not None:
            mfr_data = self._advertisement_data.manufacturer_data
            if mfr_data:
                return next(iter(mfr_data.keys()), None)
        return None

    @Property
    def connected(self):
        return self._connected

    @Property
    def manufacturer_data(self):
        if self._advertisement_data is not None:
            mfr_data = self._advertisement_data.manufacturer_data
            if mfr_data:
                return next(iter(mfr_data.values()), None)
        return None

    def connect_device(self):
        """Connect to the BLE device asynchronously."""
        if self._connected:
            self.logger.info('Device is already connected')
            self.emit('connected')
            return

        if self._connecting:
            self.logger.debug('Connection already in progress, ignoring duplicate request')
            return

        self._connecting = True
        self.logger.debug('Connecting')

        def _connect():
            # Keep the client reference local so concurrent calls can't clobber it.
            client = BleakClient(
                self._scanner_device.address,
                disconnected_callback=self._on_disconnected
            )
            try:
                future = asyncio.run_coroutine_threadsafe(
                    self._async_connect(client), self._loop
                )
                future.result(timeout=30)
            except Exception as e:
                self.logger.error(f'Connection failed: {e}')
                self._connecting = False

        t = threading.Thread(target=_connect, daemon=True)
        t.start()

    async def _async_connect(self, client):
        await client.connect()
        # Resolve characteristics
        for service in client.services:
            for char in service.characteristics:
                uuid = char.uuid
                if uuid not in self.characteristics:
                    self.characteristics[uuid] = BleakCharacteristic(self, char)
                    self.logger.debug(f'GattCharacteristic: {uuid}')

        # Publish the connected client only after service discovery succeeds.
        self._bleak_client = client
        self._connected = True
        self._connecting = False
        threading.Thread(target=self.emit, args=('connected',), daemon=True).start()

    def _on_disconnected(self, client):
        self._connected = False
        self.logger.debug('Disconnected')
        self.emit('disconnected')

    def disconnect_device(self):
        """Disconnect from the BLE device."""
        if not self._connected:
            self.logger.info('Device is already disconnected')
            self.emit('disconnected')
            return

        self.logger.debug('Disconnecting')
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._bleak_client.disconnect(), self._loop
            )
            future.result(timeout=10)
        except Exception as e:
            self.logger.error(f'Disconnection failed: {e}')

    def connect_gatt_value(self, uuid, callback):
        """Connect Value property changes of a GATT characteristic to callback."""
        try:
            chrc = self.characteristics[uuid]
            chrc.connect_property('Value', callback)
            chrc.start_notify()
        except KeyError:
            pass

    def update_scanner_device(self, scanner_device, advertisement_data):
        """Update the underlying scanner device data (during discovery)."""
        self._scanner_device = scanner_device
        self._advertisement_data = advertisement_data
        self.emit('updated')

    def __repr__(self):
        return f'Device {self.name}:{self.address}'


class BleakDeviceManager(Object):
    """
    Manager that discovers and tracks BLE devices using bleak.
    Replaces BlueZDeviceManager.
    """
    __gsignals__ = {
        'device-added': (1, None, (TYPE_PYOBJECT,)),
        'device-updated': (1, None, (TYPE_PYOBJECT,)),
        'discovery-started': (1, None, ()),
        'discovery-stopped': (1, None, ()),
    }

    def __init__(self, **kwargs):
        Object.__init__(self, **kwargs)
        self.devices = []
        self._discovery = False
        self._scanner = None
        self._loop = None
        self._loop_thread = None
        self._known_addresses = set()

    def connect_to_bluez(self):
        """
        Initialize the BLE subsystem. Named to match the BlueZ API but
        actually starts a bleak event loop.
        """
        # Start a dedicated asyncio event loop for BLE operations
        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._loop.run_forever, daemon=True
        )
        self._loop_thread.start()
        logger.debug('BLE event loop started')

    def _detection_callback(self, device, advertisement_data):
        """Called by BleakScanner when a device is detected."""
        if device.address in self._known_addresses:
            # Update existing device
            for d in self.devices:
                if d.address == device.address:
                    d.update_scanner_device(device, advertisement_data)
                    self.emit('device-updated', d)
                    return

        self._known_addresses.add(device.address)
        dev = BleakBLEDevice(device, advertisement_data, self._loop)
        self.devices.append(dev)
        self.emit('device-added', dev)

    def start_discovery(self, timeout=0):
        """Start BLE discovery."""
        self.emit('discovery-started')
        if self._discovery:
            return

        self._discovery = True

        async def _scan():
            self._scanner = BleakScanner(
                detection_callback=self._detection_callback
            )
            await self._scanner.start()
            logger.debug('Discovery started')

        asyncio.run_coroutine_threadsafe(_scan(), self._loop)

    def stop_discovery(self):
        """Stop BLE discovery."""
        if not self._discovery:
            return

        self._discovery = False

        async def _stop():
            if self._scanner is not None:
                try:
                    await self._scanner.stop()
                except Exception as e:
                    logger.debug(f'Failed to stop discovery: {e}')
            logger.debug('Discovery stopped')

        asyncio.run_coroutine_threadsafe(_stop(), self._loop)
        self.emit('discovery-stopped')
