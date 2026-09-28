// static/runtime.js

// Optimization and server controls.
const startBtn = window.startBtn;
const stopBtn = window.stopBtn;
const shutdownBtn = window.shutdownBtn;

function setRunStatus(status) {
  if (window.setRun) window.setRun(status);
}

async function readJsonFailure(response, fallbackMessage) {
  try {
    const failure = await response.json();
    return failure.message || failure.error || fallbackMessage;
  } catch (error) {
    return fallbackMessage;
  }
}

if (startBtn) {
  startBtn.addEventListener('click', async () => {
    try {
      if (window.currentStatus === 'running') {
        setRunStatus('stopping');
        await fetch('/pause_opt', { method: 'POST' });
        setRunStatus('paused');
        return;
      }
      if (window.currentStatus === 'paused') {
        setRunStatus('starting');
        await fetch('/resume_opt', { method: 'POST' });
        setRunStatus('running');
        return;
      }

      let config = window.collectConfig ? window.collectConfig() : {};
      if (window.prepareConfigForRun) {
        config = window.prepareConfigForRun(config);
      }
      if (window.resetVisualization) window.resetVisualization();
      window.optStartTime = Date.now();
      setRunStatus('starting');

      const response = await fetch('/start_opt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        throw new Error(await readJsonFailure(response, window.uiText ? window.uiText('启动失败', 'Failed to start optimization') : '启动失败'));
      }
      setRunStatus('running');
    } catch (error) {
      console.error('start error', error);
      window.alert(error.message || (window.uiText ? window.uiText('启动失败', 'Failed to start optimization') : '启动失败'));
      setRunStatus('error');
    }
  });
}

if (stopBtn) {
  stopBtn.addEventListener('click', async () => {
    setRunStatus('stopping');
    try {
      await fetch('/stop_opt', { method: 'POST' });
    } catch (error) {
      // State polling reconciles transient connection failures.
    }
  });
}

if (shutdownBtn) {
  shutdownBtn.addEventListener('click', async () => {
    setRunStatus('stopping');
    try {
      await fetch('/shutdown', { method: 'POST' });
    } catch (error) {
      // Shutdown normally closes the connection.
    }
  });
}

// Live progress and final results.
(function initSse() {
  try {
    const eventSource = new EventSource('/stream');
    eventSource.addEventListener('open', () => window.setConn && window.setConn('on'));
    eventSource.addEventListener('error', () => window.setConn && window.setConn('off'));
    eventSource.addEventListener('ping', () => {});

    eventSource.addEventListener('visual_restore', event => {
      try {
        const data = JSON.parse(event.data);
        if (window.restoreVisualizationState) window.restoreVisualizationState(data);
      } catch (error) {
        console.error('visual_restore event error', error, event.data);
      }
    });

    eventSource.addEventListener('viz_schema', event => {
      try {
        const data = JSON.parse(event.data);
        if (window.resetVisualization) window.resetVisualization();
        if (data && data.schema && window.initHistoryCharts) {
          window.initHistoryCharts(data.schema);
        }
      } catch (error) {
        console.error('viz_schema event error', error, event.data);
      }
    });

    eventSource.addEventListener('progress', event => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.gen === 'number' && (typeof data.best === 'number' || data.best === null)) {
          if (window.onProgress) window.onProgress(data);
        }
      } catch (error) {
        console.error('progress event error', error, event.data);
      }
    });

    eventSource.addEventListener('done', event => {
      try {
        const data = JSON.parse(event.data);
        if (window.onDone) window.onDone(data);
      } catch (error) {
        console.error('done event error', error, event.data);
        setRunStatus('error');
      }
    });
  } catch (error) {
    console.error('SSE init error', error);
    if (window.setConn) window.setConn('off');
  }
})();

// Server configuration and status synchronization.
function applyServerResourceInfo(serverInfo) {
  if (!serverInfo || typeof serverInfo !== 'object') return;
  const input = document.getElementById('cpuWorkers');
  const hint = document.getElementById('cpuWorkersHint');
  const defaultWorkers = Number(serverInfo.default_workers);
  const maxWorkers = Number(serverInfo.max_workers);
  const cpuCount = Number(serverInfo.cpu_count);

  if (input) {
    input.min = '1';
    if (Number.isInteger(maxWorkers) && maxWorkers >= 1) {
      input.max = String(maxWorkers);
    }
    if (!input.dataset.serverInitialized) {
      if (Number.isInteger(defaultWorkers) && defaultWorkers >= 1) {
        input.value = String(defaultWorkers);
      }
      input.dataset.serverInitialized = '1';
    }
  }

  if (hint) {
    if (
      Number.isInteger(defaultWorkers)
      && Number.isInteger(maxWorkers)
      && Number.isInteger(cpuCount)
    ) {
      hint.textContent = window.uiText
        ? window.uiText(
            `服务器默认 ${defaultWorkers}，逻辑 CPU ${cpuCount}，最多 ${maxWorkers}`,
            `Server default ${defaultWorkers}; logical CPUs ${cpuCount}; max ${maxWorkers}`
          )
        : `服务器默认 ${defaultWorkers}，逻辑 CPU ${cpuCount}，最多 ${maxWorkers}`;
    }
  }

  window.serverResourceInfo = {
    defaultWorkers,
    maxWorkers,
    cpuCount,
  };
}
window.applyServerResourceInfo = applyServerResourceInfo;

async function refreshVisualState() {
  try {
    const response = await fetch('/visual_state');
    if (!response.ok) return;
    const snapshot = await response.json();
    if (window.restoreVisualizationState) window.restoreVisualizationState(snapshot);
  } catch (error) {
    // SSE remains the primary live path; this is recovery for refresh/focus/page switching.
  }
}
window.refreshVisualState = refreshVisualState;

async function refreshServerState(applyConfig = false) {
  try {
    const response = await fetch('/state');
    if (!response.ok) return;
    const data = await response.json();
    if (data.server) {
      applyServerResourceInfo(data.server);
    }
    if (applyConfig && data.config && window.applyConfig) {
      window.applyConfig(data.config);
    }
    if (data.status) {
      setRunStatus(data.status.status || 'idle');
    }
  } catch (error) {
    // A failed synchronization is retried by the next poll.
  }
}

refreshServerState(true);
setInterval(() => refreshServerState(false), 5000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshVisualState();
});

// Coalesce resize redraws within a frame.
let resizeFrame = null;
window.addEventListener('resize', () => {
  if (resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (window.lastEmbPoints && window.lastFitListForEmb && window.renderPopulationPanel) {
      window.renderPopulationPanel(window.lastEmbPoints, window.lastFitListForEmb);
    }
    if (window.redrawHistoryCharts) window.redrawHistoryCharts();
  });
});

document.addEventListener('aop:languagechange', () => {
  if (window.serverResourceInfo) {
    applyServerResourceInfo({
      default_workers: window.serverResourceInfo.defaultWorkers,
      max_workers: window.serverResourceInfo.maxWorkers,
      cpu_count: window.serverResourceInfo.cpuCount,
    });
  }
});

