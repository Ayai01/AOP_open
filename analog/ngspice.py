"""Native ngspice batch decks and .meas logs; no automatic process conversion.

Reference: https://ngspice.sourceforge.io/docs/ngspice-manual.pdf, sections
11.4.2 and 12.4.1. Batch .meas uses -b -o, without the incompatible -r option.
"""
import math
import os
from pathlib import Path
import re
import subprocess

from config import MAX_SIM_TIME, PROJECT_ROOT


def settings(config):
    value = config.get('simulator_options') or {}
    if not isinstance(value, dict):
        raise ValueError('simulator_options must be an object')
    unknown = set(value) - {'command', 'timeout_seconds', 'netlist', 'model_file', 'model_section', 'corners', 'compatibility'}
    if unknown:
        raise ValueError('Unknown simulator_options: ' + ', '.join(sorted(unknown)))
    result = dict(value)
    for key in ('command', 'netlist', 'model_file', 'model_section'):
        if key in result and (not isinstance(result[key], str) or '\x00' in result[key]):
            raise ValueError('simulator_options.' + key + ' must be a string')
    result['command'] = result.get('command') or os.environ.get('AOP_NGSPICE_CMD', 'ngspice')
    try:
        timeout = float(result.get('timeout_seconds', MAX_SIM_TIME))
    except (TypeError, ValueError):
        timeout = float('nan')
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('simulator_options.timeout_seconds must be positive and finite')
    result['timeout_seconds'] = timeout
    if result.get('compatibility', 'native') not in ('native', 'hs'):
        raise ValueError('ngspice compatibility must be native or hs; hs does not guarantee model compatibility')
    corners = result.get('corners', [{}])
    if not isinstance(corners, list) or not 1 <= len(corners) <= 64:
        raise ValueError('simulator_options.corners must contain 1..64 explicit conditions')
    seen = set()
    for corner in corners:
        if not isinstance(corner, dict) or set(corner) - {'name', 'temperature_c', 'model_section'}:
            raise ValueError('Each corner supports name, temperature_c, model_section')
        if 'temperature_c' in corner:
            temp = corner['temperature_c']
            if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not math.isfinite(temp):
                raise ValueError('corner temperature_c must be a finite number')
        section = corner.get('model_section', result.get('model_section', ''))
        if not isinstance(section, str) or (section and not re.fullmatch(r'[A-Za-z_][\w.-]*', section)):
            raise ValueError('model_section must be a SPICE library section name')
        if section and not result.get('model_file'):
            raise ValueError('model_section requires explicit model_file')
        key = (corner.get('temperature_c'), section)
        if key in seen:
            raise ValueError('Duplicate temperature/model corner; names alone do not create distinct corners')
        seen.add(key)
    result['corners'] = corners
    return result


_MODEL_LINE = re.compile(r'^\s*\.(include|inc|lib)\s+("[^"]+"|\'[^\']+\'|\S+)(.*)$', re.I)


def _model_path(value, root):
    path = Path(os.path.expandvars(os.path.expanduser(value)))
    path = path if path.is_absolute() else root / path
    path = path.resolve()
    if not path.is_file():
        raise ValueError('ngspice model/include file not found: ' + str(path))
    if '"' in str(path) or '\n' in str(path) or '\r' in str(path):
        raise ValueError('Invalid model path')
    return path.as_posix()


def prepare_decks(netlist, config):
    """Expand explicit corners; preserve the supplied native circuit and models."""
    options = settings(config)
    if not isinstance(netlist, str) or not netlist.strip():
        raise ValueError('ngspice requires a native netlist in hspice_content or simulator_options.netlist')
    unsupported = re.search(r'^\s*\.(alter|del|control|protect|unprotect)\b', netlist, re.I | re.M)
    if unsupported:
        raise ValueError('ngspice native batch backend does not translate .' + unsupported.group(1)
                         + '; supply compatible simulator_options.netlist and explicit corners. '
                         'Selecting ngspice does not convert HSPICE models or change the process.')
    if not re.search(r'^\s*\.end\s*$', netlist, re.I | re.M):
        raise ValueError('ngspice native netlist must end with .end')
    root = Path(config.get('project_root') or PROJECT_ROOT).resolve()
    lines = netlist.splitlines()
    explicit_model = options.get('model_file')
    model_lines = [i for i, line in enumerate(lines) if _MODEL_LINE.match(line)]
    if explicit_model and model_lines:
        raise ValueError('Explicit model_file cannot be combined with existing .lib/.include lines; '
                         'remove those from the native override to avoid mixing processes.')
    for index in model_lines:
        match = _MODEL_LINE.match(lines[index])
        path = _model_path(match.group(2).strip('\"\''), root)
        lines[index] = '.{} "{}"{}'.format(match.group(1), path, match.group(3))
    if explicit_model:
        explicit_model = _model_path(explicit_model, root)
    decks = []
    for index, corner in enumerate(options['corners']):
        active = list(lines)
        additions = []
        if 'temperature_c' in corner:
            active = [line for line in active if not re.match(r'^\s*\.temp\b', line, re.I)]
            additions.append('.temp {:g}'.format(corner['temperature_c']))
        if explicit_model:
            section = corner.get('model_section', options.get('model_section', ''))
            additions.append('.lib "{}" {}'.format(explicit_model, section) if section
                             else '.include "{}"'.format(explicit_model))
        # Keep the first title line in place. Never silently turn it into a card.
        active[1:1] = additions
        decks.append({'name': corner.get('name') or 'corner_{}'.format(index),
                      'condition': dict(corner), 'netlist': '\n'.join(active) + '\n'})
    return decks


def _extract(values, rule):
    if not values or any(not math.isfinite(v) for v in values):
        return float('nan')
    rule = str(rule or 'first').lower()
    if rule == 'min':
        return min(values)
    if rule == 'max':
        return max(values)
    if rule == 'avg':
        return sum(values) / len(values)
    return values[0]


def read_ngspice_log(path, metrics):
    try:
        content = Path(path).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return {'values': {}, '_len': 0}
    values = {}
    for metric in metrics:
        if not metric.get('enabled', True):
            continue
        name = metric.get('name', '')
        regex = metric.get('regex') or (r'^\s*' + re.escape(name) + r'\s*=\s*([^\s]+)')
        try:
            matches = re.findall(regex, content, re.I | re.M)
            parsed = []
            for match in matches:
                token = match[0] if isinstance(match, tuple) else match
                try:
                    parsed.append(float(token.strip().replace('D', 'e').replace('d', 'e')))
                except ValueError:
                    parsed.append(float('nan'))
            failed = re.search(r'^\s*(?:error:\s*)?measure(?:ment)?\s+' + re.escape(name)
                               + r'\b.*(?:failed|error|out of interval)', content, re.I | re.M)
            if failed:
                parsed.append(float('nan'))
            values[name] = _extract(parsed, metric.get('extract'))
        except re.error:
            values[name] = float('nan')
    return {'values': values, '_len': len(content)}


def aggregate_logs(runs, metrics):
    values = {}
    for metric in metrics:
        if metric.get('enabled', True):
            name = metric.get('name', '')
            values[name] = _extract([r['values'].get(name, float('nan')) for r in runs], metric.get('extract'))
    return {'values': values, '_len': sum(r.get('_len', 0) for r in runs),
            'ok': bool(runs) and all(r.get('ok', False) for r in runs), 'corners': runs}


def run_ngspice(input_ckt, output_root, config):
    from .simulators import validate_simulator_config
    validate_simulator_config(config, check_executable=True)
    options = settings(config)
    decks = prepare_decks(Path(input_ckt).read_text(encoding='utf-8'), config)
    metrics = config.get('metrics', [])
    runs = []
    for index, deck in enumerate(decks):
        folder = Path(output_root).parent / ('ngspice_corner_{}'.format(index))
        folder.mkdir(parents=True, exist_ok=True)
        circuit, log = folder / 'input.cir', folder / 'output.log'
        circuit.write_text(deck['netlist'], encoding='utf-8')
        command = [options['command']]
        if options.get('compatibility', 'native') == 'hs':
            (folder / '.spiceinit').write_text('set ngbehavior=hs\n', encoding='ascii')
        else:
            command.append('-n')
        command += ['-b', '-o', str(log.resolve()), str(circuit.resolve())]
        extra = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        try:
            with (folder / 'process.log').open('w', encoding='utf-8') as stream:
                process = subprocess.run(command, cwd=str(folder), stdout=stream, stderr=subprocess.STDOUT,
                                         timeout=options['timeout_seconds'], check=False, **extra)
            result = read_ngspice_log(log, metrics)
            result['ok'] = process.returncode == 0 and result['_len'] > 0
            result['returncode'] = process.returncode
        except subprocess.TimeoutExpired:
            result = read_ngspice_log(log, metrics)
            result.update(ok=False, error='ngspice timeout after {} seconds'.format(options['timeout_seconds']))
        except OSError as exc:
            raise RuntimeError('Cannot start ngspice: ' + str(exc)) from exc
        result.update(name=deck['name'], condition=deck['condition'], log=str(log.resolve()))
        if not result['ok']:
            detail = log.read_text(encoding='utf-8', errors='replace')[-2000:] if log.exists() else ''
            print('[NGSPICE] {} failed: {}\n{}'.format(deck['name'], result.get('error', result.get('returncode')), detail))
        runs.append(result)
    return aggregate_logs(runs, metrics)

