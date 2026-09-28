"""Public compatibility entry point for the protected hybrid_v3 runtime."""
try:
    from . import _hybrid_v3 as _core
    _core.__name__ = __name__
    optimize = _core.optimize
    REMOVED_PARAMS = _core.REMOVED_PARAMS
    REMOVED_PARAMS_HINT = _core.REMOVED_PARAMS_HINT
except ImportError as exc:
    raise ImportError("AOP_open requires a shipped Linux x86_64 CPython 3.10 or 3.12 runtime. Run python doctor.py for details.") from exc
