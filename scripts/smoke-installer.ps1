$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Encoding utf8 | ConvertFrom-Json
$taskExecutable = 'PearljamHex'
# Installs made before the PEARLJAM HEX rename also count as existing installs.
$taskLegacyProduct = -join ([char[]](0x82F1, 0x96C4, 0x8054, 0x76DF, 0x52A9, 0x624B))
$taskLegacyExecutable = 'LeagueAssistantCN'
$taskTarget = [IO.Path]::GetFullPath((Join-Path $taskRoot 'artifacts\installer-smoke'))
if (-not $taskTarget.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Rejected installation test path' }
if (Test-Path -LiteralPath $taskTarget) { throw 'Test target already exists; inspect it before retrying' }
$taskExisting = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like ($taskPackage.productName + '*') -or $_.DisplayName -like ($taskExecutable + '*') -or $_.DisplayName -like ($taskLegacyProduct + '*') -or $_.DisplayName -like ($taskLegacyExecutable + '*') }
if ($taskExisting) { throw 'An installation already exists; installer smoke test skipped' }
foreach ($taskShortcutDirectory in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  foreach ($taskShortcutName in @($taskPackage.productName, $taskLegacyProduct)) {
    if (Test-Path -LiteralPath (Join-Path $taskShortcutDirectory ($taskShortcutName + '.lnk'))) { throw 'An existing product shortcut was found; test skipped' }
  }
}
# The user data folder keeps the pre-rename name (see src/main/index.ts).
$taskSettings = Join-Path $env:APPDATA ($taskLegacyProduct + '\local\settings.json')
$taskBefore = if (Test-Path -LiteralPath $taskSettings) { (Get-FileHash -LiteralPath $taskSettings -Algorithm SHA256).Hash } else { '' }
$taskInstaller = Join-Path $taskRoot ("dist\PearljamHex-" + $taskPackage.version + '-x64-Setup.exe')
$taskOcrVerified = $false
$taskLicenseCount = 0
try {
  $taskInstall = Start-Process -FilePath $taskInstaller -ArgumentList @('/S', '/CURRENTUSER', "/D=$taskTarget") -WindowStyle Hidden -Wait -PassThru
  if ($taskInstall.ExitCode -ne 0) { throw "Installer exit code: $($taskInstall.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $taskTarget ($taskExecutable + '.exe')))) { throw 'Installed executable missing' }
  $taskHealth = & (Join-Path $taskTarget 'resources\ocr\league-ocr.exe') --healthcheck
  if ($LASTEXITCODE -ne 0 -or $taskHealth -notmatch '"ocr_ready": true') { throw 'Installed OCR health check failed' }
  $taskOcrVerified = $true
  $taskLicenseRoot = [IO.Path]::GetFullPath((Join-Path $taskTarget 'resources\third-party-licenses'))
  $taskLicenseIndex = Get-Content -LiteralPath (Join-Path $taskLicenseRoot 'index.json') -Encoding UTF8 | ConvertFrom-Json
  $taskLicenseRecords = @($taskLicenseIndex.pythonLicense) + @($taskLicenseIndex.packages | ForEach-Object { $_.files }) + @($taskLicenseIndex.nativeLibraries | ForEach-Object { $_.files })
  foreach ($taskLicenseRecord in $taskLicenseRecords) {
    $taskLicensePath = [IO.Path]::GetFullPath((Join-Path $taskLicenseRoot $taskLicenseRecord.path))
    if (-not $taskLicensePath.StartsWith($taskLicenseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Rejected license manifest path' }
    if ((Get-FileHash -LiteralPath $taskLicensePath -Algorithm SHA256).Hash -ne $taskLicenseRecord.sha256) { throw 'Installed license checksum differs from manifest' }
    $taskLicenseCount++
  }
  if ($taskLicenseCount -lt 1) { throw 'Installed license collection is empty' }
} finally {
  # This uninstaller only operates on the new, checked directory above.
  $taskUninstaller = Join-Path $taskTarget ('Uninstall ' + $taskExecutable + '.exe')
  if (Test-Path -LiteralPath $taskUninstaller) {
    $taskUninstall = Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($taskUninstall.ExitCode -ne 0) { throw "Uninstaller exit code: $($taskUninstall.ExitCode)" }
    for ($taskAttempt = 0; $taskAttempt -lt 50 -and (Test-Path -LiteralPath (Join-Path $taskTarget ($taskExecutable + '.exe'))); $taskAttempt++) { Start-Sleep -Milliseconds 200 }
  }
}
if (Test-Path -LiteralPath (Join-Path $taskTarget ($taskExecutable + '.exe'))) { throw 'Test executable remains after uninstall' }
$taskAfter = if (Test-Path -LiteralPath $taskSettings) { (Get-FileHash -LiteralPath $taskSettings -Algorithm SHA256).Hash } else { '' }
if ($taskAfter -ne $taskBefore) { throw 'User settings changed during installer test' }
@{ installer = 'passed'; installedOcr = $taskOcrVerified; installedLicenses = $taskLicenseCount; uninstalled = $true; userSettingsPreserved = $true } | ConvertTo-Json -Compress
