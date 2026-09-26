#!/usr/bin/env python3
"""Package the pinned X-ASR variants in the existing Emscripten preload layout."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDS = ('x-asr', 'x-asr-fp32')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package(model, packager):
    directory = ROOT / 'models' / model['directory']
    source = directory / 'model'
    manifest = json.loads((source / 'manifest.json').read_text())
    if any(manifest[key] != value for key, value in model.items()):
        raise ValueError(f'Stale model manifest: {source}')
    files = {entry['path']: entry for entry in manifest['files']}
    expected = set(model['weights'].values())
    if set(files) != expected:
        raise ValueError(f'Unexpected model files: {source}')
    for name, entry in files.items():
        path = source / name
        if path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError(f'Model checksum mismatch: {path}')
    output = directory / 'install/bin/wasm'
    output.mkdir(parents=True, exist_ok=True)
    virtual = {role: f"/{role}.onnx" if role != 'tokens' else '/tokens.txt'
               for role in model['weights']}
    with tempfile.TemporaryDirectory(prefix='sherpaw-x-asr-', dir=directory) as temporary:
        normalized = Path(temporary)
        for role, name in model['weights'].items():
            shutil.copyfile(source / name, normalized / virtual[role].lstrip('/'))
        if packager:
            subprocess.run([str(packager), 'preload.data', '--preload', f'{normalized}@/',
                            '--js-output=preload.js', '--separate-metadata', '--export-es6'],
                           cwd=output, check=True)
        else:
            subprocess.run(['docker', 'run', '--rm', '--platform', 'linux/amd64',
                            '-v', f'{normalized}:/assets:ro', '-v', f'{output}:/output',
                            '--workdir', '/output', '--entrypoint', '/bin/bash',
                            'emscripten/emsdk:4.0.23', '-lc',
                            '"$(dirname "$(command -v emcc)")/tools/file_packager" preload.data '
                            '--preload /assets@/ --js-output=preload.js --separate-metadata --export-es6'],
                           check=True)
    metadata = json.loads((output / 'preload.js.metadata').read_text())
    ranges = {entry['filename']: entry for entry in metadata['files']}
    if set(ranges) != set(virtual.values()):
        raise ValueError('Unexpected virtual files in preload package')
    with (output / 'preload.data').open('rb') as packed:
        for role, name in model['weights'].items():
            entry = ranges[virtual[role]]
            packed.seek(entry['start'])
            data = packed.read(entry['end'] - entry['start'])
            if len(data) != files[name]['bytes'] or hashlib.sha256(data).hexdigest() != files[name]['sha256']:
                raise ValueError(f'Packed bytes differ from source: {name}')
    artifacts = {}
    for name in ('preload.data', 'preload.js', 'preload.js.metadata'):
        path = output / name
        artifacts[f'install/bin/wasm/{name}'] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    manifest = {
        'id': model['id'], 'label': model['label'],
        'source': model['archive']['url'],
        'sourceArchive': model['archive'],
        'modelCard': 'https://huggingface.co/GilgameshWind/X-ASR-zh-en',
        'virtualPaths': virtual,
        'sourceFiles': files,
        'weights': model['weights'],
        'packager': 'emscripten/emsdk:4.0.23',
        'files': artifacts,
    }
    (directory / 'package-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Verified {model['id']} package: {output}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', help='x-asr and/or x-asr-fp32; default: both')
    parser.add_argument('--file-packager', type=Path,
                        help='Optional local Emscripten 4.0.23 file_packager; default: Docker')
    args = parser.parse_args()
    selected = args.models or IDS
    if set(selected) - set(IDS):
        parser.error(f'Unknown X-ASR variants: {set(selected) - set(IDS)}')
    packager = args.file_packager.resolve() if args.file_packager else None
    if packager and not packager.is_file():
        parser.error(f'Missing file packager: {packager}')
    catalog = json.loads((ROOT / 'models/asr-catalog.json').read_text())
    subprocess.run(['python3', str(ROOT / 'scripts/prepare-asr-models.py'), *selected], check=True)
    for model in catalog['models']:
        if model['id'] in selected:
            package(model, packager)
