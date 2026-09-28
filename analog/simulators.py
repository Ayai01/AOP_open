"""Small simulator dispatcher; legacy HSPICE calls/readers remain in metrics."""
import shutil


def backend_name(config):
    name = str(config.get('simulator', 'hspice')).lower()
    if name not in ('hspice', 'ngspice'):
        raise ValueError('simulator must be hspice or ngspice')
    return name


def netlist_for_config(config):
    if backend_name(config) == 'ngspice':
        return (config.get('simulator_options') or {}).get('netlist') or config.get('hspice_content', '')
    return config.get('hspice_content', '')


def validate_simulator_config(config, check_executable=False):
    if backend_name(config) == 'hspice':
        return
    from .ngspice import prepare_decks, settings
    options = settings(config)
    prepare_decks(netlist_for_config(config), config)
    for metric in config.get('metrics', []):
        if metric.get('enabled', True) and metric.get('regex_preset') == 'power':
            raise ValueError('ngspice has no HSPICE element power table. Use a native .meas '
                             'for supply power and the normal/custom measurement preset.')
    if check_executable and not shutil.which(options['command']):
        raise ValueError('ngspice executable not found: ' + options['command']
                         + '. Set simulator_options.command or AOP_NGSPICE_CMD.')


def simulate(input_ckt, output_root, config, hspice_runner, hspice_reader):
    if backend_name(config) == 'hspice':
        path = hspice_runner(input_ckt, output_root)
        if path is None:
            return {'values': {}, '_len': 0, 'ok': False, 'missing_output': True}
        result = hspice_reader(path)
        return dict(result, ok=bool(result.get('_len', 0)))
    from .ngspice import run_ngspice
    return run_ngspice(input_ckt, output_root, config)

