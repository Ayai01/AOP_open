// static/utils.js
// Shared parsing, formatting and export helpers.
//
// Case-insensitive engineering suffixes:
//   a  : 1e-18
//   f  : 1e-15
//   p  : 1e-12
//   n  : 1e-9
//   u  : 1e-6
//   m  : 1e-3
//   k  : 1e3
//   x  : 1e6
//   meg: 1e6
//   g  : 1e9
//   t  : 1e12

// Parse plain numbers or engineering suffixes such as 220n, 10k and 3.3f.
function parseNumber(str) {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (!s) return NaN;

  // Accept plain and scientific notation before checking suffixes.
  if (/^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
  }

  const m = s.match(
    /^([+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?)([A-Za-z]+)$/
  );
  if (!m) return NaN;

  let v = Number(m[1]);
  if (!Number.isFinite(v)) return NaN;

  const sufRaw = m[2];
  const suf = sufRaw.toLowerCase();

  let mul;
  switch (suf) {
    case 'a':       // atto
      mul = 1e-18; break;
    case 'f':       // femto
      mul = 1e-15; break;
    case 'p':       // pico
      mul = 1e-12; break;
    case 'n':       // nano
      mul = 1e-9;  break;
    case 'u':       // micro
      mul = 1e-6;  break;
    case 'm':       // milli
      mul = 1e-3;  break;
    case 'k':       // kilo
      mul = 1e3;   break;
    case 'x':       // Custom mega alias.
    case 'meg':     // SPICE mega suffix; case insensitive.
      mul = 1e6;   break;
    case 'g':       // giga
      mul = 1e9;   break;
    case 't':       // tera
      mul = 1e12;  break;
    default:
      return NaN;
  }

  return v * mul;
}

// Format as units, scientific notation or engineering exponents.
function formatNumberByMode(val, mode) {
  const x = Number(val);
  if (!Number.isFinite(x)) return String(val);

  const absx = Math.abs(x);
  if (absx === 0) {
    if (mode === 'sci') return '0e0';
    if (mode === 'eng') return '0';
    return '0';
  }

  const sign = x < 0 ? '-' : '';
  const ax = absx;

  if (mode === 'sci') {
    return sign + ax.toExponential(3);
  }

  // Engineering exponents are multiples of three.
  const e = Math.floor(Math.log10(ax));
  const engExp = 3 * Math.floor(e / 3);
  const mant = ax / Math.pow(10, engExp);

  if (mode === 'eng') {
    let s = mant.toFixed(3);
    s = s.replace(/\.?0+$/, ''); // Remove trailing zeros.
    if (engExp === 0) {
      return sign + s;
    }
    return sign + s + 'e' + String(engExp);
  }

  //
  // Use the SPICE suffix meg for 1e6; parsing also accepts x.

  const prefixes = {
    '-18': 'a',
    '-15': 'f',
    '-12': 'p',
    '-9':  'n',
    '-6':  'u',
    '-3':  'm',
    '0':   '',
    '3':   'k',
    '6':   'meg',
    '9':   'g',
    '12':  't',
  };

  let useExp = engExp;
  if (!(String(useExp) in prefixes)) {
    // Fall back to scientific notation outside the supported suffix range.
    return sign + ax.toExponential(3);
  }

  let s2 = mant.toFixed(3);
  s2 = s2.replace(/\.?0+$/, '');
  const suf = prefixes[String(useExp)];
  return sign + s2 + suf;
}

// Format physical variable values with engineering units and step alignment.
function formatRealVarValue(v) {
  const rawVal = Number(v.value);
  if (!Number.isFinite(rawVal)) {
    return String(v.value ?? '');
  }

  const vmin = (v.min != null && Number.isFinite(Number(v.min))) ? Number(v.min) : 0;
  const step = (v.step != null && Number.isFinite(Number(v.step))) ? Number(v.step) : null;

  let snapped = rawVal;

  // Align to step to remove floating-point drift.
  if (step && step > 0) {
    const k = Math.round((rawVal - vmin) / step);
    snapped = vmin + k * step;
  }

  // Use engineering suffixes regardless of the selected display mode.
  try {
    return formatNumberByMode(snapped, 'unit');
  } catch (e) {
    // ignore, fallback below
  }

  return snapped.toExponential(4);
}

// Display six values per line, including normalized best_x payloads.
function formatBestXForDisplay(bestX) {
  if (!Array.isArray(bestX) || bestX.length === 0) return '-';

  const perLine = 6;
  const lines = [];
  for (let i = 0; i < bestX.length; i += perLine) {
    const slice = bestX.slice(i, i + perLine).map(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num.toFixed(4) : String(v);
    });
    lines.push(slice.join(', '));
  }
  return lines.join('\n');
}

// Infer metric direction from worst and target.
function metricDirection(worstStr, targetStr) {
  const w = parseNumber(worstStr);
  const t = parseNumber(targetStr);
  if (!Number.isFinite(w) || !Number.isFinite(t)) return 'error';
  if (t > w) return 'max';
  if (t < w) return 'min';
  return 'error';
}

// Match name = number in HSPICE output.
// Accept decimal and scientific notation, not engineering suffixes.

function buildNormalRegex(name) {
  const nm = (name || '').trim();
  if (!nm) return '';
  return String.raw`\b${nm}\b\s*=\s*([^\s]+)`;
}

// Area conversion between square micrometers and square meters.
function um2_to_m2(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return NaN;
  return x * 1e-12;
}

function m2_to_um2(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return NaN;
  return x / 1e-12;
}

function formatAreaDisplay(v) {
  // Display area with engineering exponents rather than suffixes.
  return formatNumberByMode(v, 'eng');
}

// Parse semicolon-separated algorithm parameters.
function parseAlgoParams(text) {
  const map = {};
  if (!text) return map;
  String(text)
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(part => {
      const idx = part.indexOf('=');
      if (idx <= 0) return;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (!key) return;
      map[key] = val;
    });
  return map;
}

const UNLIMITED_GENERATION_TOKENS = new Set([
  'inf', '+inf', 'infinity', '+infinity', 'unlimited', 'manual',
]);

function parseGenerationLimit(value, fallback = '80') {
  const text = String(value == null || value === '' ? fallback : value).trim();
  if (UNLIMITED_GENERATION_TOKENS.has(text.toLowerCase())) return 'inf';
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 ? number : text;
}

// Format parameters as k=v pairs.
function formatAlgoParams(map) {
  if (!map || typeof map !== 'object') return '';
  const keys = Object.keys(map);
  if (!keys.length) return '';
  const ordered = [];
  if (map.pop_size != null) ordered.push('pop_size');
  if (map.n_gen != null) ordered.push('n_gen');
  keys.forEach(k => {
    if (k !== 'pop_size' && k !== 'n_gen') ordered.push(k);
  });
  const parts = [];
  ordered.forEach(k => {
    const v = map[k];
    if (v == null || String(v).trim() === '') return;
    parts.push(`${k}=${v}`);
  });
  return parts.join('; ');
}

// Configuration filename encoding.
function encodeMonthToChar(m) {
  // 1-12 -> "1".."9","A","B","C"
  const table = "123456789ABC";
  if (m >= 1 && m <= 12) return table[m - 1];
  return "0";
}

function encodeDayToChar(d) {
  // 1-9 -> "1".."9"; 10-31 -> "A".."V"
  if (d >= 1 && d <= 9) return String(d);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // A=10, B=11, ...
  const idx = d - 10;
  if (idx >= 0 && idx < letters.length) return letters[idx];
  return "0";
}

function buildConfigFilename(cfg) {
  // 1) ckt_name
  const rawName = (cfg.ckt_name || "").trim() || "noname";
  // Replace unsafe filename characters.
  const safeName = rawName.replace(/[^0-9A-Za-z_\-]+/g, "_");

  // xdim counts variables.
  const xdim = (cfg.variables && cfg.variables.length) ? cfg.variables.length : 0;

  // ydim counts enabled metrics and the optional area objective.
  const metrics = Array.isArray(cfg.metrics) ? cfg.metrics : [];
  const enabledMetrics = metrics.filter(m => m && m.enabled !== false).length;
  let ydim = enabledMetrics;
  const areaCfg = cfg.area_config || {};
  if (areaCfg.enabled) {
    ydim += 1;
  }

  // Encode time as YYMD-HHSSS.
  const now = new Date();
  const YY = String(now.getFullYear() % 100).padStart(2, "0");
  const Mch = encodeMonthToChar(now.getMonth() + 1); // getMonth: 0-11
  const Dch = encodeDayToChar(now.getDate());
  const hour = now.getHours(); // 0-23
  const HH = String(hour).padStart(2, "0");
  const secOfHour = now.getMinutes() * 60 + now.getSeconds(); // 0..3599
  const SSS = secOfHour.toString(16).toUpperCase().padStart(3, "0");

  const timeCode = `${YY}${Mch}${Dch}-${HH}${SSS}`;

  return `AO_cfg_${safeName}_${xdim}-${ydim}_${timeCode}.json`;
}

// Download text through a temporary object URL.
function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], {
    type: mimeType || 'text/plain;charset=utf-8'
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/* Convert common Python regex syntax: \A to ^, \Z/\z to $, named captures to plain groups, and remove inline comments. Validate other syntax with Python re. */
function convertPythonPatternToJs(pat) {
  if (!pat) return pat;
  let p = pat;

  p = p.replace(/\\A/g, '^');
  p = p.replace(/\\Z/g, '$');
  p = p.replace(/\\z/g, '$');

  p = p.replace(/\(\?P<[^>]+>/g, '(');

  p = p.replace(/\(\?#.*?\)/g, '');

  return p;
}

window.parseNumber = parseNumber;
window.formatNumberByMode = formatNumberByMode;
window.formatRealVarValue = formatRealVarValue;
window.formatBestXForDisplay = formatBestXForDisplay;
window.metricDirection = metricDirection;
window.buildNormalRegex = buildNormalRegex;
window.um2_to_m2 = um2_to_m2;
window.m2_to_um2 = m2_to_um2;
window.formatAreaDisplay = formatAreaDisplay;
window.parseAlgoParams = parseAlgoParams;
window.parseGenerationLimit = parseGenerationLimit;
window.formatAlgoParams = formatAlgoParams;
window.buildConfigFilename = buildConfigFilename;
window.downloadTextFile = downloadTextFile;

