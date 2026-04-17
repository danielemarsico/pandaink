# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_all

# Make local src/ visible to PyInstaller analysis before any collect_* calls
_src = os.path.normpath(os.path.join(SPECPATH, '..', 'src'))
if _src not in sys.path:
    sys.path.insert(0, _src)

bleak_datas, bleak_binaries, bleak_hiddenimports = collect_all('bleak')

a = Analysis(
    [os.path.join(_src, 'tuhi_gui.py')],
    pathex=[_src],
    binaries=bleak_binaries,
    datas=bleak_datas,
    hiddenimports=bleak_hiddenimports + [
        'asyncio',
        'tkinter',
        'tkinter.ttk',
        'tkinter.filedialog',
        'tkinter.messagebox',
        'help_dialog',
        'help_content',
        'tuhi',
        'tuhi.app',
        'tuhi.base_win',
        'tuhi.ble_bleak',
        'tuhi.config_win',
        'tuhi.drawing_win',
        'tuhi.export_win',
        'tuhi.gobject_compat',
        'tuhi.protocol',
        'tuhi.util',
        'tuhi.wacom_win',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='PandaInk',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon='../assets/pandaink.ico',
)
