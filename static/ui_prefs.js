// static/ui_prefs.js
// Browser-local appearance preferences. They never enter optimization JSON.

(function initUiPreferences() {
  const KEYS = {
    theme: 'aop.ui.theme',
    palette: 'aop.ui.fitPalette',
    grayTail: 'aop.ui.fitGrayTail',
  };
  const PALETTES = new Set(['classic', 'blackbody', 'turbo', 'viridis', 'magma']);
  const state = { theme: 'dark', palette: 'classic', grayTail: 0.25 };

  function readStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (error) {}
  }
  function clamp(value, lo, hi) {
    const v = Number(value);
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  }
  function loadPreferences() {
    state.theme = readStorage(KEYS.theme, 'dark') === 'light' ? 'light' : 'dark';
    const savedPalette = readStorage(KEYS.palette, 'classic');
    state.palette = PALETTES.has(savedPalette) ? savedPalette : 'classic';
    state.grayTail = clamp(Number(readStorage(KEYS.grayTail, '25')) / 100, 0, 0.50);
  }
  let redrawPending = false;
  let redrawHistoryPending = false;
  function redrawVisuals(includeHistory = false) {
    redrawHistoryPending = redrawHistoryPending || includeHistory;
    if (redrawPending) return;
    redrawPending = true;
    requestAnimationFrame(() => {
      redrawPending = false;
      if (window.lastEmbPoints && window.lastFitListForEmb && typeof window.renderPopulationPanel === 'function') {
        window.renderPopulationPanel(window.lastEmbPoints, window.lastFitListForEmb);
      }
      if (redrawHistoryPending && typeof window.redrawHistoryCharts === 'function') window.redrawHistoryCharts();
      redrawHistoryPending = false;
      drawPalettePreview();
    });
  }
  function applyTheme(theme, persist) {
    if (persist === undefined) persist = true;
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    if (persist) writeStorage(KEYS.theme, state.theme);
    const control = document.getElementById('themeSelect');
    if (control) control.value = state.theme;
    redrawVisuals(true);
  }
  function setPalette(palette, persist) {
    if (persist === undefined) persist = true;
    state.palette = PALETTES.has(palette) ? palette : 'classic';
    if (persist) writeStorage(KEYS.palette, state.palette);
    const control = document.getElementById('fitPaletteSelect');
    if (control) control.value = state.palette;
    redrawVisuals();
  }
  function setGrayTail(percent, persist) {
    if (persist === undefined) persist = true;
    const p = clamp(percent, 0, 50);
    state.grayTail = p / 100;
    if (persist) writeStorage(KEYS.grayTail, p);
    const slider = document.getElementById('fitGrayTail');
    const output = document.getElementById('fitGrayTailValue');
    if (slider) slider.value = String(p);
    if (output) output.value = p + '%';
    redrawVisuals();
  }
  function drawPalettePreview() {
    const canvas = document.getElementById('fitPalettePreview');
    if (!canvas || typeof window.fitToColor !== 'function') return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(240, Math.round(rect.width || 720));
    const height = Math.max(20, Math.round(rect.height || 28));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const sample = [];
    for (let i = 0; i < 161; i++) {
      const q = i / 160;
      sample.push(100 * Math.pow(q, 1.65));
    }
    const stats = typeof window.buildFitColorStats === 'function'
      ? window.buildFitColorStats(sample) : null;
    const cutoff = stats && typeof window.fitGrayTailCutoff === 'function'
      ? window.fitGrayTailCutoff(stats, state.grayTail) : 75;
    for (let x = 0; x < width; x++) {
      const t = width <= 1 ? 0 : x / (width - 1);
      const fit = t * 100;
      ctx.fillStyle = window.fitToColor(fit, 0, 100, 1.0, cutoff, stats);
      ctx.fillRect(x, 0, 1, height);
    }
  }

  loadPreferences();
  document.documentElement.dataset.theme = state.theme;
  window.getFitColorPreferences = function () {
    return { palette: state.palette, grayTail: state.grayTail };
  };
  window.applyUiTheme = applyTheme;
  window.drawFitPalettePreview = drawPalettePreview;

  const themeSelect = document.getElementById('themeSelect');
  const paletteSelect = document.getElementById('fitPaletteSelect');
  const grayTailSlider = document.getElementById('fitGrayTail');
  if (themeSelect) {
    themeSelect.value = state.theme;
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  }
  if (paletteSelect) {
    paletteSelect.value = state.palette;
    paletteSelect.addEventListener('change', () => setPalette(paletteSelect.value));
  }
  if (grayTailSlider) {
    grayTailSlider.value = String(Math.round(state.grayTail * 100));
    grayTailSlider.addEventListener('input', () => setGrayTail(grayTailSlider.value));
  }
  const output = document.getElementById('fitGrayTailValue');
  if (output) output.value = Math.round(state.grayTail * 100) + '%';
  window.addEventListener('load', () => redrawVisuals(true));
  document.addEventListener('aop:languagechange', () => {
    redrawVisuals();
  });
})();

