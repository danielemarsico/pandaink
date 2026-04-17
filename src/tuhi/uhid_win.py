#!/usr/bin/env python3
#
#  Windows stub for UHID (Linux kernel HID subsystem).
#
#  On Linux, UHID creates a virtual HID device in /dev/uhid so pen data
#  can be injected into the kernel and consumed by apps like GIMP/Krita.
#
#  On Windows, there is no equivalent without a custom virtual HID driver
#  (e.g. ViGEmBus or a custom KMDF driver). This stub logs pen data and
#  provides the same interface, but does not inject input.
#
#  Future: could integrate with ViGEmBus, vhid, or a custom HID minidriver.
#

import logging
import struct
import uuid

from tuhi.gobject_compat import Object, Property

logger = logging.getLogger('tuhi.uhid_win')


class UHIDUncompleteException(Exception):
    pass


class UHIDDevice(Object):
    """
    Stub UHIDDevice for Windows. Provides the same interface as the Linux
    uhid.py UHIDDevice but does not actually inject input into the OS.
    Pen data events are logged for debugging and future integration.
    """

    UHID_CREATE2 = 11
    UHID_INPUT2 = 12
    UHID_DESTROY = 1

    def __init__(self, fd=None):
        Object.__init__(self)
        self._name = None
        self._phys = ''
        self._rdesc = None
        self.parsed_rdesc = None
        self._info = None
        self._fd = fd  # Not used on Windows, kept for API compat
        self.uniq = f'uhid_{str(uuid.uuid4())}'
        self.ready = False
        self._event_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc_details):
        pass  # No fd to close on Windows

    @Property
    def fd(self):
        return self._fd

    @Property
    def rdesc(self):
        return self._rdesc

    @rdesc.setter
    def rdesc(self, rdesc):
        self._rdesc = rdesc

    @Property
    def phys(self):
        return self._phys

    @phys.setter
    def phys(self, phys):
        self._phys = phys

    @Property
    def name(self):
        return self._name

    @name.setter
    def name(self, name):
        self._name = name

    @Property
    def info(self):
        return self._info

    @info.setter
    def info(self, info):
        self._info = info

    @Property
    def bus(self):
        return self._info[0]

    @Property
    def vid(self):
        return self._info[1]

    @Property
    def pid(self):
        return self._info[2]

    def call_set_report(self, req, err):
        logger.debug(f'UHID stub: set_report req={req} err={err}')

    def call_get_report(self, req, data, err):
        logger.debug(f'UHID stub: get_report req={req} err={err}')

    def call_input_event(self, data):
        """
        On Linux this writes to /dev/uhid. On Windows we log the event.
        """
        self._event_count += 1
        if self._event_count <= 5 or self._event_count % 100 == 0:
            logger.debug(f'UHID stub: input_event #{self._event_count} data={[f"{d:02x}" for d in data[:8]]}')

    def create_kernel_device(self):
        if self._name is None or self._rdesc is None or self._info is None:
            raise UHIDUncompleteException("missing uhid initialization")

        logger.info(f'UHID stub: would create kernel device "{self._name}" '
                    f'(bus={self.bus}, vid={self.vid:#06x}, pid={self.pid:#06x})')
        logger.warning('Live pen input is not available on Windows (no UHID equivalent). '
                       'Pen data will be logged but not injected into the system.')
        self.ready = True

    def destroy(self):
        self.ready = False
        logger.debug(f'UHID stub: device destroyed ({self._event_count} events processed)')

    def start(self, flags):
        logger.debug('UHID stub: start')

    def stop(self):
        logger.debug('UHID stub: stop')

    def open(self):
        logger.debug('UHID stub: open')

    def close(self):
        logger.debug('UHID stub: close')

    def set_report(self, req, rnum, rtype, size, data):
        logger.debug(f'UHID stub: set report {req} {rtype} {size}')
        self.call_set_report(req, 1)

    def get_report(self, req, rnum, rtype):
        logger.debug(f'UHID stub: get report {req} {rnum} {rtype}')
        self.call_get_report(req, [], 1)

    def output_report(self, data, size, rtype):
        logger.debug(f'UHID stub: output {rtype} {size}')

    def process_one_event(self):
        """No-op on Windows - there's no kernel device sending events back."""
        pass
