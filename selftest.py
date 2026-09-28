"""Exercise the real protected optimizer with a synthetic evaluator; no SPICE required."""
import contextlib
import io
import json
import tempfile
from pathlib import Path
import numpy as np
from main import run_headless


def main():
    root = Path(__file__).resolve().parent
    for name in ('TSA', 'TSA_28_4C', 'FSA', 'CLASSAB'):
        cfg = json.loads((root / 'json' / (name + '.json')).read_text())
        cfg.update(pop_size=12, n_gen=3, workers=1,
                   algo_params='seed=921;init_samples=16;archive_export_limit=0')
        enabled = [m for m in cfg['metrics'] if m.get('enabled', True)]
        lower = np.array([v['min'] for v in cfg['variables']])
        upper = np.array([v['max'] for v in cfg['variables']])
        calls = []
        def evaluate(values):
            calls.append(len(values))
            u = (values - lower) / (upper - lower)
            quality = .4 + .3 * np.mean(1 - (u - .6) ** 2, axis=1)
            columns = [float(m['worst']) + (float(m['target']) - float(m['worst'])) * quality
                       for m in enabled]
            area = cfg.get('area_config', {})
            if area.get('enabled'):
                columns.append(np.full(len(values), (float(area['worst']) + float(area['target'])) / 2))
            return np.column_stack(columns)
        with tempfile.TemporaryDirectory() as output, contextlib.redirect_stdout(io.StringIO()):
            result = run_headless(cfg, output, evaluator=evaluate)
            assert not result.get('error'), result.get('error')
            assert calls and np.isfinite(result['best_fitness'])
            assert len(result['best_x']) == len(cfg['variables'])
            assert (Path(output) / 'result.json').is_file()
        print(name + ': PASS; ' + str(sum(calls)) + ' synthetic evaluations')
    print('hybrid_v3 executes successfully. These are software tests, not circuit measurements.')

if __name__ == '__main__': main()
