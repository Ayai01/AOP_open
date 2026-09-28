"""Check local runtime and simulator prerequisites without running optimization."""
import argparse
import importlib
import json
import platform
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    errors = []
    supported = (sys.implementation.name == 'cpython' and sys.version_info[:2] in ((3, 10), (3, 12))
                 and sys.platform == 'linux' and platform.machine() in ('x86_64', 'AMD64'))
    print('Python:', sys.version.split()[0], platform.system(), platform.machine())
    if not supported:
        errors.append('Use Linux x86_64 with CPython 3.10 or 3.12 (Windows: use WSL2).')
    else:
        try:
            import numpy
            core = importlib.import_module('algorithm._hybrid_v3')
            assert callable(core.optimize)
            print('NumPy:', numpy.__version__, '| hybrid_v3 native runtime: OK')
        except Exception as exc:
            errors.append('Runtime import: ' + str(exc))
    if args.config:
        path = args.config.expanduser().resolve()
        try:
            cfg = json.loads(path.read_text(encoding='utf-8-sig'))
            if supported and not errors:
                from utils.validation import validate_config
                validate_config(cfg)
                print('Configuration:', cfg.get('ckt_name'), '|', len(cfg['variables']), 'variables')
            backend = cfg.get('simulator', 'hspice')
            command = (cfg.get('simulator_options') or {}).get('command', backend)
            if not shutil.which(command):
                errors.append('Simulator executable not found: ' + command)
            project = Path(cfg.get('project_root', ROOT)).expanduser().resolve()
            netlist = (cfg.get('simulator_options') or {}).get('netlist', cfg.get('hspice_content', ''))
            paths = re.findall(r'^\s*\.(?:lib|include|inc)\s+[\"\']([^\"\']+)[\"\']', netlist, re.M | re.I)
            for value in sorted(set(paths)):
                model = Path(value).expanduser()
                if not model.is_absolute(): model = project / model
                if not model.is_file(): errors.append('Model file not found: ' + str(model))
        except Exception as exc:
            errors.append('Configuration: ' + str(exc))
    for error in errors: print('ERROR:', error)
    print('FAILED' if errors else 'Checks passed; no simulation was performed.')
    return 1 if errors else 0

if __name__ == '__main__':
    sys.exit(main())
