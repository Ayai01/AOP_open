// static/config.js

// Collect, apply, import and export optimization configuration.
function collectConfig() {
  const varTableBody = window.varTableBody;
  const algoSelect = window.algoSelect;
  const popSizeInput = window.popSizeInput;
  const nGenInput = window.nGenInput;
  const algoParamsInput = window.algoParamsInput;
  const areaBody = window.areaBody;
  const areaUnitSelect = window.areaUnitSel;

  const variables = Array.from(varTableBody ? varTableBody.querySelectorAll('tr') : []).map(row => {
    const cells = row.querySelectorAll('td');
    const name = cells[0].querySelector('input').value.trim();
    const minText = cells[1].querySelector('input').value.trim();
    const maxText = cells[2].querySelector('input').value.trim();
    const stepText = cells[3].querySelector('input').value.trim();
    const group = cells[4].querySelector('input').value.trim();
    if (!name) return null;

    const minValue = window.parseNumber ? window.parseNumber(minText) : Number(minText);
    const maxValue = window.parseNumber ? window.parseNumber(maxText) : Number(maxText);
    const stepValue = window.parseNumber ? window.parseNumber(stepText) : Number(stepText);

    return {
      name,
      min: Number.isFinite(minValue) ? minValue : null,
      max: Number.isFinite(maxValue) ? maxValue : null,
      step: Number.isFinite(stepValue) ? stepValue : null,
      group,
      min_display: minText,
      max_display: maxText,
      step_display: stepText,
    };
  }).filter(Boolean);

  const algo = algoSelect ? algoSelect.value : '';
  const popSize = parseInt(popSizeInput ? (popSizeInput.value || '40') : '40', 10);
  const nGenValue = nGenInput ? nGenInput.value : '80';
  const nGen = window.parseGenerationLimit
    ? window.parseGenerationLimit(nGenValue, '80')
    : String(nGenValue || '80').trim();
  const algoParams = algoParamsInput ? (algoParamsInput.value || '') : '';
  const workersInput = document.getElementById('cpuWorkers');
  const workers = workersInput ? parseInt(workersInput.value, 10) : NaN;
  const allowInitialValuesInput = document.getElementById('allowInitialValues');
  const allowInitialValues = allowInitialValuesInput ? allowInitialValuesInput.checked : true;

  const cktNameElement = document.getElementById('cktName');
  const cktName = cktNameElement ? cktNameElement.value.trim() : '';
  const hspiceText = window.hspiceText;
  const hspiceContent = hspiceText ? hspiceText.value : '';
  const dim = variables.length || 4;

  const metrics = Array.from(document.querySelectorAll('#metricsBox .metric')).map(metricElement => ({
    name: metricElement.querySelector('.m-name').value.trim(),
    transform: metricElement.querySelector('.m-trans').value,
    worst: metricElement.querySelector('.m-worst').value.trim(),
    target: metricElement.querySelector('.m-target').value.trim(),
    enabled: metricElement.querySelector('.m-en').checked,
    regex_preset: metricElement.querySelector('.m-preset').value,
    supply_name: metricElement.querySelector('.m-supply').value.trim(),
    regex: metricElement.querySelector('.m-regex').value.trim(),
    extract: metricElement.querySelector('.m-extract').value,
    pw: metricElement.querySelector('.m-pw').value.trim(),
    fw: metricElement.querySelector('.m-fw').value.trim(),
  }));

  const areaItems = Array.from(areaBody ? areaBody.querySelectorAll('tr') : []).map(row => {
    const cells = row.querySelectorAll('td');
    return {
      f1: cells[0].querySelector('input').value.trim(),
      f2: cells[1].querySelector('input').value.trim(),
      f3: cells[2].querySelector('input').value.trim(),
      f4: cells[3].querySelector('input').value.trim(),
      f5: cells[4].querySelector('input').value.trim(),
    };
  });

  const areaUnit = areaUnitSelect ? (areaUnitSelect.value || 'um2') : 'um2';
  const areaPwText = document.getElementById('areaPw').value.trim();
  const areaFwText = document.getElementById('areaFw').value.trim();
  const areaWorstText = document.getElementById('areaWorst').value.trim();
  const areaTargetText = document.getElementById('areaTarget').value.trim();

  let worstValue = parseFloat(areaWorstText || '0');
  let targetValue = parseFloat(areaTargetText || '0');
  if (!Number.isFinite(worstValue)) worstValue = 0;
  if (!Number.isFinite(targetValue)) targetValue = 0;

  let worstM2 = worstValue;
  let targetM2 = targetValue;
  if (areaUnit === 'um2' && window.um2_to_m2) {
    worstM2 = window.um2_to_m2(worstValue);
    targetM2 = window.um2_to_m2(targetValue);
  }

  const areaConfig = {
    enabled: document.getElementById('areaEnabled').checked,
    items: areaItems,
    pw: areaPwText,
    fw: areaFwText,
    worst: worstM2,
    target: targetM2,
    unit: areaUnit,
    worst_display: areaWorstText,
    target_display: areaTargetText,
  };

  const variableMapping = window.getVariableMapping
    ? window.getVariableMapping()
    : { w_gamma: 1.5, l_gamma: 2.0 };

  const config = {
    algo,
    pop_size: popSize,
    n_gen: nGen,
    dim,
    algo_params: algoParams,
    ckt_name: cktName,
    hspice_content: hspiceContent,
    allow_initial_values: allowInitialValues,
    variable_mapping: variableMapping,
    variables,
    metrics,
    area_config: areaConfig,
  };
  if (Number.isInteger(workers) && workers >= 1) {
    config.workers = workers;
  }
  if (document.getElementById('simulatorSelect')?.value === 'ngspice') {
    config.simulator = 'ngspice';
    const option = id => String(document.getElementById(id)?.value || '').trim();
    const settings = { timeout_seconds: Number(option('ngspiceTimeout') || '30'),
      compatibility: option('ngspiceCompatibility') || 'native' };
    for (const [key, id] of Object.entries({command:'ngspiceCommand', model_file:'ngspiceModelFile',
      model_section:'ngspiceModelSection', netlist:'ngspiceNetlist'})) {
      if (option(id)) settings[key] = option(id);
    }
    if (option('ngspiceCorners')) {
      try { settings.corners = JSON.parse(option('ngspiceCorners')); }
      catch (_) { throw new Error('ngspice 工艺角必须是有效 JSON 数组'); }
    }
    config.simulator_options = settings;
  }
  return config;
}

function applyConfig(config) {
  const cfg = config || {};
  const simulator = document.getElementById('simulatorSelect');
  if (simulator) simulator.value = cfg.simulator || 'hspice';
  const sim = cfg.simulator_options || {};
  const simulatorFields = {ngspiceCommand:sim.command || '', ngspiceTimeout:sim.timeout_seconds || 30,
    ngspiceCompatibility:sim.compatibility || 'native', ngspiceModelFile:sim.model_file || '',
    ngspiceModelSection:sim.model_section || '', ngspiceNetlist:cfg.ngspice_content_original ?? sim.netlist ?? '',
    ngspiceCorners:sim.corners ? JSON.stringify(sim.corners, null, 2) : ''};
  for (const [id, value] of Object.entries(simulatorFields)) {
    const element = document.getElementById(id);
    if (element) element.value = value;
  }
  syncSimulatorOptions();

  const workersInput = document.getElementById('cpuWorkers');
  if (workersInput && cfg.workers != null) {
    workersInput.value = String(cfg.workers);
  }

  const cktNameElement = document.getElementById('cktName');
  if (cktNameElement) cktNameElement.value = cfg.ckt_name || '';
  const sourceHspiceContent = cfg.hspice_content_original != null
    ? cfg.hspice_content_original
    : cfg.hspice_content;
  if (window.hspiceText) window.hspiceText.value = sourceHspiceContent || '';

  const allowInitialValuesInput = document.getElementById('allowInitialValues');
  if (allowInitialValuesInput) {
    allowInitialValuesInput.checked = cfg.allow_initial_values !== false;
  }

  if (window.applyVariableMapping) window.applyVariableMapping(cfg.variable_mapping || {});

  const algoSelect = window.algoSelect;
  const popSizeInput = window.popSizeInput;
  const nGenInput = window.nGenInput;
  const algoParamsInput = window.algoParamsInput;
  const varTableBody = window.varTableBody;
  const metricsBox = window.metricsBox;
  const areaBody = window.areaBody;
  const areaUnitSelect = window.areaUnitSel;

  const algoValue = cfg.algo;
  if (algoSelect) {
    if (algoValue && !Array.from(algoSelect.options).some(option => option.value === algoValue)) {
      const option = document.createElement('option');
      option.value = algoValue;
      option.textContent = algoValue;
      algoSelect.appendChild(option);
    }
    if (algoValue) algoSelect.value = algoValue;
  }

  if (popSizeInput) popSizeInput.value = cfg.pop_size || 40;
  if (nGenInput) nGenInput.value = cfg.n_gen || 80;

  if (algoParamsInput) {
    algoParamsInput.value = cfg.algo_params || '';
    if (!algoParamsInput.value) {
      if (window.syncAlgoParamsFromFields) window.syncAlgoParamsFromFields();
    } else if (window.syncFieldsFromAlgoParams) {
      window.syncFieldsFromAlgoParams();
    }
  }

  if (varTableBody) {
    varTableBody.innerHTML = '';
    (cfg.variables || []).forEach(variable => {
      const minDisplay = variable.min_display != null
        ? variable.min_display
        : (variable.min != null
          ? (window.formatNumberForVariables ? window.formatNumberForVariables(variable.min) : String(variable.min))
          : '');
      const maxDisplay = variable.max_display != null
        ? variable.max_display
        : (variable.max != null
          ? (window.formatNumberForVariables ? window.formatNumberForVariables(variable.max) : String(variable.max))
          : '');
      const stepDisplay = variable.step_display != null
        ? variable.step_display
        : (variable.step != null
          ? (window.formatNumberForVariables ? window.formatNumberForVariables(variable.step) : String(variable.step))
          : '');
      if (window.addVarRow) {
        window.addVarRow({
          name: variable.name || '',
          min: minDisplay,
          max: maxDisplay,
          step: stepDisplay,
          group: variable.group || '',
        });
      }
    });
    if (window.applyDisplayModeToVariables) window.applyDisplayModeToVariables();
  }

  if (metricsBox) {
    metricsBox.innerHTML = '';
    (cfg.metrics || []).forEach(metric => {
      if (window.addMetricBlock) window.addMetricBlock(metric);
    });
  }

  const areaConfig = cfg.area_config || {};
  if (areaBody) {
    areaBody.innerHTML = '';
    (areaConfig.items || []).forEach(item => {
      if (window.addAreaRow) window.addAreaRow([item.f1, item.f2, item.f3, item.f4, item.f5]);
    });
  }

  const areaEnabled = document.getElementById('areaEnabled');
  if (areaEnabled) areaEnabled.checked = !!areaConfig.enabled;
  const areaPw = document.getElementById('areaPw');
  const areaFw = document.getElementById('areaFw');
  if (areaPw) areaPw.value = areaConfig.pw != null ? areaConfig.pw : '0.5';
  if (areaFw) areaFw.value = areaConfig.fw != null ? areaConfig.fw : '1';

  const savedUnit = areaConfig.unit || 'um2';
  if (areaUnitSelect) areaUnitSelect.value = savedUnit;
  window.currentAreaUnit = savedUnit;

  const areaWorstElement = document.getElementById('areaWorst');
  const areaTargetElement = document.getElementById('areaTarget');

  if (areaWorstElement) {
    if (areaConfig.worst_display != null) {
      areaWorstElement.value = areaConfig.worst_display;
    } else if (areaConfig.worst != null) {
      let value = areaConfig.worst;
      if (savedUnit === 'um2' && window.m2_to_um2) value = window.m2_to_um2(value);
      areaWorstElement.value = window.formatAreaDisplay ? window.formatAreaDisplay(value) : String(value);
    } else {
      areaWorstElement.value = '1';
    }
  }

  if (areaTargetElement) {
    if (areaConfig.target_display != null) {
      areaTargetElement.value = areaConfig.target_display;
    } else if (areaConfig.target != null) {
      let value = areaConfig.target;
      if (savedUnit === 'um2' && window.m2_to_um2) value = window.m2_to_um2(value);
      areaTargetElement.value = window.formatAreaDisplay ? window.formatAreaDisplay(value) : String(value);
    } else {
      areaTargetElement.value = '1e-8';
    }
  }

  if (window.updateVariableMappingPreview) window.updateVariableMappingPreview();
}

window.collectConfig = collectConfig;
window.applyConfig = applyConfig;

function syncSimulatorOptions() {
  const panel = document.getElementById('ngspiceOptions');
  if (panel) panel.hidden = document.getElementById('simulatorSelect')?.value !== 'ngspice';
}
document.getElementById('simulatorSelect')?.addEventListener('change', syncSimulatorOptions);
syncSimulatorOptions();

// Local configuration import and export.
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const config = collectConfig();
    const filename = window.buildConfigFilename
      ? window.buildConfigFilename(config)
      : 'config.json';
    const text = JSON.stringify(config, null, 2);
    downloadTextFile(text, filename, 'application/json');
    console.log('[UI] Export config as', filename);
  });
}

const importFile = document.getElementById('importFile');
if (importFile) {
  importFile.addEventListener('change', event => {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyConfig(JSON.parse(reader.result));
      } catch (error) {
        console.error('config import error', error);
      }
    };
    reader.readAsText(file);
  });
}

