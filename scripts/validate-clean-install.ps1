$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nsisDirectory = Join-Path $root "src-tauri\target\release\bundle\nsis"
$expectedDisplayName = "InnPilot Validation"
$expectedAppData = [IO.Path]::GetFullPath(
  (Join-Path $env:APPDATA "com.innpilot.validation")
)
$process = $null
$duplicateProcess = $null
$installedByProbe = $false
$ownsProfileCleanup = $false

function Get-ValidationUninstallRecord {
  $records = @(
    Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq $expectedDisplayName }
  )
  if ($records.Count -gt 1) {
    throw "More than one InnPilot Validation uninstall record exists."
  }
  if ($records.Count -eq 1) {
    return $records[0]
  }
  return $null
}

function Assert-ExactValidationProfile([string] $Path) {
  $candidate = [IO.Path]::GetFullPath($Path).TrimEnd("\")
  $expected = $expectedAppData.TrimEnd("\")
  if (-not $candidate.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch an unexpected app-data path: $candidate"
  }
}

function Get-NormalizedFullPath([string] $Path) {
  $value = [IO.Path]::GetFullPath($Path)
  if ($value.StartsWith("\\?\UNC\", [StringComparison]::OrdinalIgnoreCase)) {
    return "\\" + $value.Substring(8)
  }
  if ($value.StartsWith("\\?\", [StringComparison]::OrdinalIgnoreCase)) {
    return $value.Substring(4)
  }
  return $value
}

function Assert-UnderDirectory([string] $Path, [string] $Directory, [string] $Label) {
  $candidate = Get-NormalizedFullPath $Path
  $rootPath = (Get-NormalizedFullPath $Directory).TrimEnd("\") + "\"
  if (-not $candidate.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label is outside the expected directory. Candidate: $candidate Expected root: $rootPath"
  }
}

function Stop-ValidationProcess {
  if ($null -ne $script:duplicateProcess -and -not $script:duplicateProcess.HasExited) {
    Stop-Process -Id $script:duplicateProcess.Id -Force
    $script:duplicateProcess.WaitForExit(10000) | Out-Null
  }
  $script:duplicateProcess = $null
  if ($null -ne $script:process -and -not $script:process.HasExited) {
    Stop-Process -Id $script:process.Id -Force
    $script:process.WaitForExit(10000) | Out-Null
  }
  $script:process = $null
}

function Invoke-SilentInstaller([string] $Path) {
  $result = Start-Process -FilePath $Path -ArgumentList "/S" -PassThru -Wait -WindowStyle Hidden
  if ($result.ExitCode -ne 0) {
    throw "Validation installer exited with code $($result.ExitCode)."
  }
}

function Invoke-SilentUninstall {
  $record = Get-ValidationUninstallRecord
  if ($null -eq $record) {
    return
  }
  $uninstall = [string] $record.UninstallString
  $uninstall = $uninstall.Trim().Trim('"')
  if (-not (Test-Path -LiteralPath $uninstall -PathType Leaf)) {
    throw "Validation uninstaller is missing."
  }
  $result = Start-Process -FilePath $uninstall -ArgumentList "/S" -PassThru -Wait -WindowStyle Hidden
  if ($result.ExitCode -ne 0) {
    throw "Validation uninstaller exited with code $($result.ExitCode)."
  }
}

function Wait-ForFile([string] $Path, [int] $Seconds = 25) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for $Path"
}
function Wait-ForWorkerReadinessProbe(
  [string] $WorkerPath,
  [int] $Seconds = 90,
  [int] $StableSeconds = 3
) {
  $expectedWorker = Get-NormalizedFullPath $WorkerPath
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  $seenProbe = $false
  $idleSince = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $active = @(
      Get-Process -Name "innpilot-worker" -ErrorAction SilentlyContinue |
        Where-Object {
          try {
            (Get-NormalizedFullPath $_.Path).Equals(
              $expectedWorker,
              [StringComparison]::OrdinalIgnoreCase
            )
          }
          catch {
            $false
          }
        }
    )
    if ($active.Count -gt 0) {
      $seenProbe = $true
      $idleSince = $null
    }
    elseif ($seenProbe) {
      if ($null -eq $idleSince) {
        $idleSince = [DateTime]::UtcNow
      }
      elseif (([DateTime]::UtcNow - $idleSince).TotalSeconds -ge $StableSeconds) {
        return
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "The installed app did not complete its packaged-worker readiness probe."
}


$existingRecord = Get-ValidationUninstallRecord
if ($null -ne $existingRecord) {
  throw "InnPilot Validation is already installed. Remove that isolated validation build first."
}
if (Test-Path -LiteralPath $expectedAppData) {
  throw "The isolated InnPilot Validation app-data folder already exists. It was not touched."
}
$ownsProfileCleanup = $true

$installers = @(
  Get-ChildItem -LiteralPath $nsisDirectory -File -ErrorAction Stop |
    Where-Object { $_.Name -match "^InnPilot Validation_.+_x64-setup\.exe$" }
)
if ($installers.Count -ne 1) {
  throw "Expected exactly one InnPilot Validation installer; found $($installers.Count)."
}
$installer = $installers[0].FullName

try {
  Invoke-SilentInstaller $installer
  $installedByProbe = $true

  $record = Get-ValidationUninstallRecord
  if ($null -eq $record) {
    throw "The validation install did not create its isolated uninstall record."
  }
  $installDirectory = ([string] $record.InstallLocation).Trim().Trim('"')
  Assert-UnderDirectory $installDirectory $env:LOCALAPPDATA "Validation installation"
  if ((Split-Path $installDirectory -Leaf) -ne $expectedDisplayName) {
    throw "The validation install used an unexpected directory."
  }

  $worker = Join-Path $installDirectory "worker\innpilot-worker.exe"
  $workerChecksum = Join-Path $installDirectory "worker\innpilot-worker.sha256"
  $thirdPartyNotices = Join-Path $installDirectory "THIRD_PARTY_NOTICES.md"
  foreach ($required in @($worker, $workerChecksum, $thirdPartyNotices)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Packaged resource is missing: $required"
    }
  }

  $declaredDigest = (
    (Get-Content -LiteralPath $workerChecksum -Raw).Trim() -split "\s+"
  )[0].ToLowerInvariant()
  $actualDigest = (Get-FileHash -LiteralPath $worker -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualDigest -ne $declaredDigest) {
    throw "The clean-install worker failed its checksum."
  }

  $forbiddenExtensions = @(
    ".csv", ".doc", ".docx", ".eml", ".jpeg", ".jpg", ".msg", ".ods",
    ".pdf", ".rtf", ".tif", ".tiff", ".xls", ".xlsm", ".xlsx", ".zip"
  )

  $forbidden = @(
    Get-ChildItem -LiteralPath $installDirectory -Recurse -File |
      Where-Object {
        $_.Name -match "^(gmail_token|gmail_credentials|config\.local|connection|device-key)" -or
        $_.Extension.ToLowerInvariant() -in $forbiddenExtensions
      }
  )
  if ($forbidden.Count -gt 0) {
    throw "The validation installer contains forbidden operational data."
  }

  $application = @(
    Get-ChildItem -LiteralPath $installDirectory -File -Filter "*.exe" |
      Where-Object { $_.Name -ne "uninstall.exe" }
  )
  if ($application.Count -ne 1) {
    throw "Expected one installed InnPilot application executable."
  }

  $configPath = Join-Path $expectedAppData "config.json"
  $process = Start-Process -FilePath $application[0].FullName `
    -ArgumentList "--background" -PassThru -WindowStyle Hidden
  Wait-ForFile $configPath
  Wait-ForWorkerReadinessProbe $worker
  if ($process.HasExited) {
    throw "The background launch exited before the runner could remain available."
  }

  $duplicateProcess = Start-Process -FilePath $application[0].FullName `
    -ArgumentList "--background" -PassThru -WindowStyle Hidden
  if (-not $duplicateProcess.WaitForExit(10000)) {
    throw "A second InnPilot process remained active instead of yielding to the existing instance."
  }
  $duplicateProcess = $null
  if ($process.HasExited) {
    throw "The primary InnPilot process exited while handling a second launch."
  }
  Stop-ValidationProcess

  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($config.schemaVersion -ne 2) {
    throw "The clean install generated an unexpected config schema."
  }
  if ($config.client.displayName -ne "Your Hotel") {
    throw "The clean install did not use generic hotel defaults."
  }
  $configuredWorker = [IO.Path]::GetFullPath([string] $config.automation.pythonExecutable)
  Assert-UnderDirectory $configuredWorker $installDirectory "Configured worker"
  if (-not (Test-Path -LiteralPath $configuredWorker -PathType Leaf)) {
    throw "The clean-install configuration points to a missing worker."
  }

  foreach ($privateName in @("device-key.dpapi", "connection.json")) {
    if (Test-Path -LiteralPath (Join-Path $expectedAppData "runner\$privateName")) {
      throw "A fresh, unpaired installation unexpectedly created $privateName."
    }
  }

  $configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
  $sentinel = Join-Path $expectedAppData ".clean-install-validation"
  $sentinelValue = [Guid]::NewGuid().ToString()
  Set-Content -LiteralPath $sentinel -Value $sentinelValue -NoNewline

  Invoke-SilentInstaller $installer
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw "The upgrade removed the isolated app-data marker."
  }
  if ((Get-Content -LiteralPath $sentinel -Raw) -ne $sentinelValue) {
    throw "The upgrade changed the isolated app-data marker."
  }
  if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ne $configHash) {
    throw "The upgrade changed the existing InnPilot configuration."
  }

  Invoke-SilentUninstall
  $installedByProbe = $false
  if ($null -ne (Get-ValidationUninstallRecord)) {
    throw "The validation uninstall record remains after uninstall."
  }
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw "Uninstall removed app data that must remain recoverable."
  }

  [ordered]@{
    installer = $installers[0].Name
    cleanInstall = "passed"
    backgroundLaunch = "passed"
    singleInstance = "passed"
    workerChecksum = $actualDigest
    genericConfig = "passed"
    upgradePreservedConfig = "passed"
    uninstallPreservedAppData = "passed"
    forbiddenOperationalData = 0
  } | ConvertTo-Json
}
finally {
  Stop-ValidationProcess
  if ($installedByProbe) {
    try {
      Invoke-SilentUninstall
    }
    catch {
      Write-Warning "Could not remove the isolated validation install: $_"
    }
  }
  if ($ownsProfileCleanup -and (Test-Path -LiteralPath $expectedAppData)) {
    Assert-ExactValidationProfile $expectedAppData
    Remove-Item -LiteralPath $expectedAppData -Recurse -Force
  }
}
