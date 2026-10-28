$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Encoding utf8 | ConvertFrom-Json
$taskExecutable = 'LeagueAssistantCN'
$taskTarget = [IO.Path]::GetFullPath((Join-Path $taskRoot 'artifacts\installer-smoke'))
if (-not $taskTarget.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Rejected installation test path' }
if (Test-Path -LiteralPath $taskTarget) { throw 'Test target already exists; inspect it before retrying' }
$taskExisting = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like ($taskPackage.productName + '*') -or $_.DisplayName -like ($taskExecutable + '*') }
if ($taskExisting) { throw 'An installation already exists; installer smoke test skipped' }
foreach ($taskShortcutDirectory in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (Test-Path -LiteralPath (Join-Path $taskShortcutDirectory ($taskPackage.productName + '.lnk'))) { throw 'An existing product shortcut was found; test skipped' }
}
$taskSettings = Join-Path $env:APPDATA ($taskPackage.productName + '\local\settings.json')
$taskBefore = if (Test-Path -LiteralPath $taskSettings) { (Get-FileHash -LiteralPath $taskSettings -Algorithm SHA256).Hash } else { '' }
$taskInstaller = Join-Path $taskRoot ("dist\LeagueAssistantCN-" + $taskPackage.version + '-x64-Setup.exe')
$taskOcrVerified = $false
try {
  $taskInstall = Start-Process -FilePath $taskInstaller -ArgumentList @('/S', '/CURRENTUSER', "/D=$taskTarget") -WindowStyle Hidden -Wait -PassThru
  if ($taskInstall.ExitCode -ne 0) { throw "Installer exit code: $($taskInstall.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $taskTarget 'LeagueAssistantCN.exe'))) { throw 'Installed executable missing' }
  $taskHealth = & (Join-Path $taskTarget 'resources\ocr\league-ocr.exe') --healthcheck
  if ($LASTEXITCODE -ne 0 -or $taskHealth -notmatch '"ocr_ready": true') { throw 'Installed OCR health check failed' }
  $taskOcrVerified = $true
} finally {
  # This uninstaller only operates on the new, checked directory above.
  $taskUninstaller = Join-Path $taskTarget ('Uninstall ' + $taskExecutable + '.exe')
  if (Test-Path -LiteralPath $taskUninstaller) {
    $taskUninstall = Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($taskUninstall.ExitCode -ne 0) { throw "Uninstaller exit code: $($taskUninstall.ExitCode)" }
    for ($taskAttempt = 0; $taskAttempt -lt 50 -and (Test-Path -LiteralPath (Join-Path $taskTarget 'LeagueAssistantCN.exe')); $taskAttempt++) { Start-Sleep -Milliseconds 200 }
  }
}
if (Test-Path -LiteralPath (Join-Path $taskTarget 'LeagueAssistantCN.exe')) { throw 'Test executable remains after uninstall' }
$taskAfter = if (Test-Path -LiteralPath $taskSettings) { (Get-FileHash -LiteralPath $taskSettings -Algorithm SHA256).Hash } else { '' }
if ($taskAfter -ne $taskBefore) { throw 'User settings changed during installer test' }
@{ installer = 'passed'; installedOcr = $taskOcrVerified; uninstalled = $true; userSettingsPreserved = $true } | ConvertTo-Json -Compress
