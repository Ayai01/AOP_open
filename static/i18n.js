// static/i18n.js
(function initI18n() {
  const STORAGE_KEY = 'aop.ui.language';
  const zhToEn = {
    '首页':'Home','网表设置':'Netlist','优化设置':'Optimization','算法设置':'Algorithm',
    '算法可视化':'Visualization','小工具':'Tools','控制中心':'Control Center',
    '运行状态、工程配置与全局界面设置':'Run status, project configuration, and global interface settings',
    '语言':'Language','主题':'Theme','夜间':'Dark','日间':'Light',
    '运行控制':'Run Control','CPU 并行核心数':'CPU parallel cores',
    '连接服务器后加载默认值':'Server default loads after connection',
    '开始优化':'Start Optimization','终止优化':'Stop Optimization',
    '关闭服务器':'Shut Down Server','连接：':'Connection:','未连接':'Disconnected','已连接':'Connected',
    '状态：':'Status:','空闲':'Idle','启动中':'Starting','运行中':'Running','已暂停':'Paused',
    '停止中':'Stopping','已完成':'Finished','错误':'Error','暂停优化':'Pause Optimization',
    '开始/继续优化':'Start / Resume','配置导入 / 导出':'Configuration Import / Export',
    '导出 JSON':'Export JSON','导入 JSON':'Import JSON','最终结果':'Final Result',
    '导出网表':'Export Netlist','导出 SKILL 脚本':'Export SKILL Script',
    '基于当前最优解生成 HSPICE 网表和 Virtuoso SKILL 脚本':'Generate an HSPICE netlist and Virtuoso SKILL script from the current best solution',
    '电路名称：':'Circuit name:','HSPICE 文本（包含 .param，可有 + 续行）':'HSPICE text (including .param; + continuation lines supported)',
    '变量参数':'Design Variables','变量名':'Variable','最小值':'Minimum','最大值':'Maximum','步长':'Step',
    '分组':'Group','操作':'Action','添加变量':'Add Variable','从 .param 自动识别':'Detect from .param',
    '基于网表中第一个 .param 块':'Uses the first .param block in the netlist','显示模式：':'Display format:',
    'u/n/p 工程单位':'Engineering prefixes (u/n/p)','科学计数法':'Scientific notation',
    '工程计数(e±3k)':'Engineering notation (e±3k)','默认范围：':'Default ranges:',
    '应用到全部 W':'Apply to all W','应用到全部 L':'Apply to all L','应用到全部 M':'Apply to all M',
    '全局尺寸映射':'Global Size Mapping','所有 W/L 变量统一使用；其它变量保持线性映射':'Applied to all W/L variables; other variables remain linear',
    'W 映射 γW':'W mapping γW','L 映射 γL':'L mapping γL','仿真指标':'Simulation Metrics',
    '添加指标':'Add Metric','名称':'Name','变换':'Transform','启用':'Enabled','正则预设':'Regex preset',
    '电源名(仅 power)':'Supply name (power only)','正则表达式':'Regular expression','提取规则':'Extraction rule',
    '移除此指标':'Remove Metric','移除':'Remove','方向: -':'Direction: -','Area Calc':'Area Calculation',
    '添加行':'Add Row','约束强度 pw':'Constraint weight pw','目标权重 fw':'Objective weight fw',
    '最差估计 worst':'Worst estimate','优化目标 target':'Optimization target','算法参数':'Algorithm Parameters',
    '算法：':'Algorithm:','种群大小：':'Population size:','总代数：':'Generations:','参数定义组':'Additional parameters',
    '允许算法使用网表初始值':'Allow algorithm to use netlist initial values',
    '关闭后，运行时将 .param 中与优化变量同名的值替换为上下界几何平均数；不修改当前文本框中的原始网表。':'When disabled, matching optimization-variable values in .param blocks are replaced at run time with the geometric mean of their bounds; the netlist editor text is left unchanged.',
    '修改种群大小 / 总代数会同步更新到此处；反之亦然。':'Population size and generations are synchronized with these parameters in both directions.',
    '种群结构、优化历史与运行诊断':'Population structure, optimization history, and runtime diagnostics',
    '可视化设置':'Visualization Settings','Fit 配色':'Fit palette','蓝 / 绿 / 红 / 灰（默认）':'Blue / green / red / gray (default)',
    '黑体温度序列':'Black-body temperature sequence','黑体温度 · 鲜明':'Black-body temperature · vivid',
    'Turbo 光谱':'Turbo spectrum','Viridis':'Viridis','Magma':'Magma','最差灰化尾部':'Worst-tail graying',
    '降维方法':'Dimensionality reduction','当前嵌入':'Current embedding','重算当前代':'Recompute current generation',
    'PCA 实时更新':'PCA updates in real time','PCA · 实时':'PCA · real-time',
    'UMAP · 实时':'UMAP · real-time','t-SNE · 实时':'t-SNE · real-time','MDS · 实时':'MDS · real-time',
    '更好 / lower fit':'Better / lower fit','更差 / higher fit':'Worse / higher fit',
    '进度日志':'Progress Log','种群信息':'Population Information',
    '种群展示（2D-Embedding + fit 分布）':'Population View (2D embedding + fit distribution)','历史曲线':'History',
    '正则提取规则测试':'Regex Extraction Test','测试字符串':'Test text','测试匹配':'Run Test','测试结果':'Test Result',
    '在这里粘贴仿真输出等原始文本':'Paste raw simulation output here',
    '0（第 1 个分组）':'0 (group 1)','1（第 2 个分组）':'1 (group 2)','2（第 3 个分组）':'2 (group 3)',
    '暂无当前种群数据':'No current population data','当前算法未提供高维种群数据':'The current algorithm does not provide high-dimensional population data',
    '正在计算降维…':'Computing embedding…','降维失败':'Dimensionality reduction failed',
    '新的种群已到达，可重算当前降维视图':'A new population is available; recompute the current embedding',
    '等待种群':'Waiting for population','正在计算第':'Computing generation',
    '启动失败':'Failed to start optimization',
    '当前没有可导出的网表，请先完成一次优化。':'No netlist is available. Complete an optimization first.',
    '当前没有可导出的 SKILL 脚本，请先完成一次优化。':'No SKILL script is available. Complete an optimization first.',
    '无可用算法':'No algorithms available',
    'γ 最低为 0.5；γ > 1 会把相同的归一化搜索密度向较小尺寸侧压缩。step 始终在实际尺寸域量化，再通过严格逆映射返回 u。':'Minimum γ is 0.5. γ > 1 shifts normalized search density toward smaller dimensions. Step quantization is applied in the physical domain and mapped back to u by the exact inverse.',
    '例如: pop_size=40; n_gen=80; cr=0.9; mr=0.1':'Example: pop_size=40; n_gen=80; cr=0.9; mr=0.1'
  };
  const enToZh = Object.fromEntries(Object.entries(zhToEn).map(([zh,en])=>[en,zh]));
  const sourceText = new WeakMap();
  const sourceAttrs = new WeakMap();
  let applying = false;
  let language = 'zh';

  function loadLanguage() {
    try { language = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'; }
    catch (error) { language = 'zh'; }
  }

  function translateTextNode(node) {
    if (!sourceText.has(node)) sourceText.set(node, node.nodeValue || '');
    const source = sourceText.get(node);
    const trimmed = source.trim();
    if (!trimmed) return;
    const translated = language === 'en' ? (zhToEn[trimmed] || trimmed) : trimmed;
    const start = source.indexOf(trimmed);
    const next = source.slice(0,start) + translated + source.slice(start + trimmed.length);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateAttributes(element) {
    const attrs = ['placeholder','title','aria-label'];
    let originals = sourceAttrs.get(element);
    if (!originals) { originals = {}; sourceAttrs.set(element, originals); }
    attrs.forEach(name => {
      if (!element.hasAttribute(name)) return;
      if (!(name in originals)) originals[name] = element.getAttribute(name);
      const source = originals[name];
      const translated = language === 'en' ? (zhToEn[source] || source) : source;
      if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
    });
  }

  function translateTree(root) {
    applying = true;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || ['SCRIPT','STYLE','TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) translateTextNode(node);
      if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
      if (root.querySelectorAll) root.querySelectorAll('*').forEach(translateAttributes);
    } finally { applying = false; }
  }

  function applyLanguage() {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    translateTree(document.body);
    const select = document.getElementById('languageSelect');
    if (select) select.value = language;
    document.dispatchEvent(new CustomEvent('aop:languagechange',{detail:{language}}));
  }

  function setLanguage(next,persist=true) {
    language = next === 'en' ? 'en' : 'zh';
    if (persist) { try { localStorage.setItem(STORAGE_KEY,language); } catch(error) {} }
    applyLanguage();
  }

  loadLanguage();
  window.getUiLanguage = () => language;
  window.uiText = (zh,en) => language === 'en' ? en : zh;
  window.uiTranslate = text => language === 'en' ? (zhToEn[text] || text) : (enToZh[text] || text);
  window.applyUiLanguage = applyLanguage;

  const observer = new MutationObserver(mutations => {
    if (applying) return;
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
      else if (node.nodeType === Node.TEXT_NODE) {
        applying = true;
        try { translateTextNode(node); } finally { applying = false; }
      }
    }));
  });

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('languageSelect');
    if (select) {
      select.value = language;
      select.addEventListener('change', () => setLanguage(select.value));
    }
    applyLanguage();
    observer.observe(document.body,{childList:true,subtree:true});
  });
})();

