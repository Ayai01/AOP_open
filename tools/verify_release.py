"""Verify the checked-in release manifest (integrity, not publisher authentication)."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'release_manifest.json').read_text())
errors = []
for name, expected in manifest['files'].items():
    path = root / name
    if not path.is_file():
        errors.append('Missing: ' + name)
    elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        errors.append('Changed: ' + name)
for error in errors: print(error)
print('FAILED' if errors else 'Release checksums verified: ' + str(len(manifest['files'])) + ' files')
sys.exit(1 if errors else 0)
