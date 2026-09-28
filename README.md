# AOP_open

AOP 模拟电路优化器的有限源码研究发行版，包含可读的网页界面、配置与接入代码，以及编译后的 **hybrid_v3** 优化核心。版本：`0.1.0`。

**hybrid_v3 是完整算法运行版本**：支持原名称 `hybrid_ea_v3_beta` 与别名 `hybrid_v3`，保留网页交互、暂停/继续/停止、实时图表、配置导入导出、无界面运行、参数映射、初始种群与最终结果导出。核心算法、评分、缓存及部分辅助计算以本机扩展发布；未包含对应 Python 源码、Python 字节码或生成的 C 源码。内部研发诊断打印已移除，优化计算逻辑保留。

## 环境与启动

首版提供 **Linux x86_64，CPython 3.10 / 3.12，NumPy 2.2.6** 的二进制。Windows 可在 WSL2 Ubuntu 中运行；本版不包含 Windows 原生、macOS、ARM 或其他 Python ABI 的二进制。

```bash
git clone https://github.com/Ayai01/AOP_open.git
cd AOP_open
bash setup.sh
.venv/bin/python main.py
```

浏览器打开 `http://127.0.0.1:8000`。原默认监听 `0.0.0.0:8000`；仅本机使用可执行 `APP_HOST=127.0.0.1 .venv/bin/python main.py`。服务用于可信本地环境，无账户认证。设置 `AOP_PYTHON=python3.10 bash setup.sh` 可选择解释器。系统需要对应的 Python venv 组件；安装完成后运行不要求联网或激活码。

```bash
.venv/bin/python doctor.py
.venv/bin/python selftest.py
```

`selftest.py` 用合成评价函数运行真实 hybrid_v3，检查四份配置的参数维数与结果输出，不需要 SPICE；其输出不代表电路性能。

## TSA / FSA / ClassAB

| 配置 | 变量数 | 仿真依赖 |
|---|---:|---|
| `json/TSA_28_4C.json` | 28 | 原 TSA 四角配置，HSPICE + SMIC 0.18 µm |
| `json/TSA.json` | 26 | TSA 校准配置，HSPICE + SMIC 0.18 µm |
| `json/FSA.json` | 50 | FSA，HSPICE + SMIC 0.18 µm |
| `json/CLASSAB.json` | 72 | ClassAB，HSPICE + SMIC 0.18 µm |

网表、变量范围、指标与角条件来自原工程。移除了校准研发元数据。**HSPICE 可执行程序、许可证及工艺模型不随包分发**。使用自己的授权环境，使 `hspice` 位于 PATH，并将原模型目录放到 `hsp_model/smic18_hsp_model/`；也可以从已有 AOP_v1 工程建立符号链接：

```bash
ln -s /absolute/path/to/AOP_v1/hsp_model ./hsp_model
.venv/bin/python doctor.py --config json/TSA_28_4C.json
.venv/bin/python main.py --config json/TSA_28_4C.json --check-only
.venv/bin/python main.py --config json/TSA_28_4C.json --headless --output results/tsa28-001
.venv/bin/python main.py --config json/FSA.json --headless --output results/fsa-001
.venv/bin/python main.py --config json/CLASSAB.json --headless --output results/classab-001
```

每次使用新的输出目录。输出包括 `input.json`、`progress.jsonl`、`result.json` 和算法导出的 Pareto 档案。网页中导入对应 JSON 后选择 `hybrid_v3` 或原名称即可运行。也可以修改 JSON 中 `.lib` 引用为本机模型的绝对路径。

`--check-only` 只验证配置格式；`doctor.py --config ...` 额外检查解释器、二进制、仿真器命令和网表中带引号的模型入口路径，不验证 HSPICE 许可证、模型内部依赖或仿真收敛。

## 独立的 ngspice 运行检查

装有 ngspice 时可以进行无工艺模型的真实仿真检查：

```bash
.venv/bin/python main.py --config json/ngspice_smoke.json --headless --output results/ngspice-001
```

这个例子优化电阻分压器，包含 −40°C / 125°C 两个温度条件。它用于验证仿真器、缓存、优化与输出链路。TSA/FSA/ClassAB 的 HSPICE 模型和语法不会自动转换为 ngspice。

## 嵌入调用与初始种群

```python
import json
from main import run_headless
cfg = json.load(open('json/TSA.json'))
result = run_headless(cfg, 'results/tsa-api-001')
```

`run_headless(..., evaluator=callback)` 可接外部评价器。回调输入是实际物理单位的参数矩阵；输出按启用指标顺序排列，启用面积时追加面积列。回调自行负责仿真与预算。可选 `initial_population` 按 `variables` 顺序填实际参数二维数组，遵循原边界、网格和种群大小限制。

## 使用许可与来源

本项目采用 [Research Evaluation License](LICENSE)：允许个人、教学和非商业研究评估，允许署名发布自己的电路结果；商业使用、软件再分发、提取核心实现或以受保护实现发展并发表衍生优化方法需要作者另行授权。完整条件以 LICENSE 为准。它属于“有限源码公开 + 闭源核心”发行，不是 OSI 意义上的开源许可证。

引用：Ayai01, *AOP_open*, version 0.1.0, https://github.com/Ayai01/AOP_open 。请同时记录所用提交号、配置与仿真环境。仓库中的源码提交标识和 SHA-256 清单记录发行来源与文件一致性，不构成算法发表优先权的保证。

本机编译与去除调试信息提高直接复制实现的成本；二进制仍可被分析。首版没有联网授权、硬件绑定、到期停机或隐藏遥测。需要更强的实现保密时，应使用不分发核心的服务端执行架构。

## 维护与验证

验证范围见 [VALIDATION.md](VALIDATION.md)。`release_manifest.json` 记录来源提交、ABI 与文件摘要；运行 `python tools/verify_release.py` 检查发布文件是否改变。摘要清单用于完整性检查，不是签名授权系统。

作者可在私有源码环境中安装 Cython 3.3.0 与 setuptools 后运行 `CC=gcc LDSHARED='gcc -shared' python tools/build_runtime.py --source /private/AOP_v1`。这只构建当前 Python ABI 的二进制；需要分别构建各 ABI、重新验证并更新摘要。临时构建目录含私有源码，不应提交或上传至公开 CI。公开仓库不具有从零重建受保护核心所需的源码。
