// Population snapshot, dimensionality request queue and selector. Uses charts.js to render.

(function initPopulationEmbedding() {
  window.lastEmbPoints = null;
  window.lastFitListForEmb = null;
  window.lastPopulationPoints = null;
  window.lastServerEmbPoints = null;
  window.lastPopulationGeneration = null;
  window.latestFitListForEmbedding = null;

  function renderPopulationPanel(emb2dPoints, fitList) {
    if (typeof window.renderPopulationPanelWithData === 'function') {
      window.renderPopulationPanelWithData(emb2dPoints, fitList);
    }
  }
  window.renderPopulationPanel = renderPopulationPanel;

  function selectedDimReductionMethod() {
    const select = document.getElementById('dimReductionSelect');
    return select ? select.value : 'pca';
  }

  function setDimReductionStatus(zh, en) {
    const element = document.getElementById('dimReductionStatus');
    if (!element) return;
    element.textContent = window.uiText ? window.uiText(zh, en) : zh;
  }

  let embeddingRequestSerial = 0;
  let activeEmbeddingJob = null;
  let pendingEmbeddingJob = null;
  const embeddingCache = new Map();
  let embeddingStatus = {
    kind: 'idle',
    method: 'pca',
    generation: null,
    error: '',
  };

  function dimReductionLabel(method) {
    if (method === 'tsne') return 't-SNE';
    return String(method || 'pca').toUpperCase();
  }

  function renderEmbeddingStatus() {
    const method = embeddingStatus.method || selectedDimReductionMethod();
    const label = dimReductionLabel(method);
    const generation = embeddingStatus.generation;
    if (embeddingStatus.kind === 'computing') {
      setDimReductionStatus(
        label + ' · 正在计算第 ' + generation + ' 代…',
        label + ' · computing generation ' + generation + '…'
      );
    } else if (embeddingStatus.kind === 'ready') {
      setDimReductionStatus(
        label + ' · 第 ' + generation + ' 代',
        label + ' · generation ' + generation
      );
    } else if (embeddingStatus.kind === 'unavailable') {
      setDimReductionStatus(
        '当前算法未提供高维种群数据',
        'The current algorithm does not provide high-dimensional population data'
      );
    } else if (embeddingStatus.kind === 'error') {
      setDimReductionStatus(
        label + ' · 降维失败：' + embeddingStatus.error,
        label + ' · dimensionality reduction failed: ' + embeddingStatus.error
      );
    } else {
      setDimReductionStatus(
        label + ' · 等待种群',
        label + ' · waiting for population'
      );
    }
  }

  function setEmbeddingStatus(kind, method, generation, error) {
    embeddingStatus = {
      kind,
      method: method || selectedDimReductionMethod(),
      generation: generation == null ? null : generation,
      error: error || '',
    };
    renderEmbeddingStatus();
  }

  function renderCachedEmbedding(method, generation) {
    const cached = embeddingCache.get(method);
    if (!cached || cached.generation !== generation) return false;
    window.lastEmbPoints = cached.points;
    window.lastFitListForEmb = cached.fitList;
    renderPopulationPanel(cached.points, cached.fitList);
    setEmbeddingStatus('ready', method, generation);
    return true;
  }

  function scheduleCurrentEmbedding(method) {
    const selected = method || selectedDimReductionMethod();
    const generation = window.lastPopulationGeneration;

    // The selector is the source of truth. Update status ownership immediately,
    // before checking whether population data is available.
    embeddingStatus.method = selected;
    embeddingStatus.generation = generation;
    embeddingStatus.error = '';

    if (selected === 'pca') {
      pendingEmbeddingJob = null;
      embeddingRequestSerial += 1;
      if (Array.isArray(window.lastServerEmbPoints)) {
        window.lastEmbPoints = window.lastServerEmbPoints;
        window.lastFitListForEmb = window.latestFitListForEmbedding;
        embeddingCache.set('pca', {
          generation,
          points: window.lastServerEmbPoints,
          fitList: window.latestFitListForEmbedding,
        });
        renderPopulationPanel(
          window.lastServerEmbPoints,
          window.latestFitListForEmbedding
        );
        setEmbeddingStatus('ready', 'pca', generation);
      } else {
        setEmbeddingStatus('idle', 'pca', generation);
      }
      return;
    }

    if (!Array.isArray(window.lastPopulationPoints) || window.lastPopulationPoints.length < 2) {
      pendingEmbeddingJob = null;
      setEmbeddingStatus('unavailable', selected, generation);
      return;
    }

    pendingEmbeddingJob = null;
    if (renderCachedEmbedding(selected, generation)) return;

    if (activeEmbeddingJob && activeEmbeddingJob.serial === embeddingRequestSerial
        && activeEmbeddingJob.method === selected && activeEmbeddingJob.generation === generation
        && activeEmbeddingJob.points === window.lastPopulationPoints) {
      setEmbeddingStatus('computing', selected, generation);
      return;
    }

    pendingEmbeddingJob = {
      method: selected,
      generation,
      points: window.lastPopulationPoints,
      fitList: window.latestFitListForEmbedding,
    };
    setEmbeddingStatus('computing', selected, generation);
    if (!activeEmbeddingJob) runNextEmbeddingJob();
  }

  async function runNextEmbeddingJob() {
    if (activeEmbeddingJob || !pendingEmbeddingJob) return;
    const job = pendingEmbeddingJob;
    pendingEmbeddingJob = null;
    const serial = ++embeddingRequestSerial;
    job.serial = serial;
    activeEmbeddingJob = job;

    try {
      const response = await fetch('/dim_reduce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: job.method,
          points: job.points,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || 'dimensionality reduction failed');
      }
      if (!Array.isArray(payload.points)) {
        throw new Error('invalid embedding response');
      }

      // A reset/PCA switch invalidates the old request. Never let a response
      // from the previous run repopulate the cache after visualization reset.
      if (serial !== embeddingRequestSerial) return;

      embeddingCache.set(job.method, {
        generation: job.generation,
        points: payload.points,
        fitList: job.fitList,
      });

      const stillCurrent = (
        selectedDimReductionMethod() === job.method
        && window.lastPopulationGeneration === job.generation
        && serial === embeddingRequestSerial
      );
      if (stillCurrent) {
        window.lastEmbPoints = payload.points;
        window.lastFitListForEmb = job.fitList;
        renderPopulationPanel(payload.points, job.fitList);
        setEmbeddingStatus('ready', job.method, job.generation);
      }
    } catch (error) {
      console.error('dim reduce error', error);
      if (
        selectedDimReductionMethod() === job.method
        && window.lastPopulationGeneration === job.generation
        && serial === embeddingRequestSerial
      ) {
        setEmbeddingStatus(
          'error',
          job.method,
          job.generation,
          error.message || ''
        );
      }
    } finally {
      activeEmbeddingJob = null;
      if (pendingEmbeddingJob) {
        runNextEmbeddingJob();
      }
    }
  }

  window.recomputeCurrentEmbedding = scheduleCurrentEmbedding;

  function resetPopulationEmbedding() {
    window.lastEmbPoints = null;
    window.lastFitListForEmb = null;
    window.lastPopulationPoints = null;
    window.lastServerEmbPoints = null;
    window.lastPopulationGeneration = null;
    window.latestFitListForEmbedding = null;
    embeddingCache.clear();
    pendingEmbeddingJob = null;
    embeddingRequestSerial += 1;
    embeddingStatus = {
      kind: 'idle',
      method: selectedDimReductionMethod(),
      generation: null,
      error: '',
    };
    renderEmbeddingStatus();
  }
  window.resetPopulationEmbedding = resetPopulationEmbedding;

  function updatePopulationEmbedding(data) {
    const generation = data.gen;
    const emb2dPoints = data.emb2d_points || null;
    const fitList = Array.isArray(data.fit_list) ? data.fit_list : null;
    const populationPoints = Array.isArray(data.pop_points) ? data.pop_points : null;
    window.lastServerEmbPoints = emb2dPoints;
    window.lastPopulationPoints = populationPoints;
    window.lastPopulationGeneration = generation;
    window.latestFitListForEmbedding = fitList;

    if (Array.isArray(emb2dPoints)) {
      embeddingCache.set('pca', {
        generation,
        points: emb2dPoints,
        fitList,
      });
    }
    scheduleCurrentEmbedding(selectedDimReductionMethod());
  }
  window.updatePopulationEmbedding = updatePopulationEmbedding;

  let dimReductionControl = null;
  let dimReductionControlHandler = null;

  function applyDimReductionSelection(method, persist = true) {
    const selected = ['pca', 'umap', 'tsne', 'mds'].includes(method)
      ? method
      : 'pca';

    if (dimReductionControl && dimReductionControl.value !== selected) {
      dimReductionControl.value = selected;
    }
    if (persist) {
      try {
        localStorage.setItem('aop.ui.dimReduction', selected);
      } catch (error) {}
    }

    // Visible feedback happens synchronously, even before a network request.
    embeddingStatus.method = selected;
    embeddingStatus.generation = window.lastPopulationGeneration;
    embeddingStatus.error = '';
    if (window.lastPopulationGeneration == null) {
      embeddingStatus.kind = 'idle';
      renderEmbeddingStatus();
    }

    scheduleCurrentEmbedding(selected);
  }
  window.applyDimReductionSelection = applyDimReductionSelection;

  function bindDimensionalityControls() {
    const select = document.getElementById('dimReductionSelect');
    if (!select) return false;
    if (select === dimReductionControl) return true;

    if (dimReductionControl && dimReductionControlHandler) {
      dimReductionControl.removeEventListener('input', dimReductionControlHandler);
      dimReductionControl.removeEventListener('change', dimReductionControlHandler);
    }

    dimReductionControl = select;
    dimReductionControlHandler = () => {
      if (select.value !== embeddingStatus.method) applyDimReductionSelection(select.value, true);
    };
    select.addEventListener('input', dimReductionControlHandler);
    select.addEventListener('change', dimReductionControlHandler);

    let saved = select.value || 'pca';
    try {
      const stored = localStorage.getItem('aop.ui.dimReduction');
      if (['pca', 'umap', 'tsne', 'mds'].includes(stored)) saved = stored;
    } catch (error) {}

    applyDimReductionSelection(saved, false);
    return true;
  }
  window.bindDimensionalityControls = bindDimensionalityControls;

  bindDimensionalityControls();

  document.addEventListener('DOMContentLoaded', () => {
    bindDimensionalityControls();
  });

  document.addEventListener('aop:languagechange', () => {
    // Language refresh must not reset the selected reduction method.
    if (!dimReductionControl || !document.body.contains(dimReductionControl)) {
      bindDimensionalityControls();
    } else {
      renderEmbeddingStatus();
    }
  });

})();


// Progress logs, snapshot restoration and final artifact exports.
// History state belongs to history.js; population state is above.

const progressText = document.getElementById('progressText');
const popInfoText = document.getElementById('popInfoText');
const finalResultText = document.getElementById('finalResultText');
const finalResultTextHome = document.getElementById('finalResultTextHome');
const exportCktBtn = document.getElementById('exportCktBtn');
const exportSkillBtn = document.getElementById('exportSkillBtn');

let lastBestNetlist = null;
let lastBestSkillScript = null;

let logLines = [];

function resetVisualization() {
  logLines = [];
  if (window.resetPopulationEmbedding) window.resetPopulationEmbedding();
  window.optStartTime = null;
  if (typeof window.resetHistoryChartsData === 'function') {
    window.resetHistoryChartsData(false);
  }
  lastBestNetlist = null;
  lastBestSkillScript = null;

  [progressText, popInfoText, finalResultText, finalResultTextHome].forEach(element => {
    if (element) element.textContent = '';
  });
  if (window.clearPopulationCanvas) window.clearPopulationCanvas();
  if (window.clearHistoryCanvases) window.clearHistoryCanvases();
}
window.resetVisualization = resetVisualization;

function appendLogLines(lines) {
  if (!progressText || !Array.isArray(lines)) return;
  lines.forEach(line => {
    if (typeof line === 'string') logLines.push(line);
  });
  const maxLines = 400;
  if (logLines.length > maxLines) {
    logLines = logLines.slice(-maxLines);
  }
  progressText.textContent = logLines.join('\n');
  progressText.scrollTop = progressText.scrollHeight;
}

function setPopInfo(lines) {
  if (!popInfoText) return;
  if (Array.isArray(lines)) {
    popInfoText.textContent = lines.join('\n');
  } else if (typeof lines === 'string') {
    popInfoText.textContent = lines;
  } else {
    popInfoText.textContent = '';
  }
}
window.setPopInfo = setPopInfo;

function onProgress(data) {
  const generation = data.gen;
  const bestFitness = data.best;
  const extraLogLines = data.log_lines || null;

  let elapsed = typeof data.elapsed === 'number' ? data.elapsed : null;
  if ((elapsed == null || !Number.isFinite(elapsed)) && window.optStartTime != null) {
    elapsed = (Date.now() - window.optStartTime) / 1000;
  }

  const bestText = Number.isFinite(bestFitness) ? bestFitness.toFixed(6) : 'N/A';
  const summaryPieces = [`gen=${generation}`, `best=${bestText}`];
  if (elapsed != null && Number.isFinite(elapsed)) {
    summaryPieces.push(`elapsed=${elapsed.toFixed(1)}s`);
  }

  const lines = ['', summaryPieces.join(' ')];
  if (Array.isArray(extraLogLines)) {
    extraLogLines.forEach(line => lines.push(line));
  }
  appendLogLines(lines);

  if (window.updatePopulationEmbedding) window.updatePopulationEmbedding(data);

  if (typeof window.pushHistoryPointFromProgress === 'function') {
    window.pushHistoryPointFromProgress(data);
  }
  if (data.pop_info) setPopInfo(data.pop_info);
}
window.onProgress = onProgress;

function restoreVisualizationState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;

  const schema = snapshot.schema;
  if (schema && Array.isArray(schema.history_charts) && window.initHistoryCharts) {
    window.initHistoryCharts(schema);
  }

  if (typeof window.restoreHistoryFromProgress === 'function') {
    window.restoreHistoryFromProgress(snapshot.history, !snapshot.latest_progress);
  }

  if (snapshot.latest_progress) onProgress(snapshot.latest_progress);
  if (snapshot.done) onDone(snapshot.done);
}
window.restoreVisualizationState = restoreVisualizationState;

function onDone(payload) {
  const bestDetail = payload && payload.best_detail;
  lastBestNetlist = bestDetail && typeof bestDetail.netlist === 'string'
    ? bestDetail.netlist
    : null;
  lastBestSkillScript = bestDetail && typeof bestDetail.skill_script === 'string'
    ? bestDetail.skill_script
    : null;

  let text;
  if (typeof payload.final_result_text === 'string') {
    text = payload.final_result_text;
  } else if (bestDetail && typeof bestDetail.final_text === 'string') {
    text = bestDetail.final_text;
  } else {
    text = JSON.stringify(payload, null, 2);
  }

  if (finalResultText) finalResultText.textContent = text;
  if (finalResultTextHome) finalResultTextHome.textContent = text;
  if (typeof window.setRun === 'function') {
    window.setRun(payload.error ? 'error' : 'finished');
  }
}
window.onDone = onDone;

function buildTimestamp(now = new Date()) {
  return now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
}

function currentCircuitName() {
  const input = document.getElementById('cktName');
  if (!input || typeof input.value !== 'string' || input.value.trim() === '') return 'ckt';
  return input.value.trim();
}

function exportBestArtifact(content, extension, missingMessage) {
  if (typeof content !== 'string' || !content.length) {
    alert(missingMessage);
    return;
  }
  const filename = `${currentCircuitName()}_best_${buildTimestamp()}.${extension}`;
  downloadTextFile(content, filename, 'text/plain;charset=utf-8');
}

if (exportCktBtn) {
  exportCktBtn.addEventListener('click', () => {
    exportBestArtifact(lastBestNetlist, 'sp', window.uiText ? window.uiText('当前没有可导出的网表，请先完成一次优化。', 'No netlist is available. Complete an optimization first.') : '当前没有可导出的网表，请先完成一次优化。');
  });
}

if (exportSkillBtn) {
  exportSkillBtn.addEventListener('click', () => {
    exportBestArtifact(lastBestSkillScript, 'il', window.uiText ? window.uiText('当前没有可导出的 SKILL 脚本，请先完成一次优化。', 'No SKILL script is available. Complete an optimization first.') : '当前没有可导出的 SKILL 脚本，请先完成一次优化。');
  });
}

