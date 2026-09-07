"""Build/check the deterministic starter download from one exact local Git source commit."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-commit', required=True)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
repo = root.parents[3]
relative = root.relative_to(repo).as_posix()
if not re.fullmatch(r'[0-9a-f]{40}', args.source_commit):
    raise SystemExit('Use an exact 40-character source commit')
if subprocess.check_output(['git', 'cat-file', '-t', args.source_commit], cwd=repo).strip() != b'commit':
    raise SystemExit('Source identity must resolve to a Git commit')

def source(path):
    if path != '.gitignore' and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', path)
                               or any(p in ('', '.', '..') for p in path.split('/'))):
        raise SystemExit('Invalid source inventory path')
    value = subprocess.check_output(['git', 'show', f'{args.source_commit}:{relative}/{path}'], cwd=repo)
    actual = root / path
    if actual.is_symlink() or any(p.is_symlink() for p in actual.parents if p != root.parent):
        raise SystemExit(f'Symlink is not source: {path}')
    if actual.read_bytes() != value:
        raise SystemExit(f'Commit/source drift: {path}')
    return value

paths = json.loads(source('package-files.json'))
if not isinstance(paths, list) or len(paths) != len(set(paths)) or not 1 <= len(paths) <= 128:
    raise SystemExit('Invalid source inventory')
template = json.loads(source('module.template.json'))
version = template['version']
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-development\.[0-9]+', version):
    raise SystemExit('Expected the additive development starter version')
buffer = io.BytesIO()
inventory = []
with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0, compresslevel=9) as compressed:
    with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for path in sorted(['.gitignore', *paths]):
            data = source(path)
            info = tarfile.TarInfo(f'engine-program/{path}')
            info.size = len(data)
            info.mode = 0o644
            info.mtime = info.uid = info.gid = 0
            archive.addfile(info, io.BytesIO(data))
            inventory.append({'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
data = buffer.getvalue()
name = f'engine-program-{version}.tar.gz'
digest = hashlib.sha256(data).hexdigest()
manifest = {
    'name': template['name'], 'version': version,
    'sourceRepository': 'https://github.com/programmablehq/PROGRAMMABLE',
    'sourceCommit': args.source_commit, 'sourcePath': relative, 'sourcePublished': False,
    'artifact': {'file': name, 'sha256': digest, 'bytes': len(data)},
    'license': 'MIT; original OpenZeppelin license included',
    'requiresContributorIdentity': True, 'apiSubmitted': False, 'reviewApproved': False, 'available': False,
    'files': inventory,
}
destination = repo / 'public/developers/module-mode-starters/engine-program' / f'v{version}'
outputs = {
    name: data,
    'manifest.json': (json.dumps(manifest, indent=2) + '\n').encode(),
    'SHA256SUMS': f'{digest}  {name}\n'.encode(),
}
for path, value in outputs.items():
    target = destination / path
    if target.is_symlink() or any(p.is_symlink() for p in target.parents):
        raise SystemExit(f'Symlink is not a distribution output: {target}')
    if args.write:
        destination.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != value:
            raise SystemExit(f'Refusing to replace an existing immutable download: {target}')
        target.write_bytes(value)
    elif not target.exists() or target.read_bytes() != value:
        raise SystemExit(f'Download drift: {target}')
print(json.dumps({'sourceCommit': args.source_commit, 'file': name, 'sha256': digest, 'bytes': len(data), 'verified': True}))
