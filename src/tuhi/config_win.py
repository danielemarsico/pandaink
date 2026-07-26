#!/usr/bin/env python3
#
#  Windows-compatible configuration module.
#  Replaces config.py's dependency on xdg.BaseDirectory with
#  Windows %APPDATA% paths.
#

import configparser
import json
import logging
import os
import re
import time
from pathlib import Path

from tuhi.gobject_compat import Object, Property
from .drawing_win import Drawing
from .protocol import ProtocolVersion

logger = logging.getLogger('tuhi.config')


def get_default_data_dir():
    """Get the default data directory for Tuhi on the current platform."""
    if os.name == 'nt':
        # Windows: %APPDATA%\pandaink  (e.g. C:\Users\<user>\AppData\Roaming\pandaink)
        appdata = os.environ.get('APPDATA', os.path.expanduser('~'))
        return Path(appdata, 'pandaink')
    else:
        # Linux/POSIX: $XDG_DATA_HOME/pandaink  (default ~/.local/share/pandaink)
        try:
            import xdg.BaseDirectory
            return Path(xdg.BaseDirectory.xdg_data_home, 'pandaink')
        except ImportError:
            return Path(os.path.expanduser('~'), '.local', 'share', 'pandaink')


def is_btaddr(addr):
    return re.match('^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$', addr) is not None


def _addr_to_dir(address):
    """Convert a BT address to a safe directory name (replace : with _)."""
    return address.replace(':', '_')


class TuhiConfig(Object):
    _instance = None
    _base_path = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TuhiConfig, cls).__new__(cls)
            self = cls._instance
            self.__init__()
            if self._base_path is None:
                self._base_path = get_default_data_dir()
            logger.debug(f'Using config directory: {self._base_path}')
            Path(self._base_path).mkdir(parents=True, exist_ok=True)

            self._devices = {}
            self._scan_config_dir()
            self.peek_at_drawing = False
            self._app_settings = self._load_app_settings()
        return cls._instance

    # ------------------------------------------------------------------ #
    # App-level settings (automerge switch + per-device merge target)      #
    #                                                                      #
    # Stored in a single app_settings.ini at the base path, separate from  #
    # per-device settings.ini files:                                       #
    #   [App]      Automerge = true|false                                  #
    #   [Automerge] <ADDR> = <target-timestamp>                            #
    # ------------------------------------------------------------------ #

    def _app_settings_path(self):
        return Path(self._base_path, 'app_settings.ini')

    def _load_app_settings(self):
        config = configparser.ConfigParser()
        config.optionxform = str
        path = self._app_settings_path()
        if path.is_file():
            config.read(path)
        if 'App' not in config:
            config['App'] = {}
        if 'Automerge' not in config:
            config['Automerge'] = {}
        return config

    def _save_app_settings(self):
        with open(self._app_settings_path(), 'w') as f:
            self._app_settings.write(f)

    @property
    def automerge(self):
        """Global switch: when on, new drawings append to a single canvas."""
        return self._app_settings['App'].getboolean('Automerge', fallback=False)

    @automerge.setter
    def automerge(self, value):
        self._app_settings['App']['Automerge'] = 'true' if value else 'false'
        # Starting (or stopping) automerge begins a fresh merged canvas: forget
        # every device's current target so the next drawing starts a new file.
        self._app_settings['Automerge'] = {}
        self._save_app_settings()

    def _automerge_target(self, address):
        ts = self._app_settings['Automerge'].get(address)
        return int(ts) if ts is not None else None

    def _set_automerge_target(self, address, timestamp):
        if timestamp is None:
            self._app_settings['Automerge'].pop(address, None)
        else:
            self._app_settings['Automerge'][address] = str(timestamp)
        self._save_app_settings()

    @property
    def log_dir(self):
        return Path(self._base_path)

    @Property
    def devices(self):
        return self._devices

    def _scan_config_dir(self):
        dirs = [d for d in Path(self._base_path).iterdir()
                if d.is_dir() and is_btaddr(d.name.replace('_', ':'))]
        for directory in dirs:
            settings = Path(directory, 'settings.ini')
            if not settings.is_file():
                continue

            logger.debug(f'{directory}: configuration found')
            config = configparser.ConfigParser()
            config.read(settings)

            btaddr = config['Device']['Address']
            if 'Protocol' not in config['Device']:
                config['Device']['Protocol'] = ProtocolVersion.ANY.name.lower()
            self._devices[btaddr] = config['Device']

    def new_device(self, address, uuid, protocol, name=None):
        assert is_btaddr(address)
        assert len(uuid) == 12
        assert protocol != ProtocolVersion.ANY

        logger.debug(f'{address}: adding new config, UUID {uuid}')
        path = Path(self._base_path, _addr_to_dir(address))
        path.mkdir(exist_ok=True)

        path = Path(path, 'settings.ini')
        config = configparser.ConfigParser()
        config.optionxform = str
        config.read(path)

        entry = {
            'Address': address,
            'UUID': uuid,
            'Protocol': protocol.name.lower(),
        }
        if name:
            entry['Name'] = name
        config['Device'] = entry

        with open(path, 'w') as configfile:
            config.write(configfile)

        config = configparser.ConfigParser()
        config.read(path)
        self._devices[address] = config['Device']

    def store_drawing(self, address, drawing):
        assert is_btaddr(address)
        assert drawing is not None

        if address not in self.devices:
            logger.error(f'{address}: cannot store drawings for unknown device')
            return None

        # Automerge: fold the new drawing's strokes into the current target file
        # rather than creating a new file. The first drawing after the switch is
        # turned on becomes the target; every later one appends to it.
        if self.automerge:
            target_ts = self._automerge_target(address)
            target_path = self.drawing_path(address, target_ts) if target_ts else None
            if target_path is not None and target_path.is_file():
                logger.debug(f'{address}: automerge — appending into {target_ts}.json')
                new_strokes = json.loads(drawing.to_json())['strokes']
                self._append_strokes_to_file(target_path, new_strokes)
                return Drawing.from_json(target_path)
            # No target yet — this drawing starts the merged canvas.
            self._set_automerge_target(address, drawing.timestamp)

        logger.debug(f'{address}: adding new drawing, timestamp {drawing.timestamp}')
        path = self.drawing_path(address, drawing.timestamp)

        with open(path, 'w') as f:
            f.write(drawing.to_json())
        return drawing

    def _append_strokes_to_file(self, path, new_strokes):
        with open(path, 'r') as f:
            data = json.load(f)
        data.setdefault('strokes', []).extend(new_strokes)
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)

    def rename_drawing(self, address, timestamp, title):
        """Set (or clear) a drawing's title in place, bypassing automerge."""
        assert is_btaddr(address)
        path = self.drawing_path(address, timestamp)
        if not path.is_file():
            logger.error(f'{address}: cannot rename missing drawing {timestamp}')
            return None
        with open(path, 'r') as f:
            data = json.load(f)
        data['title'] = title or None
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        return Drawing.from_json(path)

    def merge_drawings(self, address, timestamps, title=None):
        """
        Merge the drawings with the given *timestamps* into a single new
        drawing (strokes concatenated in timestamp order) and delete the
        originals. Irreversible. Returns the merged Drawing.
        """
        assert is_btaddr(address)
        sources = sorted(int(ts) for ts in timestamps)
        if len(sources) < 2:
            raise ValueError('merge needs at least two drawings')

        merged_strokes = []
        devicename = None
        dimensions = None
        for ts in sources:
            path = self.drawing_path(address, ts)
            if not path.is_file():
                continue
            with open(path, 'r') as f:
                data = json.load(f)
            merged_strokes.extend(data.get('strokes', []))
            if devicename is None:
                devicename = data.get('devicename')
                dimensions = tuple(data.get('dimensions', (0, 0)))

        # Pick a fresh timestamp that doesn't collide with an existing file.
        new_ts = int(time.time())
        while self.drawing_path(address, new_ts).exists():
            new_ts += 1

        merged = Drawing(devicename or address, dimensions or (0, 0), new_ts,
                         title=title)
        merged_json = json.loads(merged.to_json())
        merged_json['strokes'] = merged_strokes
        with open(self.drawing_path(address, new_ts), 'w') as f:
            json.dump(merged_json, f, indent=2)

        # Remove the originals now that the merged file is safely written.
        for ts in sources:
            try:
                os.remove(self.drawing_path(address, ts))
            except OSError:
                pass
            # If a merged-away drawing was the automerge target, drop it.
            if self._automerge_target(address) == ts:
                self._set_automerge_target(address, None)

        return Drawing.from_json(self.drawing_path(address, new_ts))

    def load_drawings(self, address):
        assert is_btaddr(address)

        if address not in self.devices:
            return []

        configdir = Path(self._base_path, _addr_to_dir(address))
        return [Drawing.from_json(f) for f in configdir.glob('*.json')]

    def drawing_path(self, address, timestamp):
        """Return the Path to the JSON file for the given drawing timestamp."""
        return Path(self._base_path, _addr_to_dir(address), f'{timestamp}.json')

    @classmethod
    def set_base_path(cls, path):
        if cls._instance is not None:
            logger.error('Trying to set config base path but we already have the singleton object')
            return
        cls._base_path = Path(path)
