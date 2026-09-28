// static/algo.js

// Algorithm selection and parameter fields.

window.algoSelect      = document.getElementById('algoSelect');
window.popSizeInput    = document.getElementById('popSize');
window.nGenInput       = document.getElementById('nGen');
window.algoParamsInput = document.getElementById('algoParams');

const algoSelect      = window.algoSelect;
const popSizeInput    = window.popSizeInput;
const nGenInput       = window.nGenInput;
const algoParamsInput = window.algoParamsInput;

function syncAlgoParamsFromFields() {
  if (!algoParamsInput) return;
  const map = window.parseAlgoParams
    ? window.parseAlgoParams(algoParamsInput.value)
    : {};
  const ps = parseInt(popSizeInput.value || '40', 10);
  const ng = window.parseGenerationLimit
    ? window.parseGenerationLimit(nGenInput.value, '80')
    : String(nGenInput.value || '80').trim();
  map.pop_size = ps;
  map.n_gen = ng;
  algoParamsInput.value = window.formatAlgoParams
    ? window.formatAlgoParams(map)
    : '';
}

function syncFieldsFromAlgoParams() {
  if (!algoParamsInput) return;
  const map = window.parseAlgoParams
    ? window.parseAlgoParams(algoParamsInput.value)
    : {};
  if (map.pop_size != null && Number.isFinite(Number(map.pop_size))) {
    popSizeInput.value = String(Number(map.pop_size));
  }
  if (map.n_gen != null) {
    const ng = window.parseGenerationLimit
      ? window.parseGenerationLimit(map.n_gen)
      : String(map.n_gen).trim();
    if (ng === 'inf' || (Number.isInteger(ng) && ng >= 1)) {
      nGenInput.value = String(ng);
    }
  }
}

if (popSizeInput) {
  popSizeInput.addEventListener('change', syncAlgoParamsFromFields);
}
if (nGenInput) {
  nGenInput.addEventListener('change', syncAlgoParamsFromFields);
}
if (algoParamsInput) {
  algoParamsInput.addEventListener('change', syncFieldsFromAlgoParams);
}

window.syncAlgoParamsFromFields = syncAlgoParamsFromFields;
window.syncFieldsFromAlgoParams = syncFieldsFromAlgoParams;

// Load available algorithms.
if (algoSelect) {
  fetch('/algorithms')
    .then(r => r.json())
    .then(d => {
      const sel = algoSelect;
      sel.innerHTML = '';

      const list = Array.isArray(d.algorithms) ? d.algorithms : [];

      if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '无可用算法';
        opt.disabled = true;
        opt.selected = true;
        sel.appendChild(opt);
        if (window.startBtn) window.startBtn.disabled = true;
        return;
      }

      list.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        sel.appendChild(opt);
      });

      if (window.startBtn) window.startBtn.disabled = false;
    })
    .catch(err => {
      console.error('load /algorithms error:', err);
    });
}

