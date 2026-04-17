#!/usr/bin/env python3
#
#  GObject compatibility layer for Windows.
#  Provides signal/property infrastructure matching the GObject API
#  used throughout the tuhi codebase, without requiring gi.repository.
#

import logging
import threading
import time
from functools import wraps

logger = logging.getLogger('tuhi.gobject_compat')


class SignalFlags:
    RUN_FIRST = 1


class _PropertyDescriptor:
    """Descriptor that mimics @GObject.Property behavior."""

    def __init__(self, fget=None, fset=None, type=None, default=None):
        self.fget = fget
        self.fset = fset
        self.attr_name = None
        self.type = type
        self.default = default

    def __set_name__(self, owner, name):
        self.attr_name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        if self.fget is not None:
            return self.fget(obj)
        return getattr(obj, f'_prop_{self.attr_name}', self.default)

    def __set__(self, obj, value):
        if self.fset is not None:
            self.fset(obj, value)
        else:
            setattr(obj, f'_prop_{self.attr_name}', value)

    def setter(self, fset):
        return _PropertyDescriptor(fget=self.fget, fset=fset,
                                   type=self.type, default=self.default)


def Property(func=None, type=None, default=None):
    """Decorator mimicking @GObject.Property."""
    if func is not None:
        # Used as @Property without arguments
        return _PropertyDescriptor(fget=func)
    # Used as @Property(type=..., default=...)
    def decorator(f):
        return _PropertyDescriptor(fget=f, type=type, default=default)
    return decorator


class Object:
    """
    Base class replacing GObject.Object.
    Provides connect/emit/disconnect signal infrastructure and
    property change notification via notify().
    """

    # Subclasses define __gsignals__ = { 'name': (flags, return, (arg_types,)) }
    __gsignals__ = {}

    def __init__(self, **kwargs):
        self._signal_handlers = {}  # signal_name -> {handler_id: (callback, args)}
        self._next_handler_id = 1
        self._handler_lock = threading.Lock()

    def connect(self, signal_name, callback, *user_data):
        """Connect a callback to a signal. Returns a handler_id."""
        with self._handler_lock:
            handler_id = self._next_handler_id
            self._next_handler_id += 1

            if signal_name not in self._signal_handlers:
                self._signal_handlers[signal_name] = {}

            self._signal_handlers[signal_name][handler_id] = (callback, user_data)
            return handler_id

    def disconnect(self, handler_id):
        """Disconnect a signal handler by its id."""
        with self._handler_lock:
            for signal_name, handlers in self._signal_handlers.items():
                if handler_id in handlers:
                    del handlers[handler_id]
                    return
        raise KeyError(f'Handler {handler_id} not found')

    def emit(self, signal_name, *args):
        """Emit a signal, calling all connected handlers."""
        with self._handler_lock:
            handlers = dict(self._signal_handlers.get(signal_name, {}))

        for handler_id, (callback, user_data) in handlers.items():
            try:
                callback(self, *args, *user_data)
            except Exception:
                logger.exception(f'Error in signal handler for {signal_name}')

    def notify(self, prop_name):
        """Emit a property-change notification signal (notify::prop_name)."""
        self.emit(f'notify::{prop_name}', None)


# Timer management using threads (replaces GObject.timeout_add_seconds / source_remove)
_timer_lock = threading.Lock()
_timers = {}
_next_timer_id = 1


def timeout_add_seconds(interval, callback, *user_data):
    """Schedule callback after interval seconds. Returns a source_id."""
    global _next_timer_id

    with _timer_lock:
        source_id = _next_timer_id
        _next_timer_id += 1

    cancel_event = threading.Event()

    def _run():
        while not cancel_event.wait(interval):
            result = callback(*user_data)
            if not result:
                break
        with _timer_lock:
            _timers.pop(source_id, None)

    t = threading.Thread(target=_run, daemon=True)
    with _timer_lock:
        _timers[source_id] = cancel_event
    t.start()
    return source_id


def source_remove(source_id):
    """Cancel a scheduled timer."""
    with _timer_lock:
        event = _timers.pop(source_id, None)
    if event is not None:
        event.set()


# Type constants (used in signal definitions, we don't actually enforce types)
TYPE_PYOBJECT = object
TYPE_INT = int
TYPE_BOOLEAN = bool
TYPE_STRING = str
