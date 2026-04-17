# Build instructions

## Portable EXE

```powershell
pip install -r requirements.txt pyinstaller
python -m PyInstaller build/PandaInk.spec --distpath dist --workpath build/work
# Output: dist/PandaInk.exe
```

## Installer (requires Inno Setup 6)

Download from https://jrsoftware.org/isdl.php, then:

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DMyAppVersion=1.0.0 build\PandaInk.iss
# Output: dist/PandaInk-setup.exe
```

## CI

Both artifacts are built automatically by GitHub Actions on every push to `master`
and on every `v*` tag. Tag builds also attach the files to a GitHub Release.
