$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPython = Join-Path $taskRoot '.venv-ocr\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Create .venv-ocr with Python 3.12 and install worker/requirements.txt first. See README.' }
$taskBase = & $taskPython -c 'import sys; print(sys.base_prefix)'
$taskExtra = @()
foreach ($taskNativeName in @('ffi.dll', 'libbz2.dll', 'liblzma.dll')) {
  $taskNativePath = Join-Path $taskBase ('Library\bin\' + $taskNativeName)
  if (Test-Path -LiteralPath $taskNativePath) { $taskExtra += @('--add-binary', "$taskNativePath;.") }
}
& $taskPython -m PyInstaller --noconfirm --onedir --console --name league-ocr --collect-all rapidocr_onnxruntime --collect-all onnxruntime @taskExtra --distpath worker/dist --workpath worker/build --specpath worker worker/recognizer.py
if ($LASTEXITCODE -ne 0) { throw 'OCR packaging failed. The release component is not ready.' }
