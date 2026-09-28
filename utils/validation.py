"""Validate task configuration before changing server state (Python 3.7+)."""
import importlib
import math
import os
import re

from config import CPU_COUNT, MAX_POOL_PROCS


DEFAULT_W_GAMMA = 1.5
DEFAULT_L_GAMMA = 2.0
MIN_MAPPING_GAMMA = 0.5

def parse_algo_params(param_str):
    out = {}
    if not isinstance(param_str, str):
        raise ValueError('algo_params must be a string')
    for part in param_str.split(';'):
        part = part.strip()
        if not part:
            continue
        if '=' not in part:
            raise ValueError('Invalid algorithm parameter: ' + part)
        key, value = (v.strip() for v in part.split('=', 1))
        if not key or not value:
            raise ValueError('Invalid algorithm parameter: ' + part)
        if key in ('x_dim', 'queue', 'stop_event', 'pause_event', 'initial_population'):
            raise ValueError('Reserved algorithm parameter: ' + key)
        try:
            out[key] = float(value) if any(c in value for c in '.eE') else int(value)
        except ValueError:
            out[key] = value
    return out


def _number(value, field):
    if isinstance(value, bool):
        raise ValueError(field + ' must be a finite number')
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(field + ' must be a finite number')
    if not math.isfinite(number):
        raise ValueError(field + ' must be a finite number')
    return number


def _integer(value, field, minimum=1):
    number = _number(value, field)
    if number < minimum or not number.is_integer():
        raise ValueError(field + ' must be an integer >= ' + str(minimum))
    return int(number)


def _generation_limit(value, field):
    """Validate a finite generation count or explicit manual-stop mode."""
    if isinstance(value, bool):
        raise ValueError(field + ' must be a positive integer or inf')
    text = str(value).strip().lower()
    if text in ('inf', '+inf', 'infinity', '+infinity', 'unlimited', 'manual'):
        return 'inf'
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(field + ' must be a positive integer or inf')
    if math.isinf(number) and number > 0:
        return 'inf'
    if not math.isfinite(number) or number < 1 or not number.is_integer():
        raise ValueError(field + ' must be a positive integer or inf')
    return int(number)


def _mapping_gamma(value, field, default):
    gamma = _number(default if value is None else value, field)
    if gamma < MIN_MAPPING_GAMMA:
        raise ValueError(field + ' must be >= ' + str(MIN_MAPPING_GAMMA))
    return gamma


def _metric(metric, field, area=False):
    if not isinstance(metric, dict):
        raise ValueError(field + ' must be an object')
    if not metric.get('enabled', not area):
        return False
    worst = _number(metric.get('worst'), field + '.worst')
    target = _number(metric.get('target'), field + '.target')
    kind = 'reciprocal' if area else metric.get('transform', 'linear')
    if kind not in ('linear', 'log', 'reciprocal', 'sqrt', 'square', 'abs'):
        raise ValueError(field + ': unknown transform')
    if kind == 'log' and min(worst, target) <= 0:
        raise ValueError(field + ': log bounds must be positive')
    if kind == 'reciprocal' and (worst == 0 or target == 0):
        raise ValueError(field + ': reciprocal bounds cannot be zero')
    if kind == 'sqrt' and min(worst, target) < 0:
        raise ValueError(field + ': sqrt bounds must be nonnegative')
    for key in ('pw', 'fw'):
        if _number(metric.get(key, 0), field + '.' + key) < 0:
            raise ValueError(field + '.' + key + ' must be nonnegative')
    if not area:
        if not isinstance(metric.get('name'), str) or not metric['name'].strip():
            raise ValueError(field + '.name is required')
        preset = metric.get('regex_preset', 'normal')
        if preset not in ('normal', 'custom', 'power'):
            raise ValueError(field + ': unknown regex_preset')
        if preset == 'power' and not metric.get('supply_name'):
            raise ValueError(field + '.supply_name is required')
        if preset != 'power':
            try:
                re.compile(metric.get('regex') or '')
            except (re.error, TypeError):
                raise ValueError(field + ': invalid regular expression')
        rule = str(metric.get('extract') or 'first').lower()
        if rule not in ('first', 'min', 'max', 'avg'):
            try:
                int(rule)
            except ValueError:
                raise ValueError(field + ': invalid extraction rule')
            if preset != 'power':
                raise ValueError(field + ': numeric indices require power preset')
    return True


def validate_config(cfg):
    if not isinstance(cfg, dict):
        raise ValueError('Configuration must be a JSON object')
    cfg = dict(cfg)

    algo = cfg.get('algo')
    if not isinstance(algo, str) or not re.match(r'^[A-Za-z_]\w*$', algo):
        raise ValueError('A valid algorithm name is required')
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isfile(os.path.join(root, 'algorithm', algo + '.py')):
        raise ValueError('Unknown algorithm: ' + algo)

    params = parse_algo_params(cfg.get('algo_params', ''))
    if params:
        try:
            plugin = importlib.import_module('algorithm.' + algo)
        except ImportError as exc:
            raise ValueError('Cannot load algorithm ' + algo + ': ' + str(exc)) from exc
        removed = sorted(set(params).intersection(getattr(plugin, 'REMOVED_PARAMS', ())))
        if removed:
            raise ValueError('Removed algorithm parameters: ' + ', '.join(removed)
                             + '. Delete these entries; internal defaults apply. '
                             + getattr(plugin, 'REMOVED_PARAMS_HINT', ''))
    workers = cfg.get('workers')
    if workers not in (None, ''):
        workers = _integer(workers, 'workers')
        worker_limit = max(1, min(int(CPU_COUNT), int(MAX_POOL_PROCS)))
        if workers > worker_limit:
            raise ValueError(
                'workers must be <= server worker limit ' + str(worker_limit)
            )
        cfg['workers'] = workers
    else:
        cfg.pop('workers', None)

    cfg['pop_size'] = _integer(cfg.get('pop_size', 40), 'pop_size')
    if 'pop_size' in params:
        _integer(params['pop_size'], 'algo_params.pop_size')

    cfg['n_gen'] = _generation_limit(cfg.get('n_gen', 80), 'n_gen')
    if 'n_gen' in params:
        _generation_limit(params['n_gen'], 'algo_params.n_gen')

    mapping = cfg.get('variable_mapping') or {}
    if not isinstance(mapping, dict):
        raise ValueError('variable_mapping must be an object')
    cfg['variable_mapping'] = {
        'w_gamma': _mapping_gamma(mapping.get('w_gamma'), 'variable_mapping.w_gamma', DEFAULT_W_GAMMA),
        'l_gamma': _mapping_gamma(mapping.get('l_gamma'), 'variable_mapping.l_gamma', DEFAULT_L_GAMMA),
    }

    variables = cfg.get('variables')
    if not isinstance(variables, list) or not variables:
        raise ValueError('variables must be a nonempty list')
    names = set()
    for index, var in enumerate(variables):
        field = 'variables[{}]'.format(index)
        if not isinstance(var, dict):
            raise ValueError(field + ' must be an object')
        name = var.get('name')
        if not isinstance(name, str) or not name.strip() or name in names:
            raise ValueError(field + ': missing or duplicate variable name')
        names.add(name)
        low = _number(var.get('min'), field + '.min')
        high = _number(var.get('max'), field + '.max')
        if high < low:
            raise ValueError(field + ': max must be >= min')
        prefix = name.strip().lower()[:1]
        if prefix in ('w', 'l') and (low <= 0.0 or high <= 0.0):
            raise ValueError(field + ': W/L logarithmic mapping requires min and max > 0')
        if var.get('step') not in (None, '') and _number(var['step'], field + '.step') < 0:
            raise ValueError(field + ': step must be nonnegative')

    for key in ('dim', 'x_dim'):
        if key in cfg and _integer(cfg[key], key) != len(variables):
            raise ValueError(key + ' must equal the number of variables')
    cfg['dim'] = len(variables)

    if 'initial_population' in cfg:
        points = cfg['initial_population']
        if not isinstance(points, list):
            raise ValueError('initial_population must be a matrix of real variable values')
        population_size = int(params.get('pop_size', cfg['pop_size']))
        if len(points) > population_size:
            raise ValueError('initial_population must contain at most pop_size rows')
        from analog.variable_mapping import real_to_normalized_values, normalized_to_real_values
        canonical, seen = [], set()
        for index, point in enumerate(points):
            field = 'initial_population[{}]'.format(index)
            if not isinstance(point, list) or len(point) != len(variables):
                raise ValueError(field + ' must have one value per configured variable')
            values = [_number(value, field + '[{}]'.format(j)) for j, value in enumerate(point)]
            for value, variable in zip(values, variables):
                if not float(variable['min']) <= value <= float(variable['max']):
                    raise ValueError(field + ' contains a value outside its configured variable range')
            normalized = real_to_normalized_values(values, variables, cfg['variable_mapping'])
            snapped = normalized_to_real_values(normalized, variables, cfg['variable_mapping']).tolist()
            key = tuple(snapped)
            if key not in seen:
                seen.add(key)
                canonical.append(snapped)
        cfg['initial_population'] = canonical

    metrics = cfg.get('metrics', [])
    if not isinstance(metrics, list):
        raise ValueError('metrics must be a list')
    count = sum(_metric(metric, 'metrics[{}]'.format(index)) for index, metric in enumerate(metrics))
    area = cfg.get('area_config') or {}
    count += _metric(area, 'area_config', area=True)
    if count == 0:
        raise ValueError('At least one metric must be enabled')
    if not isinstance(cfg.get('hspice_content'), str) or not cfg['hspice_content'].strip():
        raise ValueError('hspice_content must contain a netlist')
    from analog.simulators import validate_simulator_config
    validate_simulator_config(cfg)
    return cfg

