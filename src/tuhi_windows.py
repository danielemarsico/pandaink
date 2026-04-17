#!/usr/bin/env python3
#
#  tuhi_windows.py — legacy entry point (now just delegates to tuhi_cli.py)
#
#  The server daemon is no longer needed.  All functionality lives in the
#  single-process CLI.  Run tuhi_cli.py directly:
#
#    python tuhi_cli.py list
#    python tuhi_cli.py search --register
#    python tuhi_cli.py listen  XX:XX:XX:XX:XX:XX
#    python tuhi_cli.py fetch   XX:XX:XX:XX:XX:XX
#

import sys

if sys.version_info < (3, 12):
    sys.exit('Python 3.12 or later required')

print('tuhi_windows.py: the server daemon has been replaced by the single-process CLI.')
print('Use tuhi_cli.py instead:')
print()
print('  python tuhi_cli.py list')
print('  python tuhi_cli.py search --register')
print('  python tuhi_cli.py listen  XX:XX:XX:XX:XX:XX')
print('  python tuhi_cli.py fetch   XX:XX:XX:XX:XX:XX')
sys.exit(0)
