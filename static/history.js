// Schema-driven history data, view controls and line charts. Uses charts.js helpers.

const historyContainer = document.getElementById('historyChartsContainer');
let currentVizSchema = null;
const historyViews = new Map();
const historyCanvases = new Map();
const historyState = {
  gen: [],
  x: {},      // { chartId: [x0, x1, ...] }
  series: {}  // { seriesId: [y0, y1, ...] }
};

function optimizationHistoryChart(chart) {
  // Shared field contracts, including schemas saved by older Python versions.
  const fields = new Set(['fit_best', 'fit_med', 'fit_mean', 'fit_worst',
    'objective_best', 'violation_min']);
  return Array.isArray(chart.series) && chart.series.some(s => fields.has(s.y_source));
}

function fitnessHistoryChart(chart) {
  return Array.isArray(chart.series) && chart.series.some(s =>
    ['fit_best', 'fit_med', 'fit_mean', 'fit_worst'].includes(s.y_source));
}

function historyText(zh, en) {
  return typeof window.uiText === 'function' ? window.uiText(zh, en) : zh;
}

function historySeriesColor(series, index) {
  return series.color || ['#0aa', '#eab308', '#ef4444', '#22c55e', '#6366f1'][index % 5];
}

function axisNumber(value, precision = 4) {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    return value.toExponential(precision - 1)
      .replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e').replace('e+', 'e');
  }
  return Number(value.toPrecision(precision)).toString();
}

function historyAxis(input, requested = 'linear', focus = [], grid = {}, includeZero = false) {
  const values = input.map(chartNumber).filter(Number.isFinite);
  if (!values.length) return null;
  // The overview carries the absolute fitness reference. Detail windows keep
  // their own range so small late improvements do not disappear against zero.
  if (includeZero) values.push(0);
  let min = Infinity, max = -Infinity, smallest = Infinity;
  for (const v of values) {
    min = Math.min(min, v); max = Math.max(max, v);
    if (v !== 0) smallest = Math.min(smallest, Math.abs(v));
  }
  const unit = Math.max(Math.abs(min), Math.abs(max)) || 1;
  let mode = String(requested).toLowerCase();
  if (mode === 'auto') {
    mode = Math.log(unit) - Math.log(smallest) > Math.log(100) ? 'asinh' : 'linear';
  }
  // A log schema must never fold negative values and zero onto the bottom edge.
  if (mode === 'log' && min <= 0) mode = 'asinh';
  if (!['linear', 'log', 'asinh'].includes(mode)) mode = 'linear';
  let typical = focus.map(chartNumber).filter(v => Number.isFinite(v) && v !== 0).map(Math.abs);
  if (!typical.length) typical = values.filter(v => v !== 0).map(Math.abs);
  typical.sort((a, b) => a - b);
  const threshold = Math.max(Number.MIN_VALUE, (quantileSorted(typical, .5) || 1) * .1);
  const logThreshold = Math.log(threshold);
  const logMax = Math.log(Number.MAX_VALUE);
  const signedLog = y => {
    const ratio = Math.abs(y) / threshold;
    return Math.sign(y) * (ratio < 1e150 ? Math.asinh(ratio)
      : Math.log(Math.abs(y)) - logThreshold + Math.LN2);
  };
  const forward = mode === 'asinh' ? signedLog : mode === 'log' ? Math.log : y => y / unit;
  const inverse = t => {
    if (mode === 'linear') return Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, t * unit));
    if (mode === 'log') return Math.exp(Math.min(logMax, t));
    return Math.abs(t) < 20 ? threshold * Math.sinh(t)
      : Math.sign(t) * Math.exp(Math.min(logMax, logThreshold + Math.abs(t) - Math.LN2));
  };
  let low = forward(min), high = forward(max);
  const span = high - low;
  const pad = span > 0 ? span * .06 : mode === 'linear' ? Math.max(Math.abs(low) * .05, .05) : .2;
  low -= pad; high += pad;
  const position = value => (forward(value) - low) / (high - low);
  const normalizedSpan = max / unit - min / unit;
  // Offset notation keeps small *absolute* differences visible near a large
  // nonzero plateau. It changes tick labels only, never the stored fitness.
  let offset = mode === 'linear' && min !== max && min * Math.sign(max) > 0
    && normalizedSpan < 1e-4 ? min : 0;
  if (offset !== 0) {
    for (let digits = 1; digits <= 17; digits++) {
      const base = Number(min.toPrecision(digits));
      if (Math.abs(base / unit - min / unit) <= 4 * normalizedSpan) { offset = base; break; }
    }
  }
  const count = Math.min(10, Math.max(2, Math.round(Number(grid.ticks) || 5)));
  let tickValues = [];
  if (mode === 'log' && ['log_factor', 'logfactor'].includes(grid.mode)) {
    const factor = Number(grid.factor) > 1 ? Number(grid.factor) : 2;
    const step = Math.log(factor), begin = Math.ceil(low / step), end = Math.floor(high / step);
    const stride = Math.max(1, Math.ceil((end - begin) / count));
    for (let i = 0; i <= count + 1; i++) {
      const k = begin + i * stride;
      if (k > end) break;
      tickValues.push(inverse(k * step));
    }
  }
  if (tickValues.length < 2) {
    tickValues = Array.from({length: count + 1}, (_, i) => inverse(low + (high - low) * i / count));
  }
  if (min <= 0 && max >= 0) tickValues.push(0);
  tickValues = Array.from(new Set(tickValues.filter(v => Number.isFinite(v) && Number.isFinite(position(v)))))
    .sort((a, b) => a - b);
  // Give zero its own tick, without crowding its immediate neighbors.
  const zero = position(0);
  tickValues = tickValues.filter(v => v === 0 || !tickValues.includes(0) || Math.abs(position(v) - zero) > .065);
  let labels;
  for (let precision = 4; precision <= 16; precision++) {
    labels = tickValues.map(v => axisNumber(v - offset, precision));
    if (new Set(labels).size === labels.length) break;
  }
  return {mode, offset, position,
    ticks: tickValues.map((value, i) => ({value, position: position(value), label: labels[i]}))};
}

function addHistoryControls(panel, chart, overview, previous) {
  const signature = JSON.stringify(chart.series.map(s => [s.id, s.y_source]));
  const compatible = previous && previous.signature === signature;
  const view = {signature, mode: compatible ? previous.mode : 'auto',
    recent: compatible ? previous.recent : Math.min(50, Number(chart.max_points) || 50),
    hidden: compatible ? new Set(previous.hidden) : new Set()};
  const controls = document.createElement('div'); controls.className = 'history-controls';
  const scaleLabel = document.createElement('label');
  const scaleText = document.createElement('span');
  const scale = document.createElement('select');
  for (const value of ['auto', 'linear', 'asinh']) {
    const option = document.createElement('option'); option.value = value; scale.appendChild(option);
  }
  scale.value = view.mode;
  scale.addEventListener('change', () => { view.mode = scale.value; redrawHistoryCharts(); });
  scaleLabel.appendChild(scaleText); scaleLabel.appendChild(scale); controls.appendChild(scaleLabel);
  const recentLabel = document.createElement('label');
  const recentText = document.createElement('span');
  const recent = document.createElement('select');
  for (const count of [25, 50, 100, 200]) {
    const option = document.createElement('option'); option.value = String(count); recent.appendChild(option);
  }
  view.recent = [25, 50, 100, 200].includes(view.recent) ? view.recent : 50;
  recent.value = String(view.recent);
  recent.addEventListener('change', () => { view.recent = Number(recent.value); redrawHistoryCharts(); });
  recentLabel.appendChild(recentText); recentLabel.appendChild(recent); controls.appendChild(recentLabel);
  const legend = document.createElement('div'); legend.className = 'history-series-controls';
  chart.series.forEach((series, i) => {
    const label = document.createElement('label');
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !view.hidden.has(series.id);
    box.addEventListener('change', () => {
      if (!box.checked && view.hidden.size === chart.series.length - 1) { box.checked = true; return; }
      if (box.checked) view.hidden.delete(series.id); else view.hidden.add(series.id);
      redrawHistoryCharts();
    });
    const text = document.createElement('span'); text.textContent = series.label || series.id;
    text.style.borderColor = historySeriesColor(series, i);
    label.appendChild(box); label.appendChild(text); legend.appendChild(label);
  });
  const note = document.createElement('div'); note.className = 'history-view-note';
  const detail = document.createElement('canvas'); detail.className = 'history-detail';
  overview.className = 'history-overview';
  panel.appendChild(controls); panel.appendChild(legend); panel.appendChild(overview);
  panel.appendChild(note); panel.appendChild(detail);
  Object.assign(view, {scaleText, scale, recentText, recentSelect: recent, note, detail});
  historyViews.set(chart.id, view);
  updateHistoryControls(view);
}

function updateHistoryControls(view) {
  view.scaleText.textContent = historyText('全程纵轴', 'Overview axis');
  view.recentText.textContent = historyText('细节范围', 'Detail window');
  ['auto', 'linear', 'asinh'].forEach((mode, i) => {
    view.scale.options[i].textContent = [historyText('自动', 'Auto'), historyText('线性', 'Linear'),
      historyText('跨零压缩', 'Signed compression')][i];
  });
  for (const option of view.recentSelect.options) option.textContent = historyText(`最近 ${option.value} 点`, `Last ${option.value} points`);
  view.scale.setAttribute('aria-label', view.scaleText.textContent);
  view.recentSelect.setAttribute('aria-label', view.recentText.textContent);
  view.note.textContent = historyText('近期细节 · 独立线性纵轴；勾选曲线可单独查看。',
    'Recent detail · independent linear axis; select a curve to inspect it separately.');
}

function initHistoryCharts(schema) {
  currentVizSchema = schema || null;
  const previousViews = new Map(historyViews);
  historyViews.clear();
  historyCanvases.clear();
  historyState.gen = [];
  historyState.x = {};
  historyState.series = {};

  if (!historyContainer) return;
  historyContainer.innerHTML = '';

  if (!schema || !Array.isArray(schema.history_charts)) return;

  schema.history_charts.forEach(chart => {
    const panel = document.createElement('div');
    panel.className = 'history-panel';

    const subtitle = document.createElement('div');
    subtitle.className = 'history-subtitle';
    const title = chart.title || chart.id || '';
    subtitle.textContent = typeof window.uiTranslate === 'function'
      ? window.uiTranslate(title)
      : title;

    const canvas = document.createElement('canvas');
    canvas.dataset.chartId = chart.id;
    historyCanvases.set(chart.id, {canvas, subtitle});

    panel.appendChild(subtitle);
    if (optimizationHistoryChart(chart)) addHistoryControls(panel, chart, canvas, previousViews.get(chart.id));
    else panel.appendChild(canvas);
    historyContainer.appendChild(panel);
  });
}
function resetHistoryChartsData(redraw = true) {
  historyState.gen = [];
  historyState.x = {};
  historyState.series = {};
  if (redraw) redrawHistoryCharts();
}

function pushHistoryPointFromProgress(msg, redraw = true) {
  if (!currentVizSchema || !Array.isArray(currentVizSchema.history_charts)) return;

  const g = chartNumber(msg.gen);
  if (!Number.isFinite(g)) return;

  // Appends are constant time; corrections and out-of-order samples use binary search.
  const generations = historyState.gen;
  let index = generations.length;
  if (index && g <= generations[index - 1]) {
    let low = 0, high = index;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (generations[mid] < g) low = mid + 1;
      else high = mid;
    }
    index = low;
  }
  const isNew = generations[index] !== g;
  if (isNew) generations.splice(index, 0, g);

  currentVizSchema.history_charts.forEach(chart => {
    const chartId = chart.id || '';
    const xKey = chart.x_source || 'gen';
    let xv = chartNumber(msg[xKey]);
    if (!Number.isFinite(xv)) xv = g;

    if (!historyState.x[chartId]) historyState.x[chartId] = [];
    const xArray = historyState.x[chartId];
    if (isNew) xArray.splice(index, 0, xv);
    else xArray[index] = xv;

    if (!Array.isArray(chart.series)) return;
    chart.series.forEach(s => {
      const sid = s.id;
      const key = s.y_source;
      const v = chartNumber(msg[key]);
      if (!historyState.series[sid]) historyState.series[sid] = [];
      const series = historyState.series[sid];
      const value = Number.isFinite(v) ? v : NaN;
      if (isNew) series.splice(index, 0, value);
      else series[index] = value;
    });
  });

  if (redraw) redrawHistoryCharts();
}

function restoreHistoryFromProgress(history, redraw = true) {
  historyState.gen = [];
  historyState.x = {};
  historyState.series = {};
  const rows = Array.isArray(history) ? history.slice() : [];
  rows.sort((a,b) => Number(a.gen) - Number(b.gen));
  rows.forEach(row => pushHistoryPointFromProgress(row, false));
  if (redraw) redrawHistoryCharts();
}

function redrawHistoryCharts() {
  if (!currentVizSchema || !Array.isArray(currentVizSchema.history_charts)) return;
  if (!historyContainer) return;

  currentVizSchema.history_charts.forEach(chart => {
    const entry = historyCanvases.get(chart.id);
    const canvas = entry && entry.canvas;
    if (!canvas) return;

    syncCanvasSize(canvas, 480, 300);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const xValues = historyState.x[chart.id] || historyState.gen;
    const view = historyViews.get(chart.id);
    if (view) {
      const series = chart.series.map((s, i) => ({...s, color: historySeriesColor(s, i)}))
        .filter(s => !view.hidden.has(s.id));
      const overview = {...chart, series, max_points: 0, scale: view.mode, show_legend: false,
        view_label: historyText('全程概览', 'Full history')};
      drawLineChart(ctx, canvas, overview, xValues, historyState.series);
      syncCanvasSize(view.detail, 480, 190);
      const detailCtx = view.detail.getContext('2d');
      detailCtx.clearRect(0, 0, view.detail.width, view.detail.height);
      drawLineChart(detailCtx, view.detail, {...chart, series, max_points: view.recent,
        scale: 'linear', show_legend: false, _recent_detail: true,
        view_label: historyText('近期细节', 'Recent detail')},
        xValues, historyState.series);
    } else drawLineChart(ctx, canvas, chart, xValues, historyState.series);
  });
}
// seriesDataMap: { seriesId: [y0,y1,...] }
function drawLineChart(ctx, canvas, chart, xValues, seriesDataMap) {
  const W = canvas.width, H = canvas.height;
  if (!Array.isArray(xValues) || !xValues.length || !Array.isArray(chart.series) || !chart.series.length) return;
  const totalPoints = xValues.length;
  const limit = Number(chart.max_points);
  const idxStart = Number.isFinite(limit) && limit > 0 ? Math.max(0, totalPoints - Math.floor(limit)) : 0;
  const allY = [], focusY = [];
  let minX = Infinity, maxX = -Infinity;
  for (let i = idxStart; i < totalPoints; i++) {
    const x = chartNumber(xValues[i]);
    if (!Number.isFinite(x)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    for (const series of chart.series) {
      const value = chartNumber((seriesDataMap[series.id] || [])[i]);
      if (!Number.isFinite(value)) continue;
      allY.push(value);
      if (i >= Math.max(idxStart, totalPoints - 50)) focusY.push(value);
    }
  }
  const fitness = fitnessHistoryChart(chart);
  const axis = historyAxis(allY, chart.scale || 'linear', focusY, (chart.grid || {}).y || {},
    fitness && !chart._recent_detail);
  const theme = canvasThemeColors();
  ctx.save(); ctx.font = '12px system-ui'; ctx.fillStyle = theme.foreground;
  if (!axis || !Number.isFinite(minX)) {
    ctx.textAlign = 'center';
    ctx.fillText(historyText('暂无有效数据', 'No valid data'), W / 2, H / 2);
    ctx.restore(); return;
  }
  const showLegend = chart.show_legend !== false;
  const note = chart.view_label || axis.mode !== 'linear' || axis.offset !== 0;
  const padL = Math.min(W * .42, Math.max(62, ...axis.ticks.map(t => ctx.measureText(t.label).width + 12)));
  const padR = 14, padT = (showLegend ? 22 : 8) + (note ? 20 : 0), padB = 28;
  const plotW = Math.max(1, W - padL - padR), plotH = Math.max(1, H - padT - padB);
  const xUnit = Math.max(Math.abs(minX), Math.abs(maxX)) || 1;
  const xLow = minX / xUnit, xSpan = maxX / xUnit - xLow;
  const X = x => padL + (xSpan > 0 ? (x / xUnit - xLow) / xSpan : .5) * plotW;
  const Y = y => padT + (1 - axis.position(y)) * plotH;
  ctx.strokeStyle = theme.foreground; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
  ctx.textAlign = 'right';
  for (const tick of axis.ticks) {
    const y = padT + (1 - tick.position) * plotH;
    if (!Number.isFinite(y) || y < padT - 1 || y > H - padB + 1) continue;
    ctx.strokeStyle = tick.value === 0 ? theme.foreground : theme.grid;
    ctx.globalAlpha = tick.value === 0 ? .45 : 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillText(tick.label, padL - 7, y + 4);
  }
  // Respect requested grid steps, but bound tick density for full-run views.
  const xGrid = (chart.grid || {}).x || {};
  const target = Math.min(10, Math.max(2, Math.floor(plotW / 72)));
  const range = maxX - minX;
  let xTicks = [minX];
  if (range > 0 && Number.isFinite(range)) {
    let step = xGrid.mode === 'step' ? Number(xGrid.step) : NaN;
    if (!Number.isFinite(step) || step <= 0) {
      const raw = range / target, base = Math.pow(10, Math.floor(Math.log10(raw)));
      step = base * ([1, 2, 5, 10].find(v => v * base >= raw) || 10);
    } else step *= Math.max(1, Math.ceil(range / step / target));
    const begin = Math.ceil(minX / step);
    for (let i = 0; i <= target + 1; i++) {
      const x = (begin + i) * step;
      if (x > minX && x < maxX) xTicks.push(x);
    }
    xTicks.push(maxX);
  }
  xTicks = xTicks.filter((v, i, a) => i === 0 || i === a.length - 1 ||
    (X(v) - X(minX) > 36 && X(maxX) - X(v) > 36));
  ctx.textAlign = 'center';
  for (const x of xTicks) {
    const px = X(x); ctx.strokeStyle = theme.grid;
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke();
    ctx.fillText(axisNumber(x, 6), px, H - 7);
  }
  const colorForSeries = historySeriesColor;
  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip();
  chart.series.forEach((series, index) => {
    const values = seriesDataMap[series.id] || [];
    ctx.strokeStyle = colorForSeries(series, index); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
    // Overlapping best/median remain identifiable through the dashed median.
    ctx.setLineDash(series.y_source === 'fit_med' ? [5, 3] : []);
    ctx.beginPath(); let started = false, count = 0;
    const isolated = [];
    for (let i = idxStart; i < totalPoints; i++) {
      const x = chartNumber(xValues[i]), y = chartNumber(values[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
      const px = X(x), py = Y(y);
      if (!started) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      const nextValid = i + 1 < totalPoints && Number.isFinite(chartNumber(values[i + 1]))
        && Number.isFinite(chartNumber(xValues[i + 1]));
      if (!started && !nextValid) isolated.push([px, py]);
      started = true; count++;
    }
    if (count) ctx.stroke();
    for (const point of isolated) {
      ctx.beginPath(); ctx.arc(point[0], point[1], 2.5, 0, 2 * Math.PI); ctx.fill();
    }
  });
  ctx.restore();
  if (fitness) {
    const zero = axis.position(0), inside = Number.isFinite(zero) && zero >= 0 && zero <= 1;
    const label = inside ? 'fit = 0' : `${zero < 0 ? '↓' : '↑'} fit = 0 ${historyText('（窗外）', '(outside view)')}`;
    const y = inside ? Y(0) : zero < 0 ? H - padB : padT;
    ctx.save(); ctx.setLineDash([7, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#d97706';
    // Never draw a line at a false y value when zero is outside the zoom window.
    if (inside) {
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.font = 'bold 12px system-ui';
    const labelY = y < padT + 20 ? y + 15 : y - 6;
    const labelW = ctx.measureText(label).width;
    ctx.fillStyle = theme.background;
    ctx.fillRect(W - padR - labelW - 10, labelY - 12, labelW + 10, 16);
    ctx.fillStyle = '#d97706'; ctx.textAlign = 'right';
    ctx.fillText(label, W - padR - 4, labelY); ctx.restore();
  }
  ctx.fillStyle = theme.foreground; ctx.textAlign = 'left';
  if (note) {
    const modeText = axis.mode === 'asinh' ? historyText('跨零压缩', 'Signed compression')
      : axis.mode === 'log' ? historyText('对数', 'Log') : historyText('线性', 'Linear');
    const caption = [chart.view_label, modeText].filter(Boolean).join(' · ');
    ctx.fillText(caption, padL, padT - 9);
    if (axis.offset !== 0) {
      ctx.textAlign = 'right';
      ctx.fillText(`y = ${axisNumber(axis.offset, 17)} + Δ`, W - padR, padT - 9);
    }
  }
  if (showLegend) {
    let x = padL + 5; ctx.textAlign = 'left';
    chart.series.forEach((series, index) => {
      if (series.label === 'none') return;
      ctx.fillStyle = colorForSeries(series, index); ctx.fillRect(x, 7, 12, 3);
      ctx.fillStyle = theme.foreground; ctx.fillText(series.label || series.id, x + 16, 13);
      x += ctx.measureText(series.label || series.id).width + 34;
    });
  }
  ctx.restore();
}

function clearHistoryCanvases() {
  for (const canvas of historyContainer ? historyContainer.querySelectorAll('canvas') : []) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

window.initHistoryCharts = initHistoryCharts;
window.pushHistoryPointFromProgress = pushHistoryPointFromProgress;
window.restoreHistoryFromProgress = restoreHistoryFromProgress;
window.resetHistoryChartsData = resetHistoryChartsData;
window.clearHistoryCanvases = clearHistoryCanvases;
window.redrawHistoryCharts = redrawHistoryCharts;

document.addEventListener('aop:languagechange', () => {
  if (currentVizSchema && Array.isArray(currentVizSchema.history_charts) && historyContainer) {
    currentVizSchema.history_charts.forEach(chart => {
      const entry = historyCanvases.get(chart.id);
      const subtitle = entry && entry.subtitle;
      if (!subtitle) return;
      const title = chart.title || chart.id || '';
      subtitle.textContent = typeof window.uiTranslate === 'function'
        ? window.uiTranslate(title)
        : title;
    });
  }
  historyViews.forEach(updateHistoryControls);
  redrawHistoryCharts();
});

