$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPython = Join-Path $taskRoot '.venv-ocr\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Create .venv-ocr with Python 3.12 and install worker/requirements.txt first. See README.' }
$taskBase = & $taskPython -c 'import sys; print(sys.base_prefix)'
$taskFfi = Join-Path $taskBase 'Library\bin\ffi.dll'
$taskExtra = @()
if (Test-Path -LiteralPath $taskFfi) { $taskExtra = @('--add-binary', "$taskFfi;.") }
& $taskPython -m PyInstaller --noconfirm --onedir --console --name league-ocr --collect-all rapidocr_onnxruntime --collect-all onnxruntime @taskExtra --distpath worker/dist --workpath worker/build --specpath worker worker/recognizer.py
if ($LASTEXITCODE -ne 0) { throw 'OCR packaging failed. The release component is not ready.' }
