#!/usr/bin/env python3
"""Build, package and smoke-test an exact native checkout; never publish."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import time
import zipfile

PLATFORMS = {
    'aarch64-apple-darwin': ('Darwin', {'arm64', 'aarch64'}, 'macos-arm64', 'solvec'),
    'x86_64-pc-windows-msvc': ('Windows', {'amd64', 'x86_64'}, 'windows-x64', 'solvec.exe'),
}

def command(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, check=True, text=True, encoding='utf-8', capture_output=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', required=True, choices=PLATFORMS)
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    system, machines, label, binary_name = PLATFORMS[args.target]
    if platform.system() != system or platform.machine().lower() not in machines:
        raise SystemExit('Qualification requires the exact native OS and architecture.')
    rustc = command('rustc', '-vV').stdout
    if f'host: {args.target}\n' not in rustc:
        raise SystemExit('Rust host must match the native target; cross-compilation is not qualification.')
    root = Path(command('git', 'rev-parse', '--show-toplevel').stdout.strip()).resolve()
    if not re.fullmatch('[a-f0-9]{40}', args.source) or command('git', 'rev-parse', 'HEAD', cwd=root).stdout.strip() != args.source:
        raise SystemExit('Exact source identity is required.')
    if command('git', 'status', '--porcelain', '--untracked-files=all', cwd=root).stdout:
        raise SystemExit('Qualification requires a clean checkout.')
    output = args.out.resolve()
    if output.is_relative_to(root) or output.exists():
        raise SystemExit('Use a fresh output directory outside the checkout.')
    metadata = json.loads(command('cargo', 'metadata', '--locked', '--no-deps', '--format-version', '1', cwd=root/'solvec').stdout)
    version = next(p['version'] for p in metadata['packages'] if p['name'] == 'solvec')
    epoch = int(command('git', 'show', '-s', '--format=%ct', args.source, cwd=root).stdout)
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='solvelang-native-') as temp:
        temp = Path(temp)
        env = dict(os.environ, CARGO_TARGET_DIR=str(temp/'build'))
        env['CARGO_ENCODED_RUSTFLAGS'] = f'--remap-path-prefix={root}=/solvelang\x1f--remap-path-prefix={temp}=/solvelang-build'
        subprocess.run(['cargo','build','--release','--locked','--target',args.target],cwd=root/'solvec',env=env,check=True)
        binary = temp/'build'/args.target/'release'/binary_name
        archive = output/f'solvelang-{version}-{label}-qualification.zip'
        info = zipfile.ZipInfo(binary_name, time.gmtime(max(epoch,315532800))[:6])
        info.create_system = 3
        info.external_attr = 0o100755 << 16
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            package.writestr(info, binary.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
        install = temp/'clean-install'
        install.mkdir()
        with zipfile.ZipFile(archive) as package:
            entries = package.infolist()
            if len(entries) != 1 or entries[0].filename != binary_name or not 0 < entries[0].file_size <= 100*1024*1024:
                raise SystemExit('Unexpected native package contents.')
            installed = install/binary_name
            installed.write_bytes(package.read(entries[0]))
            installed.chmod(0o755)
        if installed.read_bytes() != binary.read_bytes():
            raise SystemExit('Installed binary differs from the built package.')
        command(str(installed), 'help', cwd=install)
        result = command(str(installed), 'version', cwd=install)
        if result.stdout.strip() != f'solvec {version}' or result.stderr:
            raise SystemExit('Installed CLI version differs from package version.')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        evidence = {
            'kind':'solvelang_native_qualification', 'schema_version':1, 'publishable':False,
            'source_commit':args.source, 'version':version, 'target':args.target,
            'host_os':platform.system(), 'host_arch':platform.machine(), 'rustc':rustc,
            'artifact':archive.name, 'sha256':digest, 'package_roundtrip':True,
            'clean_install_help':True, 'clean_install_version':True,
            'workflow':{key:os.environ.get(key) for key in ['GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW']},
        }
        (output/'qualification.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
        (output/'SHA256SUMS').write_text(f'{digest}  {archive.name}\n',encoding='utf-8')
    print(f'Qualified {args.target} at {args.source}; evidence is non-publishable.')

if __name__ == '__main__':
    main()
