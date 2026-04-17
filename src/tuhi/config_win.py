#!/usr/bin/env python3
#
#  Windows-compatible configuration module.
#  Replaces config.py's dependency on xdg.BaseDirectory with
#  Windows %APPDATA% paths.
#

import configparser
import logging
import os
import re
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
        return cls._instance

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
            return

        logger.debug(f'{address}: adding new drawing, timestamp {drawing.timestamp}')
        path = Path(self._base_path, _addr_to_dir(address), f'{drawing.timestamp}.json')

        with open(path, 'w') as f:
            f.write(drawing.to_json())

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
