// static/metrics_area.js

// Simulation metrics and area settings.
window.metricsBox = document.getElementById('metricsBox');
window.areaBody   = document.querySelector('#areaTable tbody');
window.areaUnitSel = document.getElementById('areaUnit');

const metricsBox = window.metricsBox;
const areaBody   = window.areaBody;
const areaUnitSel = window.areaUnitSel;

function addAreaRow(vals = ['','','','','']) {
  if (!areaBody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${vals[0] || ''}"/></td>
    <td><input value="${vals[1] || ''}"/></td>
    <td><input value="${vals[2] || ''}"/></td>
    <td><input value="${vals[3] || ''}"/></td>
    <td><input value="${vals[4] || ''}"/></td>
    <td><button class="link remove">移除</button></td>
  `;
  tr.querySelector('.remove').onclick = () => tr.remove();
  areaBody.appendChild(tr);
}
window.addAreaRow = addAreaRow;

const addAreaRowBtn = document.getElementById('addAreaRow');
if (addAreaRowBtn) {
  addAreaRowBtn.addEventListener('click', () => addAreaRow());
}

const autoFillAreaBtn = document.getElementById('autoFillArea');
if (autoFillAreaBtn) {
  autoFillAreaBtn.addEventListener('click', () => {
    const varTableBody = window.varTableBody;
    if (!varTableBody || !areaBody) return;

    const names = Array.from(varTableBody.querySelectorAll('tr td:first-child input'))
      .map(inp => (inp.value || '').trim())
      .filter(Boolean);
    const groupMap = new Map();
    names.forEach(nm => {
      const m = nm.match(/(\d+)\s*$/);
      const key = m ? m[1] : '';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(nm);
    });
    areaBody.innerHTML = '';
    for (const [, arr] of groupMap) {
      const line = arr.slice(0, 5);
      while (line.length < 5) line.push('1.0');
      addAreaRow(line);
    }
  });
}

// Area display units: square micrometers or square meters.
let currentAreaUnit = 'um2';
window.currentAreaUnit = currentAreaUnit;

if (areaUnitSel) {
  currentAreaUnit = areaUnitSel.value || 'um2';
  window.currentAreaUnit = currentAreaUnit;

  areaUnitSel.addEventListener('change', () => {
    const newUnit = areaUnitSel.value || 'um2';
    if (newUnit === currentAreaUnit) return;

    const worstInput  = document.getElementById('areaWorst');
    const targetInput = document.getElementById('areaTarget');
    if (!worstInput || !targetInput) {
      currentAreaUnit = newUnit;
      window.currentAreaUnit = newUnit;
      return;
    }

    let worstVal  = parseFloat(worstInput.value.trim()  || '0');
    let targetVal = parseFloat(targetInput.value.trim() || '0');
    if (!Number.isFinite(worstVal))  worstVal  = 0;
    if (!Number.isFinite(targetVal)) targetVal = 0;

    if (currentAreaUnit === 'um2' && newUnit === 'm2') {
      if (window.um2_to_m2) {
        worstVal  = window.um2_to_m2(worstVal);
        targetVal = window.um2_to_m2(targetVal);
      }
    } else if (currentAreaUnit === 'm2' && newUnit === 'um2') {
      if (window.m2_to_um2) {
        worstVal  = window.m2_to_um2(worstVal);
        targetVal = window.m2_to_um2(targetVal);
      }
    }

    if (window.formatAreaDisplay) {
      worstInput.value  = window.formatAreaDisplay(worstVal);
      targetInput.value = window.formatAreaDisplay(targetVal);
    } else {
      worstInput.value  = String(worstVal);
      targetInput.value = String(targetVal);
    }

    currentAreaUnit = newUnit;
    window.currentAreaUnit = newUnit;
  });
}

function addMetricBlock(m = {}) {
  if (!metricsBox) return;

  const wrap = document.createElement('div');
  wrap.className = 'metric';

  const name        = m.name || '';
  const transform   = m.transform || 'linear';
  const worst       = m.worst != null ? m.worst : '1';
  const target      = m.target != null ? m.target : '10';
  const enabled     = m.enabled !== false;
  const regexPreset = m.regex_preset || 'normal';
  const supplyName  = m.supply_name || '';
  const regex       = m.regex || '';
  const extract     = m.extract || 'first';
  const pw          = m.pw != null ? m.pw : '0.5';
  const fw          = m.fw != null ? m.fw : '1';

  const transformOpts = ['linear','log','reciprocal','sqrt','square','abs'];
  const presetOpts    = ['normal','power','custom'];
  const extractOpts   = ['first','min','max','avg','0','1','2'];

  wrap.innerHTML = `
    <div class="row wrap">
      <label class="field"><span>名称</span><input class="m-name" placeholder="gain" value="${name}"/></label>
      <label class="field"><span>变换</span>
        <select class="m-trans">
          ${transformOpts.map(v => `<option value="${v}" ${v===transform?'selected':''}>${v}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>worst</span><input class="m-worst" value="${worst}"/></label>
      <label class="field"><span>target</span><input class="m-target" value="${target}"/></label>
      <span class="metric-dir">方向: -</span>
      <label class="field"><span>启用</span><input type="checkbox" class="m-en" ${enabled?'checked':''}/></label>
    </div>
    <div class="row wrap">
      <label class="field"><span>正则预设</span>
        <select class="m-preset">
          ${presetOpts.map(v => `<option value="${v}" ${v===regexPreset?'selected':''}>${v}</option>`).join('')}
        </select>
      </label>
      <label class="field metric-supply"><span>电源名(仅 power)</span><input class="m-supply" placeholder="0:v1" value="${supplyName}"/></label>
      <label class="field metric-regex"><span>正则表达式</span><input class="m-regex" placeholder="" value="${regex}"/></label>
      <label class="field"><span>提取规则</span>
        <select class="m-extract">
          ${extractOpts.map(v => `<option value="${v}" ${v===extract?'selected':''}>${v}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="row wrap">
      <label class="field"><span>pw</span><input class="m-pw" value="${pw}"/></label>
      <label class="field"><span>fw</span><input class="m-fw" value="${fw}"/></label>
      <button class="link remove">移除此指标</button>
    </div>
  `;
  wrap.querySelector('.remove').onclick = () => wrap.remove();

  const worstInput  = wrap.querySelector('.m-worst');
  const targetInput = wrap.querySelector('.m-target');
  const dirSpan     = wrap.querySelector('.metric-dir');

  function updateDir() {
    if (window.metricDirection) {
      const d = window.metricDirection(worstInput.value, targetInput.value);
      dirSpan.textContent = (window.uiText ? window.uiText('方向: ', 'Direction: ') : '方向: ') + d;
    } else {
      dirSpan.textContent = window.uiText ? window.uiText('方向: -', 'Direction: -') : '方向: -';
    }
  }
  worstInput.addEventListener('input', updateDir);
  targetInput.addEventListener('input', updateDir);
  updateDir();

  const presetSel   = wrap.querySelector('.m-preset');
  const supplyLabel = wrap.querySelector('.metric-supply');
  const regexLabel  = wrap.querySelector('.metric-regex');
  const regexInput  = wrap.querySelector('.m-regex');
  const nameInput   = wrap.querySelector('.m-name');

  function applyPresetVisibility() {
    const p = presetSel.value;
    if (p === 'power') {
      supplyLabel.style.display = '';
      regexLabel.style.display = 'none';
    } else {
      supplyLabel.style.display = 'none';
      regexLabel.style.display = '';
    }
  }
  function maybeAutoRegex() {
    if (presetSel.value !== 'normal') return;
    const nm = nameInput.value.trim();
    if (!nm) return;
    if ((regexInput.value || '').trim()) return;
    if (window.buildNormalRegex) {
      regexInput.value = window.buildNormalRegex(nm);
    }
  }

  presetSel.addEventListener('change', () => {
    applyPresetVisibility();
    if (presetSel.value === 'normal') {
      maybeAutoRegex();
    }
  });
  nameInput.addEventListener('change', () => {
    if (presetSel.value === 'normal') {
      maybeAutoRegex();
    }
  });

  applyPresetVisibility();
  if (presetSel.value === 'normal' && !regexInput.value.trim() && nameInput.value.trim()) {
    if (window.buildNormalRegex) {
      regexInput.value = window.buildNormalRegex(nameInput.value.trim());
    }
  }

  metricsBox.appendChild(wrap);
}
window.addMetricBlock = addMetricBlock;

const addMetricBtn = document.getElementById('addMetricBtn');
if (addMetricBtn) {
  addMetricBtn.addEventListener('click', () => {
    addMetricBlock();
  });
}

