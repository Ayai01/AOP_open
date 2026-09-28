# Release 0.1.0 validation

Source snapshot: `395d93d6229e8b3f050a9b5f3e3bc0ee2795b5fc`.
Build: Cython 3.3.0, GCC, Linux x86_64, CPython 3.10.21 and 3.12.14.
Runtime validation uses NumPy 2.2.6. Native binaries require at most GLIBC_2.14 symbols; testing was on Ubuntu 24.04, not a separate Ubuntu 22.04 machine.

| Check | Result |
|---|---|
| Native imports on CPython 3.10 and 3.12 | Passed |
| Source vs compiled hybrid_v3 on TSA (26 variables), FSA (50), ClassAB (72) | Passed, exact numerical and stable event/result payload equality |
| Four circuit configurations with protected optimizer and synthetic evaluator | Passed on Python 3.10 and 3.12 |
| Actual ngspice 42 simulation + headless optimization | Passed on Python 3.10 and 3.12 |
| HTTP page and both algorithm names | Passed |
| Start, pause, resume, stop; SSE progress and done; result restoration | Passed with actual ngspice on Python 3.12 |
| Core source / generated C / private models in public release | Excluded |
| Internal V3DBG diagnostic strings in native binaries | Absent |
| Real HSPICE TSA/FSA/ClassAB optimization | Not run: HSPICE and authorized process models unavailable in build environment |
| Native Windows/macOS/ARM and other Python versions | No binaries supplied |

## Parity procedure

Each of the three circuit configurations was run through the original `run_headless` entry and the compiled release entry with the same deterministic synthetic evaluator, seed 921, population 12, three generations, initial sampling count 16 and complete archive export. Best designs, fitness, metric arrays, final archive, and stable progress payloads matched exactly. Wall-clock timing and timing text, generated netlist/skill text, simulation counters and formatted final-result text were excluded from comparison. Only internal diagnostic print statements were removed for release; the evaluator, variation, selection and archive logic were retained.

Synthetic fitness values are test fixtures, not circuit measurements or evidence that circuit specifications are met. These short tests check compilation and integration equivalence, not all possible inputs or long-run convergence.

## Real ngspice check

The included resistor divider was simulated under two temperature conditions, −40°C and 125°C. The protected optimizer returned the expected boundary design `r1=500 ohm`; the measured output was approximately `0.66666669 V`, consistent with the ideal divider. This checks subprocess simulation, extraction, parallel evaluation, caching, optimizer execution and result serialization, without using a foundry model.

## Remaining local verification

Provide the original licensed HSPICE installation and SMIC model directory; run `doctor.py --config ...`, then run the desired circuit. Configuration checks and synthetic tests do not certify foundry-model accuracy, HSPICE licensing, convergence, or achievement of analog performance targets.
