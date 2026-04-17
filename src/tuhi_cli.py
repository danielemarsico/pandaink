#!/usr/bin/env python3
#
#  Tuhi CLI for Windows — single-process edition.
#
#  Each command creates a TuhiApp, calls start(), does its work, then
#  calls stop().  No IPC server required.
#
#  Usage:
#    python tuhi_cli.py list
#    python tuhi_cli.py search [--register] [--timeout N]
#    python tuhi_cli.py listen  XX:XX:XX:XX:XX:XX
#    python tuhi_cli.py fetch   XX:XX:XX:XX:XX:XX [--svg] [--orientation ...]
#

import argparse
import json
import logging
import sys
import time

# Ensure the tuhi package inside tuhi_win is importable when running from
# any working directory.
import os
sys.path.insert(0, os.path.dirname(__file__))

from tuhi.app import TuhiApp
from tuhi.config_win import get_default_data_dir, TuhiConfig

logger = logging.getLogger('tuhi')


def _make_app(args):
    """Create and start a TuhiApp from parsed CLI args."""
    config_dir = getattr(args, 'config_dir', None) or get_default_data_dir()
    TuhiConfig.set_base_path(config_dir)
    app = TuhiApp()
    app.start()
    return app


# ------------------------------------------------------------------ #
# Commands                                                             #
# ------------------------------------------------------------------ #

def cmd_list(args):
    """List registered devices (reads config + drawings from disk)."""
    app = _make_app(args)
    devices = app.list_devices()
    app.stop()

    if not devices:
        print('No registered devices.')
        return 0

    for d in devices:
        print(f"  {d['address']}  {d['name']}")
        drawings = d['drawings'] or []
        print(f"    Drawings: {len(drawings)}")
        dims = d['dimensions']
        if dims and dims != (0, 0):
            print(f"    Dimensions: {dims[0]/1000:.0f}x{dims[1]/1000:.0f} mm")
    return 0


def cmd_search(args):
    """Search for unregistered devices; optionally register the first one found."""
    app = _make_app(args)

    print('Searching for devices...')
    print('Put your device in pairing mode (hold the button for ~6 seconds).')
    print('Press Ctrl+C to stop early.\n')

    found = []

    def on_found(address, name):
        found.append((address, name))
        print(f'  Found: {address}  {name}')

    timeout = args.timeout if args.timeout else 30
    app.search(
        timeout=timeout,
        on_found=on_found,
        stop_early=bool(args.register),
    )

    if not found:
        print('No devices found.')
        app.stop()
        return 1

    if args.register:
        address, name = found[0]
        print(f'\nRegistering {name} ({address})...')

        def on_button_press():
            print('  [Please press the button on your device now]')

        try:
            app.register(address, on_button_press=on_button_press, timeout=60)
            print('Registration complete.')
        except KeyError as e:
            print(f'Error: {e}')
            app.stop()
            return 1

    app.stop()
    return 0


def cmd_listen(args):
    """Connect to a registered device and wait for drawings (synced on button press)."""
    address = args.address.upper()
    app = _make_app(args)

    if address not in app.config.devices:
        print(f'Error: {address} is not registered. Use "list" to see registered devices.')
        app.stop()
        return 1

    print(f'Listening on {address}...')
    print('Press the button on your device to sync drawings.')
    print('Press Ctrl+C to stop.\n')

    def on_drawings(app_dev):
        drawings = sorted(app_dev.drawings.keys())
        print(f'  {len(drawings)} drawing(s) available:')
        for ts in drawings:
            t = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts))
            print(f'    {ts} ({t})')

    app.start_listening(address, on_drawings=on_drawings)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        app.stop_listening(address)
        print('\nStopped listening.')

    app.stop()
    return 0


def cmd_live(args):
    """Stream live pen data from a registered device until Ctrl+C."""
    import datetime
    from tuhi.drawing_win import Drawing

    address = args.address.upper()
    app = _make_app(args)

    if address not in app.config.devices:
        print(f'Error: {address} is not registered.')
        app.stop()
        return 1

    cfg = app.config.devices[address]
    device_name = cfg.get('name', cfg.get('Name', address))

    # Determine device dimensions (best-effort from stored drawings)
    stored = app.config.load_drawings(address)
    if stored:
        dims = stored[0].dimensions
    else:
        dims = (21600, 14800)  # Bamboo Folio default

    timestamp = int(time.time())
    drawing = Drawing(device_name, dims, timestamp)

    print(f'Starting live mode on {address}...')
    print('Draw on your device. Press Ctrl+C to finish.\n')

    def on_pen_point(x, y, pressure, in_proximity):
        if in_proximity:
            stroke = drawing.current_stroke
            if stroke is None:
                stroke = drawing.new_stroke()
            stroke.new_abs(position=(x, y), pressure=pressure)
        else:
            if drawing.current_stroke is not None:
                drawing.current_stroke.seal()

    app.start_live(address, on_pen_point=on_pen_point)

    try:
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        pass

    app.stop_live(address)
    app.stop()

    drawing.seal()

    if not drawing.strokes:
        print('No strokes recorded.')
        return 0

    output_dir = getattr(args, 'output', None) or '.'
    ts_str = datetime.datetime.fromtimestamp(timestamp).strftime('%Y%m%d_%H%M%S')
    json_path = f'{output_dir}/live_{ts_str}.json'
    json_data = drawing.to_json()
    with open(json_path, 'w') as f:
        f.write(json_data)
    print(f'Saved: {json_path}  ({len(drawing.strokes)} strokes)')

    if args.svg:
        try:
            from tuhi.export_win import JsonSvg
            import json as jsonlib
            svg_path = f'{output_dir}/live_{ts_str}.svg'
            JsonSvg(jsonlib.loads(json_data), 'landscape', svg_path)
            print(f'SVG:   {svg_path}')
        except Exception as e:
            print(f'SVG export failed: {e}')

    return 0


def cmd_fetch(args):
    """Download stored drawings from a device and export as JSON (optionally SVG)."""
    address = args.address.upper()
    app = _make_app(args)

    if address not in app.config.devices:
        print(f'Error: {address} is not registered.')
        app.stop()
        return 1

    drawings = app.config.load_drawings(address)
    app.stop()

    if not drawings:
        print('No drawings available. Use "listen" to sync drawings first.')
        return 0

    print(f'Found {len(drawings)} drawing(s):')
    for drawing in sorted(drawings, key=lambda d: d.timestamp):
        ts = drawing.timestamp
        t = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts))
        json_data = drawing.to_json()

        outfile = f'drawing_{ts}.json'
        with open(outfile, 'w') as f:
            f.write(json_data)
        print(f'  Saved: {outfile} ({t})')

        if args.svg:
            try:
                from tuhi.export_win import JsonSvg
                parsed = json.loads(json_data)
                svg_file = f'drawing_{ts}.svg'
                orientation = getattr(args, 'orientation', None) or 'landscape'
                JsonSvg(parsed, orientation, svg_file)
                print(f'  SVG:   {svg_file}')
            except Exception as e:
                print(f'  SVG export failed: {e}')

    return 0


# ------------------------------------------------------------------ #
# Entry point                                                          #
# ------------------------------------------------------------------ #

def main():
    parser = argparse.ArgumentParser(
        description='Tuhi CLI — Wacom SmartPad drawing sync (single-process)')
    parser.add_argument('--config-dir',
                        help='Base directory for configuration',
                        default=None)
    parser.add_argument('-v', '--verbose',
                        help='Show debug logging',
                        action='store_true',
                        default=False)

    sub = parser.add_subparsers(dest='command')

    # list
    sub.add_parser('list', help='List registered devices')

    # search
    sp = sub.add_parser('search', help='Search for unregistered devices')
    sp.add_argument('--register', action='store_true',
                    help='Register the first found device automatically')
    sp.add_argument('--timeout', type=int, default=30,
                    help='Search timeout in seconds (default: 30)')

    # listen
    sp = sub.add_parser('listen', help='Listen for drawings from a registered device')
    sp.add_argument('address', help='Bluetooth address (XX:XX:XX:XX:XX:XX)')

    # fetch
    sp = sub.add_parser('fetch', help='Export stored drawings to JSON (and optionally SVG)')
    sp.add_argument('address', help='Bluetooth address (XX:XX:XX:XX:XX:XX)')
    sp.add_argument('--svg', action='store_true', help='Also export as SVG')
    sp.add_argument('--orientation',
                    choices=['landscape', 'portrait',
                             'reverse-landscape', 'reverse-portrait'],
                    default='landscape',
                    help='Drawing orientation for SVG export')

    # live
    sp = sub.add_parser('live', help='Stream live pen data from a registered device')
    sp.add_argument('address', help='Bluetooth address (XX:XX:XX:XX:XX:XX)')
    sp.add_argument('--svg', action='store_true', help='Also write an SVG alongside the JSON')
    sp.add_argument('--output', default='.', help='Output directory (default: current dir)')

    args = parser.parse_args()

    logging.basicConfig(
        format='%(asctime)s %(levelname)s: %(name)s: %(message)s',
        datefmt='%H:%M:%S',
        level=logging.DEBUG if args.verbose else logging.WARNING,
    )

    if args.command is None:
        parser.print_help()
        return 1

    commands = {
        'list': cmd_list,
        'search': cmd_search,
        'listen': cmd_listen,
        'fetch': cmd_fetch,
        'live': cmd_live,
    }

    return commands[args.command](args)


if __name__ == '__main__':
    sys.exit(main())
