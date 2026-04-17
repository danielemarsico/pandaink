#!/usr/bin/env python3
#
#  Windows-compatible Wacom device module.
#  Uses gobject_compat instead of gi.repository, and uhid_win instead of uhid.
#  The BLE protocol logic is identical to wacom.py.
#

import binascii
import enum
import logging
import threading
import time
import uuid
from pathlib import Path

from tuhi.gobject_compat import Object, Property, TYPE_PYOBJECT, TYPE_INT, TYPE_BOOLEAN
from .drawing_win import Drawing
from .uhid_win import UHIDDevice
import tuhi.protocol
from tuhi.protocol import (NordicData, Interactions, Mode, ProtocolVersion,
                           StrokeFile, UnexpectedDataError, DeviceError,
                           MissingReplyError, AuthorizationError)
from .util import list2hex, flatten
from tuhi.config_win import TuhiConfig

logger = logging.getLogger('tuhi.wacom')

NORDIC_UART_SERVICE_UUID           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
NORDIC_UART_CHRC_TX_UUID           = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
NORDIC_UART_CHRC_RX_UUID           = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
WACOM_LIVE_SERVICE_UUID            = '00001523-1212-efde-1523-785feabcd123'
WACOM_CHRC_LIVE_PEN_DATA_UUID      = '00001524-1212-efde-1523-785feabcd123'
WACOM_OFFLINE_SERVICE_UUID         = 'ffee0001-bbaa-9988-7766-554433221100'
WACOM_OFFLINE_CHRC_PEN_DATA_UUID   = 'ffee0003-bbaa-9988-7766-554433221100'
SYSEVENT_NOTIFICATION_SERVICE_UUID = '3a340720-c572-11e5-86c5-0002a5d5c51b'
SYSEVENT_NOTIFICATION_CHRC_UUID    = '3a340721-c572-11e5-86c5-0002a5d5c51b'


class IDGenerator:
    _session = uuid.uuid4().hex
    _instance = 0

    @classmethod
    def current(cls):
        return f'{cls._session}-{cls._instance}'

    @classmethod
    def next(cls):
        cls._instance += 1
        return cls.current()


@enum.unique
class DeviceMode(enum.Enum):
    REGISTER = 1
    LISTEN = 2
    LIVE = 3


wacom_live_rdesc_template = [
    0x05, 0x0d,                    # Usage Page (Digitizers)
    0x09, 0x01,                    # Usage (Digitizer)
    0xa1, 0x01,                    # Collection (Application)
    0x85, 0x01,                    # .Report ID (1)
    0x09, 0x20,                    # .Usage (Stylus)
    0xa1, 0x00,                    # .Collection (Physical)
    0x09, 0x32,                    # ..Usage (In Range)
    0x15, 0x00,                    # ..Logical Minimum (0)
    0x25, 0x01,                    # ..Logical Maximum (1)
    0x95, 0x01,                    # ..Report Count (1)
    0x75, 0x01,                    # ..Report Size (1)
    0x81, 0x02,                    # ..Input (Data,Var,Abs)
    0x95, 0x07,                    # ..Report Count (7)
    0x81, 0x03,                    # ..Input (Cnst,Var,Abs)
    0x05, 0x01,                    # ..Usage Page (Generic Desktop)
    0x09, 0x30,                    # ..Usage (X)
    0x75, 0x10,                    # ..Report Size (16)
    0x95, 0x01,                    # ..Report Count (1)
    0x55, 0x0d,                    # ..Unit Exponent (-3)
    0x65, 0x11,                    # ..Unit (Centimeter,SILinear)
    0x37, 'x_min',
    0x47, 'x_max',
    0x17, 'x_min',
    0x27, 'x_max',
    0x81, 0x02,                    # ..Input (Data,Var,Abs)
    0x09, 0x31,                    # ..Usage (Y)
    0x37, 'y_min',
    0x47, 'y_max',
    0x17, 'y_min',
    0x27, 'y_max',
    0x81, 0x02,                    # ..Input (Data,Var,Abs)
    0x05, 0x0d,                    # ..Usage Page (Digitizers)
    0x15, 0x00,                    # ..Logical Minimum (0)
    0x09, 0x30,                    # ..Usage (Tip Pressure)
    0x27, 'pressure',
    0x81, 0x02,                    # ..Input (Data,Var,Abs)
    0xc0,                          # .End Collection
    0xc0,                          # End Collection
]


def signed_char_to_int(v):
    return int.from_bytes([v], byteorder='little', signed=True)


def b2hex(bs):
    hx = binascii.hexlify(bs).decode('ascii')
    return ' '.join([''.join(s) for s in zip(hx[::2], hx[1::2])])


def list2hexlist(lst):
    return '[' + ', '.join([f'{x:#04x}' for x in lst]) + ']'


class DataLogger:
    """Log data transfer between device and Tuhi."""

    class _Nordic:
        source = 'NORDIC'
        def __init__(self, parent):
            self.parent = parent
        def recv(self, data):
            return self.parent._recv(self.source, data)
        def request(self, request):
            return self.parent._request(self.source, request)

    class _Pen:
        source = 'PEN'
        def __init__(self, parent):
            self.parent = parent
        def recv(self, data):
            return self.parent._recv(self.source, data)

    class _SysEvent:
        source = 'SYSEVENT'
        def __init__(self, parent):
            self.parent = parent
        def recv(self, data):
            return self.parent._recv(self.source, data)

    def __init__(self, bluez_device):
        self.logger = logging.getLogger('tuhi.fw')
        self.device = bluez_device
        self.btaddr = bluez_device.address
        self.logdir = Path(TuhiConfig().log_dir, self.btaddr.replace(':', '_'), 'raw')
        self.logdir.mkdir(parents=True, exist_ok=True)

        bluez_device.connect('connected', self._on_bluez_connected)
        bluez_device.connect('disconnected', self._on_bluez_disconnected)

        self.nordic = DataLogger._Nordic(self)
        self.pen = DataLogger._Pen(self)
        self.sysevent = DataLogger._SysEvent(self)
        self.logfile = None
        self._in_context = True
        self._last_source = None

    def _on_bluez_connected(self, bluez_device):
        self._init_file()

    def _on_bluez_disconnected(self, bluez_device):
        self._close_file()

    def _init_file(self):
        if self.logfile is not None:
            return
        timestamp = int(time.time())
        t = time.strftime('%Y-%m-%d-%H-%M-%S')  # Windows-safe (no colons)
        fname = f'log-{timestamp}-{t}.yaml'
        path = Path(self.logdir, fname)
        self.logfile = open(path, 'w+')

        session_id = IDGenerator.next()
        self.logger.debug(f'sessionid: {session_id}')
        self.logfile.write(f'sessionid: {session_id}\n')
        self.logfile.write(f'name: {self.device.name}\n')
        self.logfile.write(f'bluetooth: {self.btaddr}\n')
        self.logfile.write(f'time: {timestamp} # host time: {time.strftime("%Y-%m-%d %H:%M:%S")}\n')
        self.logfile.write('data:\n')

    def _close_file(self):
        if self.logfile is None:
            return
        self.logfile.write(f'# closed at {time.strftime("%Y-%m-%d %H:%M:%S")}')
        self.logfile.close()
        self.logfile = None

    def _recv(self, source, data):
        if source in ['NORDIC', 'PEN']:
            convert = lambda values: list2hex(values)
        else:
            convert = lambda values: binascii.hexlify(bytes(values))

        self.logger.debug(f'{self.btaddr}: RX {source} <-- {convert(data)}')
        self._init_file()

        if self._last_source != source:
            self._in_context = False
            self._last_source = source
            self.logfile.write(f'# resetting source to {source}\n')
        prefix = '   ' if self._in_context else '  -'
        self.logfile.write(f'{prefix} recv: {list2hexlist(data)}\n')
        if source != 'NORDIC':
            self.logfile.write(f'    source: {source}\n')

    def _request(self, source, request):
        if request.name:
            self.logger.debug(f'command: {request.name}')
        self.logger.debug(f'{self.btaddr}: TX {source} --> {request.opcode:02x} / {len(request):02x} / {list2hex(request)}')

        self._init_file()
        if request.name:
            self.logfile.write(f'#         {request.name}\n')

        data = [request.opcode, len(request), *request]
        self.logfile.write(f'  - send: {list2hexlist(data)}\n')
        if source != 'NORDIC':
            self.logfile.write(f'    source: {source}\n')

    def __enter__(self):
        self._in_context = True
        return self

    def __exit__(self, *args, **kwargs):
        self._in_context = False


class WacomProtocolLowLevelComm(Object):
    def __init__(self, device):
        Object.__init__(self)
        self.device = device
        self.nordic_answer = []
        self.fw_logger = DataLogger(device)
        self.nordic_event = threading.Semaphore(value=0)

        device.connect_gatt_value(NORDIC_UART_CHRC_RX_UUID,
                                  self._on_nordic_data_received)

    def _on_nordic_data_received(self, name, value):
        self.fw_logger.nordic.recv(value)
        self.nordic_answer += value
        self.nordic_event.release()

    def send_nordic_command(self, request):
        chrc = self.device.characteristics[NORDIC_UART_CHRC_TX_UUID]
        self.fw_logger.nordic.request(request)
        data = [request.opcode, len(request), *request]
        chrc.write_value(data)

    def pop_next_message(self):
        answer = self.nordic_answer
        length = answer[1]
        args = answer[2:]
        if length > len(args):
            raise UnexpectedDataError(answer, f'Invalid answer message length: expected {length}, got {len(args)}')
        self.nordic_answer = self.nordic_answer[length + 2:]
        return NordicData(answer[:length + 2])

    def nordic_data_exchange(self, request, requires_reply=False,
                             userdata=None, timeout=None):
        with self.fw_logger as _:
            if request is not None:
                self.send_nordic_command(request)
            if requires_reply:
                if not self.nordic_event.acquire(timeout=timeout or 5):
                    return None
                return self.pop_next_message()


class WacomRegisterHelper(WacomProtocolLowLevelComm):
    __gsignals__ = {
        'button-press-required': (1, None, ()),
    }

    @classmethod
    def is_spark(cls, device):
        return SYSEVENT_NOTIFICATION_CHRC_UUID not in device.characteristics

    def register_device(self, uuid):
        if self.is_spark(self.device):
            self.p = tuhi.protocol.Protocol(ProtocolVersion.SPARK, self.nordic_data_exchange)
            try:
                self.p.execute(Interactions.CONNECT, uuid)
            except AuthorizationError:
                pass
            except Exception as e:
                logger.exception('Got other Exception while registering Spark device')
                if e.errorcode == DeviceError.ErrorCode.GENERAL_ERROR:
                    pass
                else:
                    raise
            self.p.execute(Interactions.REGISTER_PRESS_BUTTON)
        else:
            self.p = tuhi.protocol.Protocol(ProtocolVersion.SLATE, self.nordic_data_exchange)
            self.p.execute(Interactions.REGISTER_PRESS_BUTTON, uuid)

        logger.info('Press the button now to confirm')
        self.emit('button-press-required')

        protocol_version = self.p.execute(Interactions.REGISTER_WAIT_FOR_BUTTON).protocol_version
        if protocol_version == ProtocolVersion.ANY:
            raise tuhi.protocol.ProtocolError(f'Unknown protocol version: {protocol_version}')
        return protocol_version


class WacomProtocolBase(WacomProtocolLowLevelComm):
    protocol = ProtocolVersion.ANY

    __gsignals__ = {
        'drawing': (1, None, (TYPE_PYOBJECT,)),
        'battery-status': (1, None, (TYPE_INT, TYPE_BOOLEAN)),
        'live-pen-data': (1, None, (TYPE_INT, TYPE_INT, TYPE_INT, TYPE_BOOLEAN)),
    }

    def __init__(self, device, uuid, protocol_version=ProtocolVersion.ANY):
        super().__init__(device)
        self.p = tuhi.protocol.Protocol(protocol_version, self.nordic_data_exchange)
        self._uuid = uuid
        self._timestamp = 0
        self.pen_data_buffer = []
        self._uhid_device = None
        self._last_pen_data_time = time.time() - 5

        device.connect_gatt_value(WACOM_CHRC_LIVE_PEN_DATA_UUID,
                                  self._on_pen_data_changed)
        device.connect_gatt_value(WACOM_OFFLINE_CHRC_PEN_DATA_UUID,
                                  self._on_pen_data_received)

    @Property
    def dimensions(self):
        return (self.width, self.height)

    def _on_pen_data_changed(self, name, value):
        logger.debug(binascii.hexlify(bytes(value)))

        if value[0] == 0x10:
            pressure = int.from_bytes(value[2:4], byteorder='little')
            buttons = int(value[10])
            logger.debug(f'New Pen Data: pressure: {pressure}, button: {buttons}')
        elif value[0] == 0xa2:
            length = value[1]
            timestamp = int.from_bytes(value[4:], byteorder='little') * 5
            self._timestamp = timestamp
            logger.debug(f'Pen entered proximity, timestamp: {timestamp}')
        elif value[0] == 0xa1:
            length = value[1]
            if length % 6 != 0:
                logger.error(f'wrong data: {binascii.hexlify(bytes(value))}')
                return
            data = value[2:]
            while data:
                if bytes(data[:6]) == b'\xff\xff\xff\xff\xff\xff':
                    logger.debug('Pen left proximity')
                    self.emit('live-pen-data', 0, 0, 0, False)
                    if self._uhid_device is not None:
                        self._uhid_device.call_input_event([1, 0, 0, 0, 0, 0, 0, 0])
                else:
                    x = int.from_bytes(data[0:2], byteorder='little')
                    y = int.from_bytes(data[2:4], byteorder='little')
                    pressure = int.from_bytes(data[4:6], byteorder='little')
                    logger.debug(f'New Pen Data: ({x},{y}), pressure: {pressure}')
                    self.emit('live-pen-data', x, y, pressure, True)
                    if self._uhid_device is not None:
                        self._uhid_device.call_input_event([1, 1, *data[:6]])
                data = data[6:]
                self._timestamp += 5

    def _on_pen_data_received(self, name, data):
        self.fw_logger.pen.recv(data)
        self.pen_data_buffer.extend(data)
        self._last_pen_data_time = time.time()

    def check_connection(self):
        self.p.execute(Interactions.CONNECT, self._uuid)

    def e3_command(self):
        self.p.execute(Interactions.UNKNOWN_E3)

    @classmethod
    def time_from_bytes(self, data):
        assert len(data) >= 6
        str_timestamp = ''.join([f'{d:02x}' for d in data])
        return time.strptime(str_timestamp, '%y%m%d%H%M%S')

    def set_time(self):
        self.p.execute(Interactions.SET_TIME, time.time())

    def read_time(self):
        ts = self.p.execute(Interactions.GET_TIME).timestamp
        t = time.gmtime(ts)
        logger.debug(f'device time: UTC {time.strftime("%y%m%d%H%M%S", t)}')
        tdelta = time.mktime(time.gmtime()) - time.mktime(t)
        if abs(tdelta) > 300:
            logger.error('device time is out by more than 5 minutes')

    def get_battery_info(self):
        msg = self.p.execute(Interactions.GET_BATTERY)
        logger.info(f'device battery: {msg.battery_percent}% ({"dis" if not msg.battery_is_charging else ""}charging)')
        return msg.battery_percent, msg.battery_is_charging

    def get_firmware_version(self):
        fw = self.p.execute(Interactions.GET_FIRMWARE).firmware
        logger.info(f'firmware is {fw}')
        return fw

    def get_name(self):
        name = self.p.execute(Interactions.GET_NAME).name
        logger.info(f'device name is {name}')
        return name

    def update_dimensions(self):
        w = self.p.execute(Interactions.GET_WIDTH).width
        h = self.p.execute(Interactions.GET_HEIGHT).height
        ps = self.p.execute(Interactions.GET_POINT_SIZE).point_size
        logger.info(f'dimensions: {w}x{h}, point size {ps}um')
        self.point_size = ps
        self.width = w * ps
        self.height = h * ps
        self.notify('dimensions')
        return w, h

    def select_transfer_gatt(self):
        self.p.execute(Interactions.SET_FILE_TRANSFER_REPORTING_TYPE)

    def start_live(self, fd):
        self.p.execute(Interactions.SET_MODE, Mode.LIVE)
        logger.debug(f'Starting wacom live mode on fd: {fd}')

        rdesc = wacom_live_rdesc_template[:]
        for i, v in enumerate(rdesc):
            if isinstance(v, str):
                v = getattr(self, v)
                rdesc[i] = list(int.to_bytes(v, 4, 'little', signed=True))

        uhid_device = UHIDDevice(fd)
        uhid_device.rdesc = list(flatten(rdesc))
        uhid_device.name = self.device.name
        uhid_device.info = (5, 0x056a, 0x0001)
        uhid_device.create_kernel_device()
        self._uhid_device = uhid_device

    def stop_live(self):
        self.p.execute(Interactions.SET_MODE, Mode.IDLE)

    def set_paper_mode(self):
        self.p.execute(Interactions.SET_MODE, Mode.PAPER).execute()

    def count_available_files(self):
        n = self.p.execute(Interactions.AVAILABLE_FILES_COUNT).count
        logger.debug(f'Drawings available: {n}')
        return n

    def get_stroke_data(self):
        msg = self.p.execute(Interactions.GET_STROKES)
        return msg.count, msg.timestamp

    def start_downloading_oldest_file(self):
        self.p.execute(Interactions.DOWNLOAD_OLDEST_FILE)

    def wait_for_end_read(self, timeout=5):
        msg = None
        while True:
            try:
                msg = self.p.execute(Interactions.WAIT_FOR_END_READ)
                break
            except MissingReplyError as e:
                if time.time() - self._last_pen_data_time > timeout:
                    raise e

        pen_data = self.pen_data_buffer
        self.pen_data_buffer = []
        if msg.crc != binascii.crc32(bytes(pen_data)):
            raise UnexpectedDataError(pen_data, message='CRCs do not match')
        return pen_data

    def retrieve_data(self):
        try:
            self.check_connection()
            self.e3_command()
            self.set_time()
            battery, charging = self.get_battery_info()
            self.emit('battery-status', battery, charging)
            self.update_dimensions()
            if not self.read_offline_data():
                logger.info('no data to retrieve')
        except DeviceError as e:
            if e.errorcode == DeviceError.ErrorCode.INVALID_STATE:
                logger.warning('no data, please make sure the LED is blue and the button is pressed to switch it back to green')
            else:
                raise e

    def delete_oldest_file(self):
        self.p.execute(Interactions.DELETE_OLDEST_FILE)

    def get_coordinate(self, bitmask, n, data, v, dv):
        bitmask >>= 2
        data = data[2:]
        is_rel = False

        full_coord_bitmask = 0b11 << (2 * n)
        delta_coord_bitmask = 0b10 << (2 * n)
        if (bitmask & full_coord_bitmask) == full_coord_bitmask:
            v = int.from_bytes(data[2 * n:2 * n + 2], byteorder='little')
            dv = 0
        elif bitmask & delta_coord_bitmask:
            dv += signed_char_to_int(data[2 * n + 1])
            is_rel = True
        return v, dv, is_rel

    def parse_pen_data_prefix(self, data):
        file_format = b'\x62\x38\x62\x74'
        prefix = data[:4]
        offset = len(prefix)
        if bytes(prefix) != file_format:
            logger.debug(f'Unsupported file format {prefix} (require {file_format})')
            return False, 0
        return True, offset

    def parse_pen_data(self, data, timestamp):
        f = StrokeFile(data)
        drawing = Drawing(self.device.name, (self.width, self.height), timestamp)
        drawing.session_id = IDGenerator.current()
        ps = self.point_size

        def normalize(p):
            NORMALIZED_RANGE = 0x10000
            return NORMALIZED_RANGE * p / self.pressure

        for s in f.strokes:
            stroke = drawing.new_stroke()
            for p in s.points:
                stroke.new_abs((p.x * ps, p.y * ps), normalize(p.p))
            stroke.seal()
        drawing.seal()
        return drawing

    def read_offline_data(self):
        self.set_paper_mode()
        file_count = self.count_available_files()
        rc = file_count > 0
        while file_count > 0:
            count, timestamp = self.get_stroke_data()
            logger.info(f'receiving {count} bytes drawn on UTC {time.strftime("%y%m%d%H%M%S", time.gmtime(timestamp))}')
            self.start_downloading_oldest_file()
            pen_data = self.wait_for_end_read()
            str_pen = binascii.hexlify(bytes(pen_data))
            logger.info(f'received {str_pen}')
            drawing = self.parse_pen_data(pen_data, timestamp)
            if drawing:
                self.emit('drawing', drawing)
            file_count -= 1
            if TuhiConfig().peek_at_drawing:
                logger.info('Not deleting drawing from device')
                if file_count > 0:
                    logger.info(f'{file_count} more files on device but I can only download the oldest one')
                break
            self.delete_oldest_file()
        return rc

    def set_name(self, name):
        self.p.execute(Interactions.SET_NAME, name)

    def register_device_finish(self):
        self.p.execute(Interactions.REGISTER_COMPLETE)
        self.set_time()
        self.read_time()
        self.get_name()
        self.get_firmware_version()
        self.update_dimensions()

    def live_mode(self, mode, uhid):
        try:
            if mode:
                self.check_connection()
                self.start_live(uhid)
            else:
                self.stop_live()
        except DeviceError as e:
            if e.errorcode == DeviceError.ErrorCode.INVALID_STATE:
                logger.warning("no data, please make sure the LED is blue and the button is pressed to switch it back to green")
            else:
                raise e


class WacomProtocolSpark(WacomProtocolBase):
    width = 21000
    x_min = 2100
    x_max = 21000
    height = 14800
    y_min = 0
    y_max = 14800
    pressure = 1023
    point_size = 10
    protocol = ProtocolVersion.SPARK
    orientation = 'portrait'

    def __init__(self, device, uuid, protocol_version=ProtocolVersion.SPARK):
        assert protocol_version >= ProtocolVersion.SPARK
        super().__init__(device, uuid, protocol_version=protocol_version)


class WacomProtocolSlate(WacomProtocolSpark):
    width = 21600
    x_min = 2500
    x_max = 20600
    height = 14800
    y_min = 500
    y_max = 14300
    pressure = 2047
    point_size = 10
    protocol = ProtocolVersion.SLATE
    orientation = 'portrait'

    def __init__(self, device, uuid, protocol_version=ProtocolVersion.SLATE):
        assert protocol_version >= ProtocolVersion.SLATE
        super().__init__(device, uuid, protocol_version=protocol_version)
        device.connect_gatt_value(SYSEVENT_NOTIFICATION_CHRC_UUID,
                                  self._on_sysevent_data_received)

    def live_mode(self, mode, uhid):
        if mode:
            self.check_connection()
            self.update_dimensions()
            self.x_max = int(self.width / self.point_size) - 1000
            self.y_max = int(self.height / self.point_size) - 500
        return super().live_mode(mode, uhid)

    def _on_sysevent_data_received(self, name, value):
        self.fw_logger.sysevent.recv(value)

    def register_device_finish(self):
        self.set_time()
        self.read_time()
        self.select_transfer_gatt()
        self.get_name()
        self.update_dimensions()
        self.notify('dimensions')
        self.get_firmware_version()
        battery, charging = self.get_battery_info()
        self.emit('battery-status', battery, charging)

    def retrieve_data(self):
        try:
            self.check_connection()
            self.set_time()
            battery, charging = self.get_battery_info()
            self.emit('battery-status', battery, charging)
            self.update_dimensions()
            self.notify('dimensions')
            self.get_firmware_version()
            self.select_transfer_gatt()
            if not self.read_offline_data():
                logger.info('no data to retrieve')
        except DeviceError as e:
            if e.errorcode == DeviceError.ErrorCode.INVALID_STATE:
                logger.warning('no data, please make sure the LED is blue and the button is pressed to switch it back to green')
            else:
                raise e


class WacomProtocolIntuosPro(WacomProtocolSlate):
    width = 44800
    x_min = 0
    x_max = 44800
    height = 29600
    y_min = 0
    y_max = 29600
    pressure = 8192
    point_size = 5
    protocol = ProtocolVersion.INTUOS_PRO
    orientation = 'landscape'

    def __init__(self, device, uuid, protocol_version=ProtocolVersion.INTUOS_PRO):
        assert protocol_version >= ProtocolVersion.INTUOS_PRO
        super().__init__(device, uuid, protocol_version=protocol_version)

    @classmethod
    def time_from_bytes(self, data):
        seconds = int.from_bytes(data[0:4], byteorder='little')
        return time.gmtime(seconds)

    def parse_pen_data_prefix(self, data):
        file_format = b'\x67\x82\x69\x65'
        prefix = data[:4]
        if bytes(prefix) != file_format:
            logger.debug(f'Unsupported file format {prefix} (require {file_format})')
            return False, 0
        t = self.time_from_bytes(data[4:10])
        nstrokes = int.from_bytes(data[10:14], byteorder='little')
        timestamp = time.strftime('%Y%m%d-%H%M%S', t)
        logger.debug(f'Drawing timestamp: {timestamp}, {nstrokes} strokes')
        return True, 16


class WacomDevice(Object):
    __gsignals__ = {
        'drawing': (1, None, (TYPE_PYOBJECT,)),
        'done': (1, None, (TYPE_PYOBJECT,)),
        'button-press-required': (1, None, ()),
        'battery-status': (1, None, (TYPE_INT, TYPE_BOOLEAN)),
        'live-pen-data': (1, None, (TYPE_INT, TYPE_INT, TYPE_INT, TYPE_BOOLEAN)),
    }

    def __init__(self, device, config=None):
        Object.__init__(self)
        self._device = device
        self.thread = None
        self._is_running = False
        self._config = None
        self._wacom_protocol = None
        self._sync_state = 0

        try:
            self._config = config.devices[device.address]
        except KeyError:
            self._uuid = None
        else:
            self._uuid = self._config['uuid']
            try:
                protocol = ProtocolVersion.from_string(self._config['Protocol'])
                self._init_protocol(protocol)
            except (KeyError, ValueError):
                logger.error('Missing or invalid Protocol entry in config file. Treating as unregistered')
                self._uuid = None

    def _init_protocol(self, protocol):
        protocols = {
            ProtocolVersion.SPARK: WacomProtocolSpark,
            ProtocolVersion.SLATE: WacomProtocolSlate,
            ProtocolVersion.INTUOS_PRO: WacomProtocolIntuosPro,
        }
        if protocol not in protocols:
            raise NotImplementedError(f'Protocol "{protocol}" not implemented')
        pclass = protocols[protocol]
        self._wacom_protocol = pclass(self._device, self._uuid)
        logger.debug(f'{self._device.name} is using protocol {protocol.name}')

        self._wacom_protocol.connect(
            'drawing',
            lambda protocol, drawing, self: self.emit('drawing', drawing),
            self)
        self._wacom_protocol.connect(
            'battery-status',
            lambda prot, percent, is_charging, self: self.emit('battery-status', percent, is_charging),
            self)
        self._wacom_protocol.connect(
            'live-pen-data',
            lambda prot, x, y, pressure, in_proximity, self: self.emit('live-pen-data', x, y, pressure, in_proximity),
            self)
        self._wacom_protocol.connect('notify::dimensions', self._on_dimensions)

    @Property
    def dimensions(self):
        return self._wacom_protocol.dimensions

    def _on_dimensions(self, protocol, pspec):
        self.notify('dimensions')

    @Property
    def uuid(self):
        assert self._uuid is not None
        return self._uuid

    @Property
    def protocol(self):
        assert self._wacom_protocol is not None
        return self._wacom_protocol.protocol

    @Property
    def sync_state(self):
        return self._sync_state

    @sync_state.setter
    def sync_state(self, state):
        self._sync_state = state

    def _load_or_generate_uuid(self):
        uuid_file = Path(TuhiConfig().log_dir, 'cached_uuid.txt')
        if uuid_file.is_file():
            cached = uuid_file.read_text().strip()
            if len(cached) == 12:
                logger.debug(f'{self._device.address}: reusing cached UUID from {uuid_file}')
                return cached
            logger.warning(f'{self._device.address}: invalid cached UUID, generating new one')
        new_uuid = uuid.uuid4().hex[:12]
        uuid_file.parent.mkdir(parents=True, exist_ok=True)
        uuid_file.write_text(new_uuid)
        logger.debug(f'{self._device.address}: generated and cached new UUID to {uuid_file}')
        return new_uuid

    def register_device(self):
        self._uuid = self._load_or_generate_uuid()
        logger.debug(f'{self._device.address}: registering device, assigned {self.uuid}')

        wp = WacomRegisterHelper(self._device)
        s = wp.connect('button-press-required',
                       lambda protocol, self: self.emit('button-press-required'),
                       self)
        protocol = wp.register_device(self._uuid)
        wp.disconnect(s)
        del wp

        self._init_protocol(protocol)
        self._wacom_protocol.register_device_finish()
        logger.info('registration completed')
        self.notify('uuid')

    def _run(self, *args, **kwargs):
        if self._is_running:
            logger.error(f'{self._device.address}: already synching, ignoring this request')
            return

        mode = args[0]
        logger.debug(f'{self._device.address}: starting for mode {mode.name}')
        self._is_running = True
        exception = None
        try:
            if mode == DeviceMode.LIVE:
                assert self._wacom_protocol is not None
                self._wacom_protocol.live_mode(args[1], args[2])
            elif mode == DeviceMode.REGISTER:
                self.register_device()
            else:
                assert self._wacom_protocol is not None
                self.sync_state = 1
                self._wacom_protocol.retrieve_data()
        except DeviceError as e:
            logger.error(f'**** Exception: {e} ****')
            exception = e
        except AuthorizationError as e:
            logger.error('Authorization failed, device needs to be re-registered')
            exception = e
        except MissingReplyError as e:
            logger.warning(f'{self._device.address}: no reply from device (timeout or disconnect)')
            exception = e
        finally:
            self.sync_state = 0
            self._is_running = False
            self.emit('done', exception)

    def start_listen(self):
        if self._is_running:
            logger.warning(f'{self._device.address}: already syncing, ignoring start_listen')
            return
        self.thread = threading.Thread(target=self._run, args=(DeviceMode.LISTEN,))
        self.thread.start()

    def start_live(self, uhid_fd):
        self.thread = threading.Thread(target=self._run, args=(DeviceMode.LIVE, True, uhid_fd))
        self.thread.start()

    def stop_live(self):
        if not self._device._connected:
            logger.debug(f'{self._device.address}: device not connected, skipping stop_live')
            return
        self.thread = threading.Thread(target=self._run, args=(DeviceMode.LIVE, False, -1))
        self.thread.start()

    def start_register(self):
        self.thread = threading.Thread(target=self._run, args=(DeviceMode.REGISTER,))
        self.thread.start()
