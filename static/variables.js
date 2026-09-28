// static/variables.js

// Variable table and netlist inputs.
window.varTableBody = document.querySelector('#varTable tbody');
window.hspiceText = document.getElementById('hspiceText');

const varTableBody = window.varTableBody;
const hspiceText = window.hspiceText;

// Number parsing and display modes.
let valueDisplayMode = 'unit'; // unit | sci | eng
window.valueDisplayMode = valueDisplayMode;

function formatNumber(value) {
  return window.formatNumberByMode
    ? window.formatNumberByMode(value, valueDisplayMode)
    : String(value);
}

function applyDisplayModeToVariables() {
  if (!varTableBody) return;
  varTableBody.querySelectorAll('tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    const inputs = [
      cells[1]?.querySelector('input'),
      cells[2]?.querySelector('input'),
      cells[3]?.querySelector('input'),
    ];
    inputs.forEach(input => {
      if (!input) return;
      const value = window.parseNumber ? window.parseNumber(input.value) : Number(input.value);
      if (Number.isFinite(value)) input.value = formatNumber(value);
    });
  });
}

window.applyDisplayModeToVariables = applyDisplayModeToVariables;
window.formatNumberForVariables = formatNumber;

document.querySelectorAll('.display-mode-btn').forEach(button => {
  button.addEventListener('click', () => {
    valueDisplayMode = button.dataset.mode || 'unit';
    window.valueDisplayMode = valueDisplayMode;

    document.querySelectorAll('.display-mode-btn').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    applyDisplayModeToVariables();
  });
});

const firstModeButton = document.querySelector('.display-mode-btn');
if (firstModeButton) firstModeButton.classList.add('active');

// Variable rows and .param discovery.
function addVarRow(variable = { name: '', min: '', max: '', step: '', group: '' }) {
  if (!varTableBody) return;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input value="${variable.name || ''}" placeholder="w1"/></td>
    <td><input value="${variable.min || ''}" placeholder="min"/></td>
    <td><input value="${variable.max || ''}" placeholder="max"/></td>
    <td><input value="${variable.step || ''}" placeholder="step"/></td>
    <td><input value="${variable.group || ''}" placeholder="group"/></td>
    <td><button class="link remove">移除</button></td>
  `;
  row.querySelector('.remove').onclick = () => row.remove();
  varTableBody.appendChild(row);
}
window.addVarRow = addVarRow;

const addVarBtn = document.getElementById('addVarBtn');
if (addVarBtn) addVarBtn.addEventListener('click', () => addVarRow());

function extractParamNamesFromHspice(text) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim().toLowerCase().startsWith('.param'));
  if (startIndex < 0) return [];

  let body = lines[startIndex].trim().replace(/^\s*\.param/i, '').trim();
  let lineIndex = startIndex + 1;
  while (lineIndex < lines.length && /^\s*\+/.test(lines[lineIndex])) {
    const continuation = lines[lineIndex].trim().replace(/^\+/, '').trim();
    body += ' ' + continuation;
    lineIndex += 1;
  }

  const paramRegex = /([A-Za-z_]\w*)\s*=/g;
  const names = new Set();
  let match;
  while ((match = paramRegex.exec(body)) !== null) names.add(match[1]);
  return Array.from(names);
}
window.extractParamNamesFromHspice = extractParamNamesFromHspice;

function formatSpiceParamValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('Geometric-mean parameter value must be finite');
  }
  if (number === 0) return '0';
  return number.toExponential(12)
    .replace(/(\.\d*?[1-9])0+e/, '$1e')
    .replace(/\.0+e/, 'e');
}

function geometricMeanParamMap(variables) {
  const replacements = new Map();
  (variables || []).forEach((variable, index) => {
    const name = String((variable && variable.name) || '').trim();
    if (!name) return;

    const minimum = Number(variable.min);
    const maximum = Number(variable.max);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      throw new Error(`Variable ${name || index + 1} requires finite min/max bounds`);
    }
    if (minimum < 0 || maximum < 0) {
      throw new Error(`Variable ${name} cannot use a real geometric mean with negative bounds`);
    }

    const value = Math.sqrt(minimum) * Math.sqrt(maximum);
    replacements.set(name, formatSpiceParamValue(value));
  });
  return replacements;
}

function replaceParamBlockWithValues(blockLines, replacements) {
  if (!Array.isArray(blockLines) || !blockLines.length) return '';
  const bodyParts = [];
  blockLines.forEach((line, index) => {
    let part = String(line || '').trim();
    if (index === 0) part = part.replace(/^\.param\b/i, '').trim();
    else part = part.replace(/^\+/, '').trim();
    if (part) bodyParts.push(part);
  });
  const body = bodyParts.join(' ');
  const assignmentRe = /([A-Za-z_]\w*)\s*=\s*/g;
  const matches = Array.from(body.matchAll(assignmentRe));
  if (!matches.length) return blockLines.join('\n');

  let replacedCount = 0;
  let output = '';
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index;
    const valueStart = start + match[0].length;
    const valueEnd = index + 1 < matches.length ? matches[index + 1].index : body.length;
    const valueSpan = body.slice(valueStart, valueEnd);
    const name = match[1];

    output += body.slice(cursor, valueStart);
    if (replacements.has(name)) {
      let suffix = '';
      const commentMatch = valueSpan.match(/(\s+\$.*)$/);
      if (commentMatch) {
        suffix = commentMatch[1];
      } else {
        const whitespaceMatch = valueSpan.match(/\s*$/);
        suffix = whitespaceMatch ? whitespaceMatch[0] : '';
      }
      output += replacements.get(name) + suffix;
      replacedCount += 1;
    } else {
      output += valueSpan;
    }
    cursor = valueEnd;
  });

  if (!replacedCount) return blockLines.join('\n');
  return '.param ' + output.trim();
}

function replaceParamValuesWithGeometricMeans(text, variables) {
  const replacements = geometricMeanParamMap(variables);
  if (!replacements.size) return String(text || '');

  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!/^\s*\.param\b/i.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const block = [lines[i]];
    let j = i + 1;
    while (j < lines.length && /^\s*\+/.test(lines[j])) {
      block.push(lines[j]);
      j += 1;
    }
    out.push(replaceParamBlockWithValues(block, replacements));
    i = j;
  }
  return out.join('\n');
}

function prepareConfigForRun(config) {
  const next = { ...(config || {}) };
  if (next.allow_initial_values !== false) return next;

  const original = String(next.hspice_content || '');
  next.hspice_content_original = original;
  next.hspice_content = replaceParamValuesWithGeometricMeans(
    original,
    next.variables || []
  );
  if (next.simulator === 'ngspice' && next.simulator_options?.netlist) {
    next.ngspice_content_original = next.simulator_options.netlist;
    next.simulator_options = {...next.simulator_options,
      netlist: replaceParamValuesWithGeometricMeans(next.simulator_options.netlist, next.variables || [])};
  }
  return next;
}

window.replaceParamValuesWithGeometricMeans = replaceParamValuesWithGeometricMeans;
window.prepareConfigForRun = prepareConfigForRun;

const autoVarBtn = document.getElementById('autoVarBtn');
if (autoVarBtn) {
  autoVarBtn.addEventListener('click', () => {
    const text = hspiceText ? (hspiceText.value || '') : '';
    if (!text.trim() || !varTableBody) return;

    const names = extractParamNamesFromHspice(text);
    if (!names.length) return;

    const existingNames = new Set(
      Array.from(varTableBody.querySelectorAll('tr td:first-child input'))
        .map(input => (input.value || '').trim())
        .filter(Boolean)
    );

    const defaults = {
      w: {
        min: document.getElementById('defWMin').value,
        max: document.getElementById('defWMax').value,
        step: document.getElementById('defWStep').value,
      },
      l: {
        min: document.getElementById('defLMin').value,
        max: document.getElementById('defLMax').value,
        step: document.getElementById('defLStep').value,
      },
      m: {
        min: document.getElementById('defMMin').value,
        max: document.getElementById('defMMax').value,
        step: document.getElementById('defMStep').value,
      },
    };

    names.forEach(name => {
      if (!name || existingNames.has(name)) return;
      existingNames.add(name);
      const defaultValues = defaults[name[0].toLowerCase()] || { min: '', max: '', step: '' };
      addVarRow({ name, ...defaultValues, group: '' });
    });
  });
}

function applyDefaultsToVars(prefix, minId, maxId, stepId) {
  if (!varTableBody) return;

  const minValue = document.getElementById(minId).value;
  const maxValue = document.getElementById(maxId).value;
  const stepValue = document.getElementById(stepId).value;
  const normalizedPrefix = prefix.toLowerCase();

  varTableBody.querySelectorAll('tr').forEach(row => {
    const nameInput = row.querySelector('td:first-child input');
    if (!nameInput) return;
    const name = (nameInput.value || '').trim();
    if (!name || name[0].toLowerCase() !== normalizedPrefix) return;

    const cells = row.querySelectorAll('td');
    const minInput = cells[1]?.querySelector('input');
    const maxInput = cells[2]?.querySelector('input');
    const stepInput = cells[3]?.querySelector('input');
    if (minInput) minInput.value = minValue;
    if (maxInput) maxInput.value = maxValue;
    if (stepInput) stepInput.value = stepValue;
  });
}

const applyWAll = document.getElementById('applyWAll');
if (applyWAll) {
  applyWAll.addEventListener('click', () => applyDefaultsToVars('w', 'defWMin', 'defWMax', 'defWStep'));
}
const applyLAll = document.getElementById('applyLAll');
if (applyLAll) {
  applyLAll.addEventListener('click', () => applyDefaultsToVars('l', 'defLMin', 'defLMax', 'defLStep'));
}
const applyMAll = document.getElementById('applyMAll');
if (applyMAll) {
  applyMAll.addEventListener('click', () => applyDefaultsToVars('m', 'defMMin', 'defMMax', 'defMStep'));
}

window.applyDefaultsToVars = applyDefaultsToVars;

// Shared W/L dimension mapping.
const defaultWGamma = 1.5;
const defaultLGamma = 2.0;
const minMappingGamma = 0.5;

function validGamma(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minMappingGamma, parsed);
}

function ensureVariableMappingControls() {
  if (document.getElementById('gammaW')) return;
  const variableCard = document.querySelector('#page3 .card');
  if (!variableCard) return;

  const panel = document.createElement('div');
  panel.id = 'variableMappingPanel';
  panel.className = 'mapping-panel';
  panel.innerHTML = `
    <div class="mapping-panel-head">
      <strong>全局尺寸映射</strong>
      <span class="mapping-note">所有 W/L 变量统一使用；其它变量保持线性映射</span>
    </div>
    <div class="row wrap mapping-fields">
      <label class="field">
        <span>W 映射 γW</span>
        <input id="gammaW" type="number" min="0.5" step="0.1" value="1.5"/>
      </label>
      <label class="field">
        <span>L 映射 γL</span>
        <input id="gammaL" type="number" min="0.5" step="0.1" value="2.0"/>
      </label>
      <div class="mapping-formula">
        <div>W = Wmin × (Wmax/Wmin)<sup>(u<sup>γW</sup>)</sup></div>
        <div>L = Lmin × (Lmax/Lmin)<sup>(u<sup>γL</sup>)</sup></div>
      </div>
    </div>
    <div id="mappingPreview" class="mapping-preview"></div>
    <div class="mapping-note mapping-footnote">
      γ 最低为 0.5；γ &gt; 1 会把相同的归一化搜索密度向较小尺寸侧压缩。step 始终在实际尺寸域量化，再通过严格逆映射返回 u。
    </div>
  `;

  const heading = variableCard.querySelector('h3');
  if (heading) heading.insertAdjacentElement('afterend', panel);
  else variableCard.prepend(panel);

  ['gammaW', 'gammaL'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('input', updateVariableMappingPreview);
    input.addEventListener('blur', () => {
      const fallback = id === 'gammaW' ? defaultWGamma : defaultLGamma;
      input.value = String(validGamma(input.value, fallback));
      updateVariableMappingPreview();
    });
  });

  ['defWMin', 'defWMax', 'defLMin', 'defLMax'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', updateVariableMappingPreview);
  });
  updateVariableMappingPreview();
}

function getVariableMapping() {
  ensureVariableMappingControls();
  const gammaWInput = document.getElementById('gammaW');
  const gammaLInput = document.getElementById('gammaL');
  return {
    w_gamma: validGamma(gammaWInput ? gammaWInput.value : null, defaultWGamma),
    l_gamma: validGamma(gammaLInput ? gammaLInput.value : null, defaultLGamma),
  };
}

function applyVariableMapping(mapping) {
  ensureVariableMappingControls();
  const config = mapping && typeof mapping === 'object' ? mapping : {};
  const gammaWInput = document.getElementById('gammaW');
  const gammaLInput = document.getElementById('gammaL');
  if (gammaWInput) gammaWInput.value = String(validGamma(config.w_gamma, defaultWGamma));
  if (gammaLInput) gammaLInput.value = String(validGamma(config.l_gamma, defaultLGamma));
  updateVariableMappingPreview();
}

function mappedMidpoint(minText, maxText, gamma) {
  const parseNumber = window.parseNumber || Number;
  const minimum = parseNumber(minText);
  const maximum = parseNumber(maxText);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum <= 0 || maximum < minimum) {
    return null;
  }
  if (minimum === maximum) return minimum;
  return minimum * Math.pow(maximum / minimum, Math.pow(0.5, gamma));
}

function updateVariableMappingPreview() {
  const preview = document.getElementById('mappingPreview');
  if (!preview) return;
  const mapping = getVariableMapping();
  const wPosition = Math.pow(0.5, mapping.w_gamma);
  const lPosition = Math.pow(0.5, mapping.l_gamma);
  const wMid = mappedMidpoint(
    document.getElementById('defWMin')?.value || '',
    document.getElementById('defWMax')?.value || '',
    mapping.w_gamma
  );
  const lMid = mappedMidpoint(
    document.getElementById('defLMin')?.value || '',
    document.getElementById('defLMax')?.value || '',
    mapping.l_gamma
  );
  const format = window.formatNumberByMode
    ? value => window.formatNumberByMode(value, 'unit')
    : value => String(value);

  const english = window.getUiLanguage && window.getUiLanguage() === 'en';
  let text = english
    ? `u=0.5 → W exponent position ${wPosition.toFixed(4)}, L exponent position ${lPosition.toFixed(4)}`
    : `u=0.5 → W 的指数位置 ${wPosition.toFixed(4)}，L 的指数位置 ${lPosition.toFixed(4)}`;
  if (wMid != null || lMid != null) {
    const examples = [];
    if (wMid != null) examples.push(`W≈${format(wMid)}`);
    if (lMid != null) examples.push(`L≈${format(lMid)}`);
    text += english
      ? `; with current default ranges: ${examples.join(', ')}`
      : `；按当前默认范围：${examples.join('，')}`;
  }
  preview.textContent = text;
}

window.getVariableMapping = getVariableMapping;
window.applyVariableMapping = applyVariableMapping;
window.updateVariableMappingPreview = updateVariableMappingPreview;

ensureVariableMappingControls();

document.addEventListener('aop:languagechange', () => {
  if (window.updateVariableMappingPreview) window.updateVariableMappingPreview();
});

