"""Maintainer-only build; requires a separately authorized private source checkout.

Usage: python tools/build_runtime.py --source /private/AOP_v1
Requires Cython==3.3.0, setuptools, a C compiler, and Python development headers.
Never run in public CI with private source credentials or upload the temporary tree.
"""
import argparse
import ast
import os
from pathlib import Path
import shutil
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    output = Path(__file__).resolve().parents[1]
    protected = ['config.py', 'algorithm/hybrid_ea_v3_beta.py', 'analog/metrics.py',
                 'utils/basic.py', 'utils/dim_reduce.py', 'utils/population.py',
                 'utils/geometry.py', 'utils/sampling.py']
    for rel in protected:
        if not (source / rel).is_file(): parser.error('Missing private source: ' + rel)
    from setuptools import Extension, setup
    from Cython.Build import cythonize
    from Cython.Compiler import Options
    Options.docstrings = False
    previous = Path.cwd()
    with tempfile.TemporaryDirectory(prefix='aop-private-build-') as temp:
        stage = Path(temp)
        extensions = []
        for rel in protected:
            path = stage / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / rel, path)
            if rel == 'algorithm/hybrid_ea_v3_beta.py':
                text = path.read_text()
                lines = text.splitlines(keepends=True)
                spans = []
                for node in ast.walk(ast.parse(text)):
                    if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                            and isinstance(node.value.func, ast.Name) and node.value.func.id == 'print'
                            and any(isinstance(x, ast.Constant) and isinstance(x.value, str)
                                    and '[V3DBG' in x.value for x in ast.walk(node))):
                        spans.append((node.lineno, node.end_lineno, node.col_offset))
                for first, last, col in sorted(spans, reverse=True):
                    lines[first-1:last] = [' ' * col + 'pass\n'] + ['\n'] * (last-first)
                path.write_text(''.join(lines))
            name = rel[:-3].replace('/', '.')
            if name == 'algorithm.hybrid_ea_v3_beta': name = 'algorithm._hybrid_v3'
            extensions.append(Extension(name, [str(path)], extra_compile_args=['-O2', '-g0'],
                                        extra_link_args=['-Wl,-s']))
        try:
            os.chdir(stage)
            setup(name='aop-protected-runtime', ext_modules=cythonize(
                extensions, build_dir=str(stage / 'generated'),
                compiler_directives={'language_level': 3, 'binding': True,
                    'annotation_typing': False, 'infer_types': False,
                    'emit_code_comments': False, 'embedsignature': False}),
                script_args=['build_ext', '--build-lib', str(output),
                             '--build-temp', str(stage / 'objects'), '-j', '4'])
        finally:
            os.chdir(previous)
    print('Built native runtime. Re-run parity tests and update release checksums before publishing.')

if __name__ == '__main__': main()
