// static/tools.js

// Browser-side preview of Python regex extraction.

window.reTestText  = document.getElementById('reTestText');
window.rePattern   = document.getElementById('rePattern');
window.reResult    = document.getElementById('reResult');
window.reTestBtn   = document.getElementById('reTestBtn');

const reTestText  = window.reTestText;
const rePattern   = window.rePattern;
const reResult    = window.reResult;
const reTestBtn   = window.reTestBtn;

// Require a complete decimal or scientific number.
// Engineering suffixes and failed measurement tokens are not numeric.
const PY_FLOAT_FULL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/* Return a finite number only when the entire string matches PY_FLOAT_FULL_RE; otherwise return null. */
function parsePythonFloatLike(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!PY_FLOAT_FULL_RE.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function toolText(zh, en) {
  return window.uiText ? window.uiText(zh, en) : zh;
}

function runRegexTestFrontend() {
  if (!rePattern || !reTestText || !reResult) return;

  const rawPattern = (rePattern.value || '').trim();
  const text       = reTestText.value || '';
  const extract    = (typeof reExtract !== 'undefined' && reExtract)
    ? (reExtract.value || 'first')
    : 'first';

  if (!rawPattern) {
    reResult.textContent = toolText('请先在“正则表达式”中输入内容。', 'Enter a regular expression first.');
    return;
  }

  const jsPattern = window.convertPythonPatternToJs
    ? window.convertPythonPatternToJs(rawPattern)
    : rawPattern;

  let regex;
  try {
    regex = new RegExp(jsPattern, 'gm');
  } catch (e) {
    reResult.textContent = toolText('正则编译失败（当前浏览器 JS 环境）：\n', 'Regex compilation failed in the browser:\n') + String(e);
    return;
  }

  const matches         = [];
  const allNums         = [];
  const groupNums       = Object.create(null);
  let   hasNonNumeric   = false;
  const nonNumericTokens = [];

  try {
    for (const m of text.matchAll(regex)) {
      const full   = m[0];
      const groups = m.slice(1);
      const idx    = m.index != null ? m.index : -1;

      matches.push({ index: idx, full, groups });

      // Match Python read_lis extraction: any nonnumeric capture fails the result.

      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        if (g == null) continue;

        const s = String(g).trim();
        if (!s) continue;

        // Number rejects partial parses that parseFloat would accept.
        const v = Number(s);
        if (Number.isFinite(v)) {
          allNums.push(v);

          const gIndex = gi + 1;
          if (!groupNums[gIndex]) groupNums[gIndex] = [];
          groupNums[gIndex].push(v);
        } else {
          hasNonNumeric = true;
          nonNumericTokens.push(s);
          // Keep collecting matches for diagnostics even after a failed token.
        }
      }
    }
  } catch (e) {
    reResult.textContent = toolText('执行匹配时出错：\n', 'Error while matching:\n') + String(e);
    return;
  }

  let result = null;

  if (hasNonNumeric) {
    // A token such as failed invalidates the entire extracted result.
    result = null;
  } else if (allNums.length === 0) {
    result = null;
  } else {
    if (extract === 'first') {
      result = allNums[0];
    } else if (extract === 'min') {
      result = Math.min(...allNums);
    } else if (extract === 'max') {
      result = Math.max(...allNums);
    } else if (extract === 'avg') {
      result = allNums.reduce((a, b) => a + b, 0) / allNums.length;
    } else if (/^\d+$/.test(extract)) {
      const gIndex = parseInt(extract, 10);
      const arr = groupNums[gIndex] || [];
      result = arr.length ? arr[0] : null;
    } else {
      result = allNums[0];
    }
  }

  const lines = [];

  lines.push(toolText(`匹配到的行数：${matches.length}`, `Matched lines: ${matches.length}`));
  lines.push(toolText(`从所有匹配中解析出的数值个数：${allNums.length}`, `Parsed numeric values: ${allNums.length}`));
  lines.push('');

  if (matches.length) {
    lines.push(toolText('匹配详情（可对照调试）:', 'Match details:'));
    matches.forEach((m, i) => {
      lines.push(`[#${i + 1}] index=${m.index}`);
      lines.push('  match : ' + m.full);
      if (m.groups && m.groups.length) {
        lines.push(
          '  groups: [' +
            m.groups
              .map(g => (g === undefined ? 'None' : String(g)))
              .join(', ') +
            ']'
        );
      } else {
        lines.push('  groups: []');
      }
      lines.push('');
    });
  }

  lines.push(toolText('当前提取规则: ', 'Current extraction rule: ') + extract);

  if (result == null) {
    lines.push('');
    if (hasNonNumeric && nonNumericTokens.length) {

      lines.push(toolText('按当前提取规则，无法从匹配结果中得到数值（捕获分组中存在非数值 token）。', 'No numeric value can be extracted because a capture group contains a non-numeric token.'));
      lines.push(toolText('示例非数值 token: ', 'Example non-numeric token: ') + nonNumericTokens.slice(0, 3).join(', '));
    } else {
      lines.push(toolText('按当前提取规则，无法从匹配结果中得到数值。', 'No numeric value can be extracted with the current rule.'));
      lines.push(toolText('请检查：', 'Check the following:'));
      lines.push(toolText('  1) 正则表达式是否包含用于数值的捕获分组；', '  1) The regex contains a capture group for the numeric value.'));
      lines.push(toolText('  2) “提取规则”是否与你在优化设置中配置的一致。', '  2) The extraction rule matches the optimization configuration.'));
    }
  } else {
    lines.push('');
    lines.push(toolText('按当前提取规则得到的数值结果为:', 'Extracted numeric result:'));
    lines.push('  ' + String(result));
  }

  reResult.textContent = lines.join('\n');
}

window.runRegexTestFrontend = runRegexTestFrontend;

if (reTestBtn) {
  reTestBtn.addEventListener('click', runRegexTestFrontend);
}

