# server/http_server.py
import errno
import http.server
import json
import math
import os
import socket
import socketserver
import time
import threading
from collections import deque
from functools import partial
from queue import Empty, Full, Queue

import numpy as np

from config import CPU_COUNT, DEFAULT_POOL_PROCS, MAX_POOL_PROCS, PROJECT_ROOT
from utils.validation import validate_config


def to_jsonable(obj):
    """Normalize plugin values once at the JSON boundary; missing numbers are null."""
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    if isinstance(obj, (float, np.floating)):
        return float(obj) if math.isfinite(obj) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        if obj.dtype.hasobject:
            return to_jsonable(obj.tolist())
        if np.issubdtype(obj.dtype, np.floating) and not np.isfinite(obj).all():
            return np.where(np.isfinite(obj), obj, None).tolist()
        return obj.tolist()
    if isinstance(obj, dict):
        return {str(key): to_jsonable(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(value) for value in obj]
    return str(obj)


MESSAGE_Q = None
START_EVT = None
STOP_EVT = None
PAUSE_EVT = None
EXIT_EVT = None
CONFIG_STORE = None

STATUS_SNAPSHOT = {"status": "idle"}

STATE_LOCK = threading.RLock()
BROADCAST = None

PING_INTERVAL = 10.0
SSE_SUBSCRIBER_QUEUE_SIZE = 64
VISUAL_HISTORY_LIMIT = 10000


def set_status_snapshot(snap: dict):
    global STATUS_SNAPSHOT
    with STATE_LOCK:
        STATUS_SNAPSHOT = dict(snap or {})


def get_status_snapshot() -> dict:
    with STATE_LOCK:
        return dict(STATUS_SNAPSHOT or {})


def take_start_config():
    with STATE_LOCK:
        START_EVT.clear()
        return dict(CONFIG_STORE or {})


class EventBroadcast:
    """One queue consumer fans out each event to bounded subscriber queues."""

    def __init__(self, source):
        self.source = source
        self.lock = threading.Lock()
        self.subscribers = set()
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._dispatch, daemon=True)

        self.visual_lock = threading.RLock()
        self.visual_run_id = 0
        self.visual_schema = None
        self.visual_history = deque(maxlen=VISUAL_HISTORY_LIMIT)
        self.latest_progress = None
        self.latest_done = None

    def reset_visual_state(self):
        with self.visual_lock:
            self.visual_run_id += 1
            self.visual_schema = None
            self.visual_history.clear()
            self.latest_progress = None
            self.latest_done = None

    @staticmethod
    def _compact_progress(message):
        compact = {}
        for key, value in message.items():
            if key == "event":
                continue
            if value is None or isinstance(value, (str, bool, int, float)):
                compact[key] = value
        return compact

    def _remember_visual(self, message):
        if not isinstance(message, dict):
            return
        event = message.get("event")
        with self.visual_lock:
            if event == "viz_schema":
                self.visual_schema = dict(message.get("schema") or {})
                self.visual_history.clear()
                self.latest_progress = None
                self.latest_done = None
            elif event == "progress":
                compact = self._compact_progress(message)
                generation = compact.get("gen")
                if (
                    self.visual_history
                    and generation is not None
                    and self.visual_history[-1].get("gen") == generation
                ):
                    self.visual_history[-1] = compact
                else:
                    self.visual_history.append(compact)
                self.latest_progress = dict(message)
            elif event == "done":
                self.latest_done = dict(message)

    def visual_snapshot(self):
        with self.visual_lock:
            return {
                "run_id": self.visual_run_id,
                "schema": dict(self.visual_schema or {}),
                "history": [dict(item) for item in self.visual_history],
                "latest_progress": (
                    None if self.latest_progress is None
                    else dict(self.latest_progress)
                ),
                "done": (
                    None if self.latest_done is None
                    else dict(self.latest_done)
                ),
            }

    def subscribe(self):
        subscriber = Queue(maxsize=SSE_SUBSCRIBER_QUEUE_SIZE)
        with self.lock:
            self.subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber):
        with self.lock:
            self.subscribers.discard(subscriber)

    @staticmethod
    def _offer(subscriber, packet):
        try:
            subscriber.put_nowait(packet)
            return
        except Full:
            pass

        # Progress is lossy by design: if a local browser cannot consume fast enough,
        # keeping stale progress is less useful than protecting server memory.
        if packet[0] == "progress":
            return

        # Critical events (viz_schema/done/other control-like events) get one slot by
        # evicting the oldest queued item. This keeps memory bounded while preserving
        # final completion delivery under CPU saturation.
        try:
            subscriber.get_nowait()
        except Empty:
            pass
        try:
            subscriber.put_nowait(packet)
        except Full:
            pass

    def _dispatch(self):
        while not self.closed.is_set():
            try:
                message = self.source.get(timeout=0.2)
            except Empty:
                continue
            if not isinstance(message, dict) or not message.get("event"):
                continue
            message = to_jsonable(message)
            self._remember_visual(message)
            with self.lock:
                subscribers = tuple(self.subscribers)
            if subscribers:
                payload = dict(message)
                event = payload.pop("event")
                wire = "event: {}\ndata: {}\n\n".format(event, json.dumps(
                    payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))).encode("utf-8")
                packet = (event, wire)
                for subscriber in subscribers:
                    self._offer(subscriber, packet)

    def start(self):
        self.thread.start()

    def close(self):
        self.closed.set()
        self.thread.join(timeout=1.0)


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def server_close(self):
        broker = getattr(self, "broadcast", None)
        if broker is not None:
            broker.close()
        super().server_close()

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass
        try:
            reuseport = getattr(socket, "SO_REUSEPORT", None)
            if reuseport is not None:
                self.socket.setsockopt(socket.SOL_SOCKET, reuseport, 1)
        except Exception:
            pass
        super().server_bind()


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def end_headers(self):
        path = self.path.split("?", 1)[0].lower()
        if (
            path == "/"
            or path.endswith(".html")
            or path.endswith(".js")
            or path.endswith(".css")
        ):
            self.send_header(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, max-age=0",
            )
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(to_jsonable(obj), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global MESSAGE_Q, CONFIG_STORE, EXIT_EVT

        path = self.path.split("?", 1)[0]

        if path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if path == "/":
            return super().do_GET()

        if path == "/stream":
            broker, exit_event = BROADCAST, EXIT_EVT
            subscriber = broker.subscribe()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                snapshot = broker.visual_snapshot()
                self.wfile.write(
                    "event: visual_restore\ndata: {}\n\n".format(
                        json.dumps(to_jsonable(snapshot), ensure_ascii=False)
                    ).encode("utf-8")
                )
                self.wfile.flush()

                last_ping = 0.0
                while not broker.closed.is_set() and (exit_event is None or not exit_event.is_set()):
                    now = time.monotonic()
                    if now - last_ping >= PING_INTERVAL:
                        self.wfile.write(b"event: ping\ndata: {}\n\n")
                        self.wfile.flush()
                        last_ping = now
                    try:
                        _, wire = subscriber.get(timeout=0.5)
                    except Empty:
                        continue
                    self.wfile.write(wire)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                broker.unsubscribe(subscriber)
                self.close_connection = True
            return

        if path == "/state":
            with STATE_LOCK:
                cfg = dict(CONFIG_STORE or {})
                snap = get_status_snapshot()
            worker_limit = max(1, min(int(CPU_COUNT), int(MAX_POOL_PROCS)))
            return self._json({
                "config": cfg,
                "status": snap,
                "server": {
                    "cpu_count": int(CPU_COUNT),
                    "default_workers": int(DEFAULT_POOL_PROCS),
                    "max_workers": worker_limit,
                },
            }, status=200)

        if path == "/visual_state":
            broker = BROADCAST
            snapshot = broker.visual_snapshot() if broker is not None else {
                "run_id": 0,
                "schema": {},
                "history": [],
                "latest_progress": None,
                "done": None,
            }
            return self._json(snapshot, status=200)

        if path == "/algorithms":
            import importlib

            algos = []
            try:
                for fn in os.listdir(os.path.join(PROJECT_ROOT, "algorithm")):
                    if not fn.endswith(".py"):
                        continue
                    if fn == "__init__.py":
                        continue
                    name = fn[:-3]
                    mod_name = f"algorithm.{name}"
                    try:
                        mod = importlib.import_module(mod_name)
                    except Exception as e:
                        print(f"[SERVER] skip algorithm '{mod_name}' (import error: {e})")
                        continue

                    opt = getattr(mod, "optimize", None)
                    if not callable(opt):
                        print(f"[SERVER] skip algorithm '{mod_name}' (no callable optimize)")
                        continue

                    algos.append(name)
            except Exception as e:
                print(f"[SERVER] /algorithms scan error: {e}")

            algos.sort()
            return self._json({"algorithms": algos}, status=200)

        return super().do_GET()

    def do_POST(self):
        global START_EVT, STOP_EVT, PAUSE_EVT, CONFIG_STORE, EXIT_EVT

        path = self.path.split("?", 1)[0]
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0:
                raise ValueError("Negative Content-Length")
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            return self._json({"error": "invalid_request", "message": str(exc)}, status=400)

        if path == "/dim_reduce":
            try:
                from utils.dim_reduce import (
                    mds_reduce,
                    pca_reduce,
                    tsne_reduce,
                    umap_reduce,
                )

                method = str(data.get("method") or "pca").strip().lower()
                reducers = {
                    "pca": pca_reduce,
                    "umap": umap_reduce,
                    "tsne": tsne_reduce,
                    "mds": mds_reduce,
                }
                if method not in reducers:
                    raise ValueError("unsupported dimensionality reduction method")

                points = np.asarray(data.get("points"), dtype=np.float32)
                if points.ndim != 2:
                    raise ValueError("points must be a 2D numeric array")
                if points.shape[0] < 2:
                    raise ValueError("at least two points are required")
                if points.shape[0] > 2000 or points.shape[1] > 512:
                    raise ValueError("point matrix is too large for interactive visualization")
                if not np.all(np.isfinite(points)):
                    raise ValueError("points must contain only finite values")

                reduced = reducers[method]([points], n_components=2)
                if not reduced or len(reduced) != 1:
                    raise RuntimeError("dimensionality reduction failed")
                embedding = np.asarray(reduced[0], dtype=np.float32)
                if embedding.shape != (points.shape[0], 2):
                    raise RuntimeError("dimensionality reduction returned an invalid shape")
                return self._json({
                    "method": method,
                    "points": embedding.tolist(),
                    "count": int(points.shape[0]),
                })
            except (TypeError, ValueError, RuntimeError) as exc:
                return self._json(
                    {"error": "dim_reduce_failed", "message": str(exc)},
                    status=400,
                )

        if path == "/start_opt":
            try:
                data = validate_config(data)
            except (TypeError, ValueError) as exc:
                return self._json({"error": "invalid_config", "message": str(exc)}, status=400)
            with STATE_LOCK:
                busy = START_EVT.is_set() or get_status_snapshot().get("status") in (
                    "starting", "running", "paused", "stopping")
                if busy:
                    response, code = {"error": "busy", "message": "An optimization is already active"}, 409
                else:
                    if BROADCAST is not None:
                        BROADCAST.reset_visual_state()
                    CONFIG_STORE.clear()
                    CONFIG_STORE.update(data)
                    STOP_EVT.clear()
                    PAUSE_EVT.clear()
                    START_EVT.set()
                    set_status_snapshot({"status": "starting"})
                    response, code = {"status": "started"}, 200
            return self._json(response, status=code)

        if path in ("/stop_opt", "/pause_opt", "/resume_opt"):
            with STATE_LOCK:
                snap = get_status_snapshot()
                active = snap.get("status") in ("starting", "running", "paused", "stopping")
                if not active:
                    response, code = {"error": "idle", "message": "No active optimization"}, 409
                elif path == "/stop_opt":
                    STOP_EVT.set()
                    snap["status"] = "stopping"
                    set_status_snapshot(snap)
                    response, code = {"status": "stopping"}, 200
                elif snap.get("status") == "stopping":
                    response, code = {"error": "stopping", "message": "Optimization is stopping"}, 409
                else:
                    if path == "/pause_opt":
                        PAUSE_EVT.set()
                        snap["status"] = "paused"
                    else:
                        PAUSE_EVT.clear()
                        snap["status"] = "running"
                    set_status_snapshot(snap)
                    response, code = {"status": snap["status"]}, 200
            return self._json(response, status=code)

        if path == "/shutdown":
            if EXIT_EVT is not None:
                EXIT_EVT.set()
            if STOP_EVT is not None:
                STOP_EVT.set()
            return self._json({"status": "shutting_down"})

        return self._json({"error": "not_found"}, status=404)


def _try_connect(host: str, port: int, timeout=0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def start_http_server(host, port, static_dir, msg_q, start_evt, stop_evt, pause_evt, exit_evt, config_store):
    global MESSAGE_Q, START_EVT, STOP_EVT, PAUSE_EVT, EXIT_EVT, CONFIG_STORE, BROADCAST
    MESSAGE_Q = msg_q
    START_EVT = start_evt
    STOP_EVT = stop_evt
    PAUSE_EVT = pause_evt
    EXIT_EVT = exit_evt
    CONFIG_STORE = config_store

    Handler = partial(RequestHandler, directory=static_dir)

    attempts = 10
    backoff = 0.25
    httpd = None

    for _ in range(attempts):
        try:
            httpd = ReusableThreadingTCPServer((host, port), Handler)
            break
        except OSError as e:
            if e.errno == errno.EADDRINUSE:
                if _try_connect(host, port, timeout=0.25):
                    raise
                time.sleep(backoff)
                backoff = min(backoff * 2.0, 2.0)
                continue
            raise

    if httpd is None:
        raise OSError(f"Failed to bind {host}:{port} after {attempts} attempts")

    BROADCAST = EventBroadcast(msg_q)
    httpd.broadcast = BROADCAST
    BROADCAST.start()
    set_status_snapshot({"status": "idle"})
    print(f"[SERVER] Serving on http://{host}:{port}")
    return httpd

