# main.py
import importlib
import inspect
import argparse
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time

import numpy as np

from analog import metrics
from config import (
    CACHE_SIZE, DEFAULT_POOL_PROCS, HOST, PORT,
    check_cache_conflict_count, check_cache_hit_count, check_cache_miss_count,
    clear_sim_count, print_cache_memory_info,
)
from server.http_server import set_status_snapshot, start_http_server, take_start_config
from utils.basic import format_engineering
from utils.validation import parse_algo_params, validate_config


def load_algorithm_optimize(name: str):
    """Dynamically load algorithm.<name>.optimize."""
    module_name = f"algorithm.{name}"
    print(f"[MAIN] Loading algorithm module: {module_name}")
    module = importlib.import_module(module_name)
    if not hasattr(module, "optimize"):
        raise AttributeError(f"Algorithm module '{module_name}' has no 'optimize' function")
    return module.optimize


def _finite_float(value):
    try:
        value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return value if np.isfinite(value) else None


def _format_metric_list(values):
    if values is None:
        return "-"
    values = list(values)
    if not values:
        return "-"
    cells = []
    for value in values:
        number = _finite_float(value)
        cells.append("nan" if number is None else f"{number:.6g}")
    return "[" + ", ".join(cells) + "]"


def _build_platform_result_text(payload, best_detail, variables, real_values, normalized_values, mapping):
    best_fitness = _finite_float(payload.get("best_fitness"))
    if best_fitness is None:
        best_fitness = _finite_float(best_detail.get("fit"))

    lines = [
        "best fitness: " + ("nan" if best_fitness is None else f"{best_fitness:.6g}"),
        "",
        "尺寸映射（平台统一）: γW={:.6g}, γL={:.6g}".format(
            mapping["w_gamma"], mapping["l_gamma"]
        ),
        "",
        "best x（归一化，已按实际 step 反向映射）:",
    ]

    if normalized_values.size:
        for start in range(0, normalized_values.size, 12):
            chunk = normalized_values[start:start + 12]
            lines.append("  " + ", ".join(
                f"x{start + offset}={float(value):.6g}"
                for offset, value in enumerate(chunk)
            ))
    else:
        lines.append("  -")

    lines.extend(["", "设计变量（实际数值）:"])
    if real_values.size:
        for start in range(0, real_values.size, 6):
            parts = []
            for offset, value in enumerate(real_values[start:start + 6]):
                index = start + offset
                if index < len(variables):
                    name = str((variables[index] or {}).get("name") or f"x{index}")
                else:
                    name = f"x{index}"
                parts.append(f"{name}={format_engineering(float(value))}")
            lines.append("  " + ", ".join(parts))
    else:
        lines.append("  -")

    lines.extend([
        "",
        "指标（原始值）:",
        "  " + _format_metric_list(best_detail.get("raw_metrics")),
        "",
        "指标（归一化后）:",
        "  " + _format_metric_list(best_detail.get("norm_metrics")),
    ])
    return "\n".join(lines)


def _platform_finalize_done_message(message, cfg):
    """Make plugin final output consistent with the platform-owned variable mapping."""
    if not isinstance(message, dict) or message.get("event") != "done" or message.get("error"):
        return message

    payload = dict(message)
    best_detail = dict(payload.get("best_detail") or {})
    source_normalized = best_detail.get("x_norm")
    if source_normalized is None:
        source_normalized = payload.get("best_x")
    if source_normalized is None:
        return payload

    try:
        real_values = np.asarray(
            metrics.normalized_to_real_values(source_normalized, snap_to_step=True),
            dtype=float,
        ).ravel()
        normalized_values = np.asarray(
            metrics.real_to_normalized_values(real_values),
            dtype=float,
        ).ravel()
    except Exception as exc:
        print(f"[MAIN] Failed to canonicalize final variable mapping: {exc}")
        return payload

    variables = cfg.get("variables") or []
    mapping = metrics.get_variable_mapping_config()
    variable_details = []
    for index, value in enumerate(real_values):
        variable = variables[index] if index < len(variables) and variables[index] else {}
        name = str(variable.get("name") or f"x{index}")
        item = {"name": name, "value": float(value)}
        for key in ("min", "max", "step"):
            number = _finite_float(variable.get(key))
            if number is not None:
                item[key] = number
        prefix = name.strip().lower()[:1]
        if prefix == "w":
            item["mapping"] = "log_power"
            item["gamma"] = mapping["w_gamma"]
        elif prefix == "l":
            item["mapping"] = "log_power"
            item["gamma"] = mapping["l_gamma"]
        else:
            item["mapping"] = "linear"
        variable_details.append(item)

    best_detail["variables"] = variable_details
    best_detail["real_x"] = real_values.tolist()
    best_detail["x_norm"] = normalized_values.tolist()
    best_detail["variable_mapping"] = dict(mapping)
    payload["best_x"] = normalized_values.tolist()
    payload["best_detail"] = best_detail
    payload["final_result_text"] = _build_platform_result_text(
        payload,
        best_detail,
        variables,
        real_values,
        normalized_values,
        mapping,
    )
    return payload


class PlatformMessageQueue:
    """Transparent queue proxy that only normalizes final plugin output."""

    def __init__(self, raw_queue, cfg):
        self._raw_queue = raw_queue
        self._cfg = cfg

    def put(self, item, *args, **kwargs):
        return self._raw_queue.put(_platform_finalize_done_message(item, self._cfg), *args, **kwargs)

    def put_nowait(self, item):
        return self._raw_queue.put_nowait(_platform_finalize_done_message(item, self._cfg))

    def __getattr__(self, name):
        return getattr(self._raw_queue, name)


def run_one_optimization(cfg: dict, msg_q, stop_evt, pause_evt, evaluator=None):
    """Contain configuration, initialization, algorithm and cleanup failures per task."""
    final_status = None
    try:
        cfg = validate_config(cfg)
        algo_name = cfg["algo"]
        extra_params = parse_algo_params(cfg.get("algo_params", ""))
        extra_params.setdefault("pop_size", cfg["pop_size"])
        extra_params.setdefault("n_gen", cfg["n_gen"])
        optimize_fn = load_algorithm_optimize(algo_name)
        workers = int(cfg.get("workers") or DEFAULT_POOL_PROCS)
        if evaluator is None:
            metrics.set_context(cfg, workers=workers)
        else:
            metrics.set_context(cfg, workers=workers, evaluator=evaluator)
        print(
            "[MAIN] {} workers = {}{}.".format(
                'CALLBACK' if evaluator is not None else cfg.get('simulator', 'hspice').upper(),
                workers,
                " (server default)" if "workers" not in cfg else "",
            )
        )
        platform_queue = PlatformMessageQueue(msg_q, cfg)
        candidate_kwargs = {
            "x_dim": cfg["dim"], "queue": platform_queue,
            "stop_event": stop_evt, "pause_event": pause_evt,
        }
        candidate_kwargs.update(extra_params)
        signature = inspect.signature(optimize_fn)
        if cfg.get('initial_population'):
            if 'initial_population' not in signature.parameters:
                raise ValueError('Algorithm does not support initial_population: ' + algo_name)
            # The public configuration uses physical units; optimizers receive
            # the same canonical normalized coordinates as ordinary proposals.
            candidate_kwargs['initial_population'] = np.asarray([
                metrics.canonicalize_normalized_values(metrics.real_to_normalized_values(row))
                for row in cfg['initial_population']
            ], dtype=float)
        has_var_kwargs = any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )
        call_kwargs = candidate_kwargs if has_var_kwargs else {
            key: value for key, value in candidate_kwargs.items() if key in signature.parameters
        }
        set_status_snapshot({
            "status": "running",
            "algo": algo_name,
            "gen": 0,
            "workers": workers,
        })
        start_time = time.time()
        best_fitness, best_x = optimize_fn(**call_kwargs)
        print(
            "[MAIN] Optimization finished. best_f={}, elapsed={:.2f}s".format(
                best_fitness, time.time() - start_time
            )
        )
        final_status = {"status": "finished", "best": best_fitness}
    except KeyboardInterrupt:
        stop_evt.set()
        final_status = {"status": "stopping", "message": "KeyboardInterrupt"}
        raise
    except Exception as exc:
        print("[MAIN] Task failed: {}".format(exc))
        final_status = {"status": "error", "message": str(exc)}
        msg_q.put({"event": "done", "best_fitness": None, "best_x": [], "error": str(exc)})
    finally:
        try:
            metrics.shutdown_pool()
        except Exception as exc:
            print("[MAIN] Pool cleanup failed: {}".format(exc))
            final_status = {"status": "error", "message": str(exc)}
        clear_sim_count()
        if final_status is not None:
            set_status_snapshot(final_status)


def run_headless(cfg, output, evaluator=None, stop_event=None):
    """Run the same optimizer without a web server and retain its complete result.

    An optional callable receives a matrix of actual variable values, in the
    configured units, and returns raw metrics in enabled metric order, then area
    if enabled. It owns the physical simulator, cache and evaluation budget.
    Optional cfg.initial_population rows use the same real units and variable
    order; supporting algorithms retain them in their initial active population.
    """
    output = Path(output).expanduser().resolve()
    if (output / 'result.json').exists() or (output / 'input.json').exists():
        raise ValueError('Output already contains an optimization; choose a new directory')
    output.mkdir(parents=True, exist_ok=True)
    def safe(value):
        if isinstance(value, dict): return {str(k): safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple, np.ndarray)): return [safe(v) for v in value]
        if isinstance(value, np.generic): return safe(value.item())
        if isinstance(value, float) and not np.isfinite(value): return None
        return value
    def write(name, value):
        path = output / name
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(json.dumps(safe(value), ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        temporary.replace(path)
    class ResultQueue:
        result = None
        def put(self, value):
            value = safe(value)
            if value.get('event') == 'done':
                from config import check_sim_count
                value['simulator_evaluations'] = check_sim_count()
                if evaluator is not None:
                    value['evaluation_backend'] = 'external_callback'
                    value['simulator_evaluations'] = None
                    # The placeholder deck is only a parameter mapping aid.
                    detail = value.get('best_detail') or {}
                    detail['netlist'] = None
                    detail['skill_script'] = None
                self.result = value
                write('result.json', value)
            else:
                with (output / 'progress.jsonl').open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
        put_nowait = put
    write('input.json', cfg)
    messages = ResultQueue()
    run_one_optimization(cfg, messages, stop_event or threading.Event(), threading.Event(), evaluator=evaluator)
    if messages.result is None:
        raise RuntimeError('Optimizer returned without a result')
    return messages.result


def main(argv=None):
    parser = argparse.ArgumentParser(description='AOP optimization: web UI by default, or --config for direct execution.')
    parser.add_argument('--config', type=Path, help='Existing AOP JSON configuration')
    parser.add_argument('--headless', action='store_true', help='Run without opening the web interface (requires --config)')
    parser.add_argument('--output', type=Path, help='New directory for input, progress and complete population/result')
    parser.add_argument('--check-only', action='store_true', help='Validate configuration without simulation')
    args = parser.parse_args(argv)
    if args.config is None:
        if args.headless or args.output or args.check_only:
            parser.error('--config is required for direct execution')
        run_ui()
        return 0
    cfg = json.loads(args.config.expanduser().resolve().read_text(encoding='utf-8-sig'))
    cfg.setdefault('project_root', str(Path(__file__).resolve().parent))
    if args.check_only:
        validate_config(cfg)
        print('Configuration valid; no simulator calls.')
        return 0
    from datetime import datetime
    output = args.output or Path(__file__).resolve().parent / 'results' / datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    result = run_headless(cfg, output)
    print('Results: ' + str(output.resolve()))
    if result.get('error'):
        print(result['error'], file=sys.stderr)
        return 2
    return 0


def run_ui():
    print("========== [MAIN] AnalogOpt main starting ==========")
    print(f"[MAIN] HOST = {HOST}, PORT = {PORT}")
    print_cache_memory_info()
    print("[CACHE] Fixed capacity limit: {} rows.".format(CACHE_SIZE))

    msg_q = queue.Queue()
    start_evt = threading.Event()
    stop_evt = threading.Event()
    pause_evt = threading.Event()
    exit_evt = threading.Event()
    config_store = {}

    base_dir = os.path.dirname(os.path.abspath(__file__))
    static_dir = os.path.join(base_dir, "static")

    httpd = start_http_server(
        host=HOST,
        port=PORT,
        static_dir=static_dir,
        msg_q=msg_q,
        start_evt=start_evt,
        stop_evt=stop_evt,
        pause_evt=pause_evt,
        exit_evt=exit_evt,
        config_store=config_store,
    )

    server_thread = threading.Thread(
        target=httpd.serve_forever,
        kwargs={"poll_interval": 0.5},
        daemon=True,
    )
    server_thread.start()
    print(f"[MAIN] HTTP server thread started, ident = {server_thread.ident}")

    try:
        while not exit_evt.is_set():
            print("[MAIN] Waiting for start_evt ... (Ctrl+C to exit)")
            while not exit_evt.is_set():
                if start_evt.wait(timeout=0.2):
                    break

            if exit_evt.is_set():
                print("[MAIN] exit_evt is set, break main loop.")
                break
            if not start_evt.is_set():
                continue

            print("[MAIN] start_evt detected, preparing optimization ...")
            cfg = take_start_config()
            if not cfg:
                print("[MAIN] WARNING: start_evt set but config_store is empty.")
                continue

            print("[MAIN] Config from HTTP /start_opt")
            run_one_optimization(cfg, msg_q, stop_evt, pause_evt)

    except KeyboardInterrupt:
        print("[MAIN] KeyboardInterrupt in main(), requesting shutdown ...")
        exit_evt.set()
        stop_evt.set()
    finally:
        print("[MAIN] Shutting down HTTP server ...")
        try:
            httpd.shutdown()
        except Exception as exc:
            print(f"[MAIN] httpd.shutdown() error: {exc}")
        try:
            httpd.server_close()
        except Exception as exc:
            print(f"[MAIN] httpd.server_close() error: {exc}")

        try:
            server_thread.join(timeout=2.0)
        except Exception:
            pass

        try:
            hit = check_cache_hit_count(0)
            miss = check_cache_miss_count(0)
            conflict = check_cache_conflict_count(0)
            print(f"[MAIN] Cache stats: hit={hit}, miss={miss}, conflict={conflict}")
        except Exception as exc:
            print(f"[MAIN] Cache stats unavailable: {exc}")

        print("[MAIN] Exit complete.")


if __name__ == "__main__":
    sys.exit(main())

