#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
python_bin="${AOP_PYTHON:-python3}"
"$python_bin" -c 'import sys,platform; assert sys.implementation.name=="cpython" and sys.version_info[:2] in ((3,10),(3,12)) and sys.platform=="linux" and platform.machine()=="x86_64", "Use Linux x86_64 CPython 3.10/3.12; set AOP_PYTHON=/path/to/python"'
"$python_bin" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python doctor.py
printf '%s\n' 'Ready: .venv/bin/python main.py'
