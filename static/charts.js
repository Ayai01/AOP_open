// Shared canvas sizing, numeric conversion and fitness colors. Shared by population and history charts.

function syncCanvasSize(canvas, defaultWidth = 480, defaultHeight = 300) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  let w = Math.floor(rect.width);
  let h = Math.floor(rect.height);
  if (w <= 0) w = defaultWidth;
  if (h <= 0) h = defaultHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function chartNumber(value) {
  if (value == null || typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')) return NaN;
  return Number(value);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function canvasThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    background: read('--canvas-bg', '#ffffff'),
    foreground: read('--canvas-fg', '#111827'),
    grid: read('--canvas-grid', 'rgba(15,23,42,.13)'),
    border: read('--canvas-border', '#6b7280'),
  };
}

function quantileSorted(sorted, q) {
  if (!Array.isArray(sorted) || sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = clamp01(q) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const t = pos - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function buildFitColorStats(fitList) {
  const sorted = (Array.isArray(fitList) ? fitList : [])
    .map(v => chartNumber(v))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    sorted,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q05: quantileSorted(sorted, 0.05),
    q50: quantileSorted(sorted, 0.50),
    q95: quantileSorted(sorted, 0.95),
  };
}

function empiricalCdf(value, sorted) {
  if (!Array.isArray(sorted) || sorted.length <= 1) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return clamp01((lo - 1) / Math.max(1, sorted.length - 1));
}

function fitDistributionBadness(fit, stats) {
  const v = chartNumber(fit);
  if (!Number.isFinite(v) || !stats || !stats.sorted.length) return 1;
  const rankBadness = empiricalCdf(v, stats.sorted);
  const lo = Number.isFinite(stats.q05) ? stats.q05 : stats.min;
  const hi = Number.isFinite(stats.q95) && stats.q95 > lo ? stats.q95 : stats.max;
  const valueBadness = hi > lo ? clamp01((v - lo) / (hi - lo)) : rankBadness;
  return clamp01(0.74 * rankBadness + 0.26 * valueBadness);
}

function fitGrayTailFraction() {
  const prefs = (typeof window.getFitColorPreferences === 'function')
    ? window.getFitColorPreferences() : null;
  const fraction = prefs ? Number(prefs.grayTail) : 0.25;
  return Math.max(0, Math.min(0.50, Number.isFinite(fraction) ? fraction : 0.25));
}

function fitGrayTailCutoff(stats, fraction) {
  if (!stats || !Array.isArray(stats.sorted) || !stats.sorted.length) return NaN;
  const tail = Math.max(0, Math.min(0.50, Number(fraction) || 0));
  return quantileSorted(stats.sorted, 1 - tail);
}

function mixRgb(a, b, t) {
  const u = clamp01(t);
  return [0, 1, 2].map(i => Math.round(a[i] * (1 - u) + b[i] * u));
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
  if (sat === 0) {
    const g = Math.round(lig * 255);
    return [g, g, g];
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const hue2rgb = (pp, qq, tt) => {
    let t = tt;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return pp + (qq - pp) * 6 * t;
    if (t < 1 / 2) return qq;
    if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6;
    return pp;
  };
  return [
    Math.round(255 * hue2rgb(p, q, hue + 1 / 3)),
    Math.round(255 * hue2rgb(p, q, hue)),
    Math.round(255 * hue2rgb(p, q, hue - 1 / 3)),
  ];
}

function interpolatePalette(stops, value) {
  const t = clamp01(value);
  if (!Array.isArray(stops) || stops.length === 0) return [128, 128, 128];
  if (t <= stops[0][0]) return stops[0][1].slice();
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const left = stops[i - 1];
      const right = stops[i];
      const span = Math.max(1e-9, right[0] - left[0]);
      return mixRgb(left[1], right[1], (t - left[0]) / span);
    }
  }
  return stops[stops.length - 1][1].slice();
}

function vividBlackBodyRgb(quality) {
  // Temperature-ordered rather than radiometrically exact. It keeps the
  // recognizable red -> orange -> yellow -> white -> blue-white sequence,
  // then deliberately increases chroma for visualization.
  return interpolatePalette([
    [0.00, [150, 12, 24]],
    [0.13, [215, 24, 18]],
    [0.30, [255, 78, 8]],
    [0.47, [255, 166, 18]],
    [0.61, [255, 232, 92]],
    [0.73, [255, 252, 220]],
    [0.84, [205, 232, 255]],
    [0.93, [135, 193, 255]],
    [1.00, [82, 135, 255]],
  ], quality);
}

function paletteRgb(name, quality) {
  if (name === 'blackbody') return vividBlackBodyRgb(quality);
  if (name === 'turbo') {
    return interpolatePalette([
      [0.00, [180, 18, 20]],
      [0.17, [245, 70, 12]],
      [0.34, [255, 202, 24]],
      [0.50, [86, 220, 72]],
      [0.67, [20, 205, 220]],
      [0.84, [40, 105, 245]],
      [1.00, [113, 45, 220]],
    ], quality);
  }
  if (name === 'viridis') {
    return interpolatePalette([
      [0.00, [68, 1, 84]],
      [0.25, [59, 82, 139]],
      [0.50, [33, 145, 140]],
      [0.75, [94, 201, 98]],
      [1.00, [253, 231, 37]],
    ], quality);
  }
  if (name === 'magma') {
    return interpolatePalette([
      [0.00, [18, 10, 38]],
      [0.24, [78, 18, 123]],
      [0.48, [171, 45, 113]],
      [0.72, [241, 96, 76]],
      [0.88, [253, 174, 107]],
      [1.00, [252, 253, 191]],
    ], quality);
  }
  // Established classic: best blue, middle green, worse red.
  const hue = 240 * quality;
  return hslToRgb(hue, 1.0, 0.50);
}

function grayTailRgb(baseRgb, tailProgress) {
  const t = smoothstep01(tailProgress);
  const neutral = [118, 121, 126];
  let rgb = mixRgb(baseRgb, neutral, 0.88 * t);
  const dim = 1 - 0.45 * t;
  rgb = rgb.map(v => Math.round(v * dim));
  return rgb;
}

const FIT_PALETTE_NAMES = new Set(['classic', 'blackbody', 'turbo', 'viridis', 'magma']);

function fitToColor(fit, minFit, maxFit, alpha, worstCutoff, stats) {
  alpha = (alpha == null) ? 1.0 : alpha;
  const v = chartNumber(fit);
  const mn = chartNumber(minFit);
  const mx = chartNumber(maxFit);
  if (!Number.isFinite(v) || !Number.isFinite(mn) || !Number.isFinite(mx) || mn >= mx) {
    return 'rgba(112,116,123,' + alpha + ')';
  }

  const prefs = (typeof window.getFitColorPreferences === 'function')
    ? window.getFitColorPreferences() : { palette: 'classic', grayTail: 0.25 };
  const palette = FIT_PALETTE_NAMES.has(prefs.palette) ? prefs.palette : 'classic';
  const tailFraction = Math.max(0, Math.min(0.50, Number(prefs.grayTail) || 0));
  const localStats = stats || {
    sorted: [mn, mx],
    min: mn,
    max: mx,
    q05: mn,
    q50: (mn + mx) / 2,
    q95: mx,
  };
  const badness = fitDistributionBadness(v, localStats);
  const tailStart = Math.max(0.001, 1 - tailFraction);
  const coloredBadness = clamp01(badness / tailStart);
  const quality = 1 - coloredBadness;
  const tailProgress = tailFraction > 0
    ? clamp01((badness - tailStart) / tailFraction)
    : 0;

  let rgb = paletteRgb(palette, quality);

  if (palette === 'blackbody') {
    // Mild quality-dependent luminance keeps cool/high-temperature points
    // visually dominant without washing the entire scale toward white.
    const luminance = 0.76 + 0.24 * Math.pow(quality, 0.55);
    rgb = rgb.map(channel => Math.round(
      Math.max(0, Math.min(255, channel * luminance))
    ));
  } else if (palette === 'classic') {
    // Add a small bend so middle-quality points do not all collapse to blue.
    const hue = 240 * Math.pow(quality, 0.88)
      - 10 * Math.sin(2 * Math.PI * coloredBadness);
    rgb = hslToRgb(hue, 1.0, 0.49);
  }

  if (tailProgress > 0) rgb = grayTailRgb(rgb, tailProgress);
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
}

window.fitToColor = fitToColor;
window.buildFitColorStats = buildFitColorStats;
window.fitGrayTailCutoff = fitGrayTailCutoff;


// Population embedding, fitness distribution and rank grid. Uses the canvas helpers above.

const emb2dCanvas = document.getElementById('emb2dCanvas');
const emb2dCtx = emb2dCanvas ? emb2dCanvas.getContext('2d') : null;

function drawScatterAxes(ctx, x_offset, y_offset, width, height, min_fit, max_fit, theme = canvasThemeColors()) {
  ctx.save();
  ctx.strokeStyle = theme.border;
  ctx.fillStyle = theme.foreground;
  ctx.lineWidth = 1;
  ctx.font = '10px Arial';

  ctx.beginPath();
  ctx.moveTo(x_offset, y_offset + height);
  ctx.lineTo(x_offset + width, y_offset + height);
  ctx.moveTo(x_offset, y_offset);
  ctx.lineTo(x_offset, y_offset + height);
  ctx.stroke();

  const num_y_ticks = 5;
  for (let i = 0; i <= num_y_ticks; i++) {
    const y = y_offset + height - i * (height / num_y_ticks);
    ctx.beginPath();
    ctx.strokeStyle = theme.grid;
    ctx.moveTo(x_offset, y);
    ctx.lineTo(x_offset + width, y);
    ctx.stroke();

    const fit_value = min_fit + (max_fit - min_fit) * (i / num_y_ticks);
    ctx.fillText(fit_value.toFixed(2), x_offset - 32, y + 3);
  }

  ctx.restore();
}
function drawColorLegend(ctx, x, y, width, height, minFit, maxFit, worstCutoff, fitColorStats, theme = canvasThemeColors()) {
  if (!Number.isFinite(minFit) || !Number.isFinite(maxFit) || minFit >= maxFit) return;

  let wc = (worstCutoff == null) ? maxFit : Number(worstCutoff);
  if (!Number.isFinite(wc) || wc <= minFit) {
    wc = maxFit;
  }

  ctx.save();
  const tailRatio = fitGrayTailFraction();
  let tailWidth = Math.round(width * tailRatio);
  if (tailRatio <= 0) tailWidth = 0;
  else if (tailWidth < 1) tailWidth = 1;

  let mainWidth = width - tailWidth;
  if (mainWidth < 1) {
    mainWidth = width;
    tailWidth = 0;
  }
  for (let i = 0; i < mainWidth; i++) {
    const t = mainWidth > 1 ? i / (mainWidth - 1) : 0;
    const fit = minFit + t * (wc - minFit); // [minFit, wc]
    ctx.fillStyle = fitToColor(fit, minFit, maxFit, 1.0, wc, fitColorStats);
    ctx.fillRect(x + i, y, 1, height);
  }
  if (tailWidth > 0) {
    for (let i = 0; i < tailWidth; i++) {
      const t = tailWidth > 1 ? i / (tailWidth - 1) : 0;
      const fit = wc + t * (maxFit - wc); // [wc, maxFit]
      ctx.fillStyle = fitToColor(fit, minFit, maxFit, 1.0, wc, fitColorStats);
      ctx.fillRect(x + mainWidth + i, y, 1, height);
    }
  }
  ctx.fillStyle = theme.foreground;
  ctx.font = '10px Arial';
  const textY = y + height + 10;
  ctx.textAlign = 'left';
  ctx.fillText(minFit.toFixed(2), x, textY);
  ctx.textAlign = 'center';
  ctx.fillText(((minFit + wc) / 2).toFixed(2), x + mainWidth / 2, textY);
  ctx.textAlign = 'center';
  ctx.fillText(wc.toFixed(2), x + mainWidth, textY);
  ctx.textAlign = 'right';
  ctx.fillText(maxFit.toFixed(2), x + width, textY);

  ctx.restore();
}

function drawPopulationGrid(ctx, rect, count, fitList, minFit, maxFit, worstCutoff, fitColorStats, theme = canvasThemeColors()) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return;
  if (!count || count <= 0) return;
  if (rect.w <= 0 || rect.h <= 0) return;

  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  const marginX = 8;
  const labelHeight = 20;
  const innerX = rect.x + marginX;
  const innerY = rect.y + labelHeight;
  const innerW = rect.w - marginX * 2;
  const innerH = rect.h - labelHeight - 8;
  if (innerW <= 0 || innerH <= 0) {
    ctx.restore();
    return;
  }
  const N = count;
  const aspect = innerW / innerH;
  let cols;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    cols = Math.ceil(Math.sqrt(N));
  } else {
    cols = Math.ceil(Math.sqrt(N * aspect));
  }
  if (cols < 1) cols = 1;
  const rows = Math.ceil(N / cols);

  const cellW = innerW / cols;
  const cellH = innerH / rows;
  const radius = Math.max(1.5, Math.min(6, Math.min(cellW, cellH) * 0.18));

  const useFit =
    Array.isArray(fitList) &&
    fitList.length >= N &&
    Number.isFinite(minFit) &&
    Number.isFinite(maxFit) &&
    minFit !== maxFit;
  let fitRank = null;
  if (useFit) {
    const arr = [];
    for (let i = 0; i < N; i++) {
      const v = chartNumber(fitList[i]);
      const val = Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
      arr.push({ index: i, value: val });
    }
    arr.sort((a, b) => a.value - b.value);
    fitRank = new Array(N);
    for (let r = 0; r < arr.length; r++) {
      fitRank[arr[r].index] = r;
    }
  }
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < N; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;

    const cx = innerX + col * cellW + cellW / 2;
    const cy = innerY + row * cellH + cellH / 2 - 4;

    let color = 'rgba(37,99,235,0.9)';
    if (useFit) {
      const f = chartNumber(fitList[i]);
      color = fitToColor(f, minFit, maxFit, 0.95, worstCutoff, fitColorStats);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.foreground;
    const idxLabelY = cy + radius + 2;
    ctx.fillText(fitRank ? String(fitRank[i]) : String(i), cx, idxLabelY);

  }

  ctx.restore();
}
function renderPopulationPanelWithData(emb2dPoints, fitList) {
  if (!emb2dCanvas || !emb2dCtx) return;

  syncCanvasSize(emb2dCanvas, 800, 400);
  const W = emb2dCanvas.width;
  const H = emb2dCanvas.height;
  emb2dCtx.clearRect(0, 0, W, H);

  const hasEmb = Array.isArray(emb2dPoints) && emb2dPoints.length > 0;
  const hasFit = Array.isArray(fitList) && fitList.length > 0;
  const fitColorStats = buildFitColorStats(fitList);
  const theme = canvasThemeColors();
  let minFit = Infinity;
  let maxFit = -Infinity;
  if (hasFit) {
    for (const v of fitList) {
      const f = chartNumber(v);
      if (!Number.isFinite(f)) continue;
      if (f < minFit) minFit = f;
      if (f > maxFit) maxFit = f;
    }
    if (!Number.isFinite(minFit) || !Number.isFinite(maxFit) || minFit === maxFit) {
      minFit = NaN;
      maxFit = NaN;
    }
  }

  let worstCutoff = maxFit;
  if (hasFit && Number.isFinite(minFit) && Number.isFinite(maxFit)) {
    const sorted = fitColorStats.sorted;

    if (sorted.length > 0) {
      const tailFraction = fitGrayTailFraction();
      worstCutoff = tailFraction > 0
        ? quantileSorted(sorted, 1 - tailFraction)
        : maxFit;

      if (!Number.isFinite(worstCutoff) || worstCutoff <= minFit) {
        worstCutoff = maxFit;
      }
    }
  }
  const outerPadding = 16;
  const interColGap = 32;

  const contentW = W - outerPadding * 2;
  const contentH = H - outerPadding * 2;
  if (contentW <= 0 || contentH <= 0) return;

  const totalGap = interColGap * 2;
  const usableW = contentW - totalGap;
  if (usableW <= 0) return;

  const totalWeight = 4 + 3 + 3;
  const col1W = usableW * (4 / totalWeight); // 2D-Embedding
  const col2W = usableW * (3 / totalWeight); // fit
  const col3W = usableW * (3 / totalWeight);
  const colH = contentH;

  const col1X = outerPadding;
  const col2X = col1X + col1W + interColGap;
  const col3X = col2X + col2W + interColGap;
  const colY = outerPadding;
  const emb2dSide = Math.min(col1W, colH - 4);
  const emb2dRect = {
    x: col1X + (col1W - emb2dSide) / 2,
    y: colY,
    w: emb2dSide,
    h: emb2dSide
  };
  const scatterColRect = {
    x: col2X,
    y: colY,
    w: col2W,
    h: colH
  };
  const scatterTopPadding = 8;
  const scatterBottomPadding = 30;
  const scatterLeftMargin = 40;
  const scatterRightMargin = 8;

  const scatterPlotRect = {
    x: scatterColRect.x + scatterLeftMargin,
    y: scatterColRect.y + scatterTopPadding,
    w: Math.max(10, scatterColRect.w - scatterLeftMargin - scatterRightMargin),
    h: Math.max(10, scatterColRect.h - scatterTopPadding - scatterBottomPadding)
  };
  const gridRect = {
    x: col3X,
    y: colY,
    w: col3W,
    h: colH
  };
  if (hasEmb) {
    const xsP = [];
    const ysP = [];
    for (const p of emb2dPoints) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = chartNumber(p[0]);
      const y = chartNumber(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xsP.push(x);
      ysP.push(y);
    }
    if (xsP.length > 0) {
      let minX = Math.min(...xsP);
      let maxX = Math.max(...xsP);
      let minY = Math.min(...ysP);
      let maxY = Math.max(...ysP);
      if (minX === maxX) { minX -= 1; maxX += 1; }
      if (minY === maxY) { minY -= 1; maxY += 1; }

      const sx = emb2dRect.w / (maxX - minX || 1);
      const sy = emb2dRect.h / (maxY - minY || 1);
      const X = (x) => emb2dRect.x + (x - minX) * sx;
      const Y = (y) => emb2dRect.y + emb2dRect.h - (y - minY) * sy;

      emb2dCtx.save();
      emb2dCtx.strokeStyle = theme.border;
      emb2dCtx.lineWidth = 1;
      emb2dCtx.strokeRect(emb2dRect.x, emb2dRect.y, emb2dRect.w, emb2dRect.h);

      const useFit =
        hasFit &&
        fitList.length === xsP.length &&
        Number.isFinite(minFit) &&
        Number.isFinite(maxFit);

      if (useFit) {
        emb2dCtx.globalAlpha = 0.9;
      }

      for (let i = 0; i < xsP.length; i++) {
        let fillStyle = 'rgba(56,189,248,0.9)';
        if (useFit) {
          const f = chartNumber(fitList[i]);
          fillStyle = fitToColor(f, minFit, maxFit, 0.9, worstCutoff, fitColorStats);
        }
        emb2dCtx.fillStyle = fillStyle;
        emb2dCtx.beginPath();
        emb2dCtx.arc(X(xsP[i]), Y(ysP[i]), 3.5, 0, Math.PI * 2);
        emb2dCtx.fill();
      }

      emb2dCtx.globalAlpha = 1.0;
      emb2dCtx.restore();
    }
  }
  if (
    hasFit &&
    Number.isFinite(minFit) &&
    Number.isFinite(maxFit) &&
    minFit !== maxFit
  ) {
    emb2dCtx.save();

    const yMaxForAxis = Number.isFinite(worstCutoff) ? worstCutoff : maxFit;
    drawScatterAxes(
      emb2dCtx,
      scatterPlotRect.x,
      scatterPlotRect.y,
      scatterPlotRect.w,
      scatterPlotRect.h,
      minFit,
      yMaxForAxis,
      theme
    );

    const n = fitList.length;
    const cols = n;
    const dx = scatterPlotRect.w / (cols + 1);

    const indices = fitList
      .map((_, i) => i)
      .sort((a, b) => chartNumber(fitList[a]) - chartNumber(fitList[b]));

    indices.forEach((idx, pos) => {
      const col = pos % cols;
      const x = scatterPlotRect.x + dx * (col + 1);
      const fit = chartNumber(fitList[idx]);
      if (!Number.isFinite(fit)) return;

      const fitClamped = Math.min(fit, yMaxForAxis);
      const t = (fitClamped - minFit) / (yMaxForAxis - minFit || 1);
      const y = scatterPlotRect.y + scatterPlotRect.h - t * scatterPlotRect.h;

      emb2dCtx.fillStyle = fitToColor(fit, minFit, maxFit, 1.0, worstCutoff, fitColorStats);
      emb2dCtx.beginPath();
      emb2dCtx.arc(x, y, 3, 0, Math.PI * 2);
      emb2dCtx.fill();
    });

    const legendW = Math.min(scatterColRect.w * 0.9, 220);
    const legendX = scatterColRect.x + (scatterColRect.w - legendW) / 2;
    const legendY = scatterPlotRect.y + scatterPlotRect.h + 6;

    drawColorLegend(
      emb2dCtx,
      legendX,
      legendY,
      legendW,
      10,
      minFit,
      maxFit,
      worstCutoff,
      fitColorStats,
      theme
    );

    emb2dCtx.restore();
  }
  const populationCount = (() => {
    let n = 0;
    if (Array.isArray(emb2dPoints)) n = emb2dPoints.length;
    if (Array.isArray(fitList)) n = Math.max(n, fitList.length);
    return n;
  })();

  if (populationCount > 0) {
    drawPopulationGrid(
      emb2dCtx,
      gridRect,
      populationCount,
      fitList,
      minFit,
      maxFit,
      worstCutoff,
      fitColorStats,
      theme
    );
  }
}

function clearPopulationCanvas() {
  if (emb2dCtx && emb2dCanvas) emb2dCtx.clearRect(0, 0, emb2dCanvas.width, emb2dCanvas.height);
}

window.renderPopulationPanelWithData = renderPopulationPanelWithData;
window.clearPopulationCanvas = clearPopulationCanvas;

