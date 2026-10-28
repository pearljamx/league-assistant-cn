"""Copy supplied runtime/build licenses without downloading anything or interpreting terms."""
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts' / 'third-party-licenses'
MARKER = '.generated-by-league-assistant'
if not OUTPUT.resolve().is_relative_to(ROOT):
    raise SystemExit('License output must stay inside the project')
if OUTPUT.exists():
    if not (OUTPUT / MARKER).is_file():
        raise SystemExit('Refusing to replace an unmarked license directory')
    shutil.rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)
(OUTPUT / MARKER).write_text('Generated license collection; rebuild from locked dependencies.\n', encoding='utf-8')


def copy(source, relative):
    target = OUTPUT / relative
    if not target.resolve().is_relative_to(OUTPUT.resolve()):
        raise ValueError('Unsafe license output path')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return {'path': relative.as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


runtime = None
for name in ('LICENSE_PYTHON.txt', 'LICENSE.txt', 'LICENSE'):
    candidate = Path(sys.base_prefix) / name
    if candidate.is_file() and 'PYTHON SOFTWARE FOUNDATION' in candidate.read_text(encoding='utf-8', errors='replace').upper():
        runtime = copy(candidate, Path('python-runtime') / 'LICENSE.txt')
        break
if runtime is None:
    raise SystemExit('The Python runtime license file is missing')

index = {'scope': 'Locked Python OCR dependencies and build tools; supplied license files',
         'pythonVersion': sys.version.split()[0], 'pythonLicense': runtime, 'packages': []}
missing = []
for line in (ROOT / 'worker' / 'requirements-lock.txt').read_text(encoding='utf-8').splitlines():
    if not line or line.startswith('#'):
        continue
    name, version = line.split('==', 1)
    if not re.fullmatch(r'[\w.-]+', name) or not re.fullmatch(r'[\w.+-]+', version):
        raise ValueError('Unexpected locked package identifier')
    distribution = metadata.distribution(name)
    if distribution.version != version:
        raise SystemExit(f'Installed version differs from lock: {name}')
    package_root = Path(distribution.locate_file('')).resolve()
    records = []
    for entry in distribution.files or []:
        relative = Path(str(entry))
        legal = re.match(r'^(licen[cs]e|copying|notice|third.?party.?notices?)(?:[._-].*|$)', relative.name, re.I)
        if not legal and not any(part.lower() == 'licenses' for part in relative.parts):
            continue
        source = Path(distribution.locate_file(entry)).resolve()
        if not source.is_file() or not source.is_relative_to(package_root):
            continue
        records.append(copy(source, Path('packages') / name / version / relative))
    if not records:
        fallback = ROOT / 'resources' / 'license-sources' / name.lower() / version / 'LICENSE'
        if fallback.is_file():
            records.append(copy(fallback, Path('packages') / name / version / 'upstream-LICENSE'))
        else:
            missing.append(name)
    license_name = distribution.metadata.get('License-Expression') or distribution.metadata.get('License') or 'See supplied files'
    index['packages'].append({'name': name, 'version': version, 'metadataLicense': license_name.splitlines()[0], 'files': records})
if missing:
    raise SystemExit('Missing supplied/upstream license files: ' + ', '.join(missing))
index['nativeLibraries'] = []
bundle = ROOT / 'worker' / 'dist' / 'league-ocr' / '_internal'
native_names = {'libffi': 'ffi.dll', 'bzip2': 'libbz2.dll', 'xz': 'liblzma.dll'}
bundled = {file.name.lower(): file for file in bundle.glob('*.dll')}
for manifest in (Path(sys.base_prefix) / 'conda-meta').glob('*.json'):
    package = json.loads(manifest.read_text(encoding='utf-8'))
    name = package.get('name')
    if name not in native_names or native_names[name] not in bundled:
        continue
    binary = bundled[native_names[name]]
    original = next((Path(sys.base_prefix) / path for path in package.get('files', [])
                     if Path(path).name.lower() == binary.name.lower()), None)
    if original is None or not original.is_file() or hashlib.sha256(original.read_bytes()).digest() != hashlib.sha256(binary.read_bytes()).digest():
        raise SystemExit('Cannot establish native library license provenance: ' + name)
    supplied = Path(package.get('link', {}).get('source', '')) / 'info' / 'licenses'
    documents = [file for file in supplied.rglob('*') if file.is_file()] if supplied.is_dir() else []
    if not documents:
        supplied = ROOT / 'resources' / 'license-sources' / name / package['version']
        documents = [file for file in supplied.rglob('*') if file.is_file()] if supplied.is_dir() else []
    if not documents: raise SystemExit('Native runtime license files are missing: ' + name)
    records = [copy(file, Path('native') / name / package['version'] / file.relative_to(supplied)) for file in documents]
    index['nativeLibraries'].append({'name': name, 'version': package['version'], 'metadataLicense': package.get('license'),
                                      'binary': binary.name, 'sha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'files': records})
openssl = [file for name, file in bundled.items() if name.startswith(('libssl-3', 'libcrypto-3'))]
if openssl:
    record = copy(ROOT / 'resources' / 'license-sources' / 'openssl' / '3.x' / 'LICENSE', Path('native') / 'openssl-3.x' / 'LICENSE.txt')
    index['nativeLibraries'].append({'name':'OpenSSL 3.x','metadataLicense':'Apache-2.0',
        'binaries':[{'name':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for file in openssl], 'files':[record]})
(OUTPUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'licenseCollection': 'passed', 'pythonVersion': index['pythonVersion'], 'packages': len(index['packages']),
                  'nativeLibraries': len(index['nativeLibraries']),
                  'files': 1 + sum(len(package['files']) for package in index['packages']) + sum(len(native['files']) for native in index['nativeLibraries'])}))
