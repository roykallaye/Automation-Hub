param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $TargetsBase64
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

try {
  $json = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($TargetsBase64)
  )
  $decodedTargets = $json | ConvertFrom-Json
  $targets = @($decodedTargets | ForEach-Object { $_ })
} catch {
  throw "Signature targets are not valid encoded JSON."
}

$results = @(
  foreach ($target in $targets) {
    $path = [string] $target.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "A required signature target is missing: $([string] $target.role) ($([IO.Path]::GetFileName($path)))."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    $signer = $signature.SignerCertificate
    $timestamp = $signature.TimeStamperCertificate
    [PSCustomObject]@{
      role = [string] $target.role
      fileName = [IO.Path]::GetFileName($path)
      status = $signature.Status.ToString()
      signerSubject = if ($null -eq $signer) { $null } else { $signer.Subject }
      signerThumbprint = if ($null -eq $signer) { $null } else { $signer.Thumbprint }
      timestamped = $null -ne $timestamp
      timestampSubject = if ($null -eq $timestamp) { $null } else { $timestamp.Subject }
    }
  }
)

$results | ConvertTo-Json -Compress -Depth 4
