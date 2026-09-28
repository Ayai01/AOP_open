"""Platform-owned mapping between normalized optimizer coordinates and real variables."""

import math

import numpy as np


DEFAULT_W_GAMMA = 1.5
DEFAULT_L_GAMMA = 2.0
MIN_MAPPING_GAMMA = 0.5


def normalize_mapping_config(mapping=None):
    """Return finite W/L gamma values constrained to the platform-supported range."""
    mapping = mapping if isinstance(mapping, dict) else {}
    result = {}
    for key, default in (
        ("w_gamma", DEFAULT_W_GAMMA),
        ("l_gamma", DEFAULT_L_GAMMA),
    ):
        try:
            value = float(mapping.get(key, default))
        except (TypeError, ValueError, OverflowError):
            value = default
        if not math.isfinite(value):
            value = default
        result[key] = max(MIN_MAPPING_GAMMA, value)
    return result


def _variable_gamma(name, mapping):
    prefix = str(name or "").strip().lower()[:1]
    if prefix == "w":
        return mapping["w_gamma"]
    if prefix == "l":
        return mapping["l_gamma"]
    return None


def _finite_number(value, field):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError("{} must be a finite number".format(field))
    if not math.isfinite(number):
        raise ValueError("{} must be a finite number".format(field))
    return number


def normalized_to_real_scalar(normalized, minimum, maximum, name="", mapping=None):
    """Map one finite normalized coordinate to a real value."""
    u = _finite_number(normalized, "normalized value")
    minimum = _finite_number(minimum, "minimum")
    maximum = _finite_number(maximum, "maximum")
    gamma = _variable_gamma(name, normalize_mapping_config(mapping))
    return _normalized_to_real(u, minimum, maximum, gamma)


def _normalized_to_real(u, minimum, maximum, gamma):
    """Map validated float64 inputs without reparsing the variable definition."""
    u = min(1.0, max(0.0, u))
    if maximum == minimum:
        return minimum
    if gamma is not None and minimum > 0.0 and maximum > 0.0:
        log_ratio = math.log(maximum / minimum)
        return minimum * math.exp(log_ratio * (u ** gamma))

    return minimum + u * (maximum - minimum)


def real_to_normalized_scalar(value, minimum, maximum, name="", mapping=None):
    """Exact inverse of normalized_to_real_scalar inside the configured range."""
    minimum = _finite_number(minimum, "minimum")
    maximum = _finite_number(maximum, "maximum")
    value = _finite_number(value, "real value")
    gamma = _variable_gamma(name, normalize_mapping_config(mapping))
    return _real_to_normalized(value, minimum, maximum, gamma)


def _real_to_normalized(value, minimum, maximum, gamma):
    """Invert validated float64 inputs, preserving the forward mapping's arithmetic."""
    if maximum == minimum:
        return 0.0

    value = min(maximum, max(minimum, value))
    if gamma is not None and minimum > 0.0 and maximum > 0.0:
        log_ratio = math.log(maximum / minimum)
        if log_ratio == 0.0:
            return 0.0
        exponent_position = math.log(value / minimum) / log_ratio
        exponent_position = min(1.0, max(0.0, exponent_position))
        return exponent_position ** (1.0 / gamma)

    return min(1.0, max(0.0, (value - minimum) / (maximum - minimum)))


def _variable_bounds(variable):
    try:
        minimum = float(variable.get("min"))
        maximum = float(variable.get("max"))
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(minimum) or not math.isfinite(maximum):
        return None
    return minimum, maximum


def _variable_step(variable):
    try:
        step = variable.get("step")
        if step is None or str(step).strip() == "":
            return None
        step = float(step)
        return step if math.isfinite(step) and step > 0.0 else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def normalized_to_real_values(solution, variables, mapping=None, snap_to_step=True):
    """Map a normalized solution vector to real values, optionally quantizing in real space."""
    normalized = np.asarray(solution, dtype=float).ravel()
    if normalized.size and not np.all(np.isfinite(normalized)):
        raise ValueError("normalized solution contains NaN or Inf")
    real = normalized.copy()
    variables = variables or []
    mapping = normalize_mapping_config(mapping)

    for index in range(min(normalized.size, len(variables))):
        variable = variables[index] or {}
        bounds = _variable_bounds(variable)
        if bounds is None:
            real[index] = min(1.0, max(0.0, normalized[index]))
            continue

        minimum, maximum = bounds
        value = _normalized_to_real(
            float(normalized[index]), minimum, maximum,
            _variable_gamma(variable.get("name", ""), mapping),
        )
        step = _variable_step(variable) if snap_to_step else None
        if step is not None:
            value = minimum + np.round((value - minimum) / step) * step
            value = min(maximum, max(minimum, float(value)))
        real[index] = value

    return real


def real_to_normalized_values(values, variables, mapping=None):
    """Map finite real variable values back to normalized optimizer coordinates."""
    real = np.asarray(values, dtype=float).ravel()
    if real.size and not np.all(np.isfinite(real)):
        raise ValueError("real solution contains NaN or Inf")
    normalized = real.copy()
    variables = variables or []
    mapping = normalize_mapping_config(mapping)

    for index in range(min(real.size, len(variables))):
        variable = variables[index] or {}
        bounds = _variable_bounds(variable)
        if bounds is None:
            normalized[index] = real[index]
            continue
        minimum, maximum = bounds
        normalized[index] = _real_to_normalized(
            float(real[index]), minimum, maximum,
            _variable_gamma(variable.get("name", ""), mapping),
        )

    return normalized

