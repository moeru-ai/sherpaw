#!/usr/bin/env python3
"""Download pinned Sherpa ASR assets into models/ and expose them to the sandbox."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / 'models/asr-catalog.json').read_text())
PUBLIC = ROOT / 'packages/sandbox/public/asr-models'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(asset, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size == asset['bytes'] and digest(path) == asset['sha256']:
        return
    partial = path.with_suffix(path.suffix + '.download')
    subprocess.run(['curl', '-fL', '--retry', '5', '--retry-delay', '2', '-C', '-',
                    '-o', str(partial), asset['url']], check=True)
    if partial.stat().st_size != asset['bytes'] or digest(partial) != asset['sha256']:
        raise ValueError(f'Checksum mismatch: {partial}')
    partial.replace(path)


def prepare(model):
    directory = ROOT / 'models' / model['directory']
    archive = directory / 'model.tar.bz2'
    download(model['archive'], archive)
    target = directory / 'model'
    marker = target / '.prepared-sha256'
    if not marker.exists() or marker.read_text() != model['archive']['sha256']:
        target.mkdir(exist_ok=True)
        with tarfile.open(archive) as tar:
            for member in tar:
                relative = Path(*Path(member.name).parts[1:])
                if not member.isfile() or not relative.parts:
                    continue
                if relative.is_absolute() or '..' in relative.parts:
                    raise ValueError(f'Unsafe archive path: {member.name}')
                out = target / relative
                out.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, out.open('wb') as dest:
                    import shutil
                    shutil.copyfileobj(source, dest)
        marker.write_text(model['archive']['sha256'])
    files = []
    for relative in sorted(set(model['weights'].values())):
        if Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise ValueError(f'Unsafe runtime file path: {relative}')
        path = target / relative
        if not path.is_file():
            raise ValueError(f'Missing runtime file: {path}')
        files.append(dict(path=relative, bytes=path.stat().st_size, sha256=digest(path)))
    if not files:
        raise ValueError(f'No runtime files: {target}')
    model_bytes = sum(f['bytes'] for f in files)
    if model_bytes != model['modelBytes']:
        raise ValueError(f'Unexpected runtime file sizes: {target}')
    manifest = dict(**model, files=files)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    link = PUBLIC / model['id']
    if not link.exists():
        link.symlink_to(os.path.relpath(target, PUBLIC), target_is_directory=True)
    print(f"Prepared {model['id']}: {manifest['modelBytes'] / 1e6:.1f} MB", flush=True)


if __name__ == '__main__':
    selected = sys.argv[1:]
    known = {m['id'] for m in CATALOG['models']}
    if set(selected) - known:
        raise SystemExit(f'Unknown models: {set(selected) - known}')
    PUBLIC.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(prepare, [m for m in CATALOG['models'] if not selected or m['id'] in selected]))
