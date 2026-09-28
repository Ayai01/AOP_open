// static/state.js

// Connection, run status and control elements.
window.connBadge   = document.getElementById('connBadge');
window.runBadge    = document.getElementById('runBadge');
window.startBtn    = document.getElementById('startBtn');
window.stopBtn     = document.getElementById('stopBtn');
window.shutdownBtn = document.getElementById('shutdownBtn');

// Status badges and start button.
let currentStatus = 'idle';   // idle | starting | running | paused | stopping | finished | error
window.currentStatus = currentStatus;

function stateText(zh, en) {
  const translator = window.uiText;
  return typeof translator === 'function' ? translator(zh, en) : zh;
}

function setConn(state) {
  const badge = window.connBadge;
  if (!badge) return;
  if (state === 'on') {
    badge.textContent = stateText('已连接', 'Connected');
    badge.className = 'badge badge-on';
  } else {
    badge.textContent = stateText('未连接', 'Disconnected');
    badge.className = 'badge badge-off';
  }
}

function updateStartButton() {
  const btn = window.startBtn;
  if (!btn) return;
  btn.classList.remove('btn-start', 'btn-pause');
  if (currentStatus === 'running') {
    btn.textContent = stateText('暂停优化', 'Pause Optimization');
    btn.classList.add('btn', 'btn-pause');
  } else {
    btn.textContent = stateText('开始/继续优化', 'Start / Resume');
    btn.classList.add('btn', 'btn-start');
  }
}

function setRun(status) {
  currentStatus = status;
  window.currentStatus = status;

  const badge = window.runBadge;
  if (!badge) return;

  const map = {
    idle:      [stateText('空闲', 'Idle'), 'badge-idle'],
    starting:  [stateText('启动中', 'Starting'), 'badge-starting'],
    running:   [stateText('运行中', 'Running'), 'badge-running'],
    paused:    [stateText('已暂停', 'Paused'), 'badge-paused'],
    stopping:  [stateText('停止中', 'Stopping'), 'badge-stopping'],
    finished:  [stateText('已完成', 'Finished'), 'badge-finished'],
    error:     [stateText('错误', 'Error'), 'badge-error'],
  };
  const item = map[status] || map.idle;
  badge.textContent = item[0];
  badge.className = 'badge ' + item[1];

  updateStartButton();
}

window.setConn = setConn;
window.setRun = setRun;
window.updateStartButton = updateStartButton;

document.addEventListener('aop:languagechange', () => {
  const connected = window.connBadge && window.connBadge.classList.contains('badge-on');
  setConn(connected ? 'on' : 'off');
  setRun(currentStatus);
});

