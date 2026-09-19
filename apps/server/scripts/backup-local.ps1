param(
  [string]$DatabasePath,
  [string]$BackupRoot
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = Split-Path -Parent $scriptRoot
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { $DatabasePath = Join-Path $serverRoot 'data\platform.sqlite' }
if ([string]::IsNullOrWhiteSpace($BackupRoot)) { $BackupRoot = Join-Path $serverRoot 'data\backups' }

function Get-CanonicalPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-Sha256([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose() }
  }
  finally { $sha.Dispose() }
}

$source = Get-CanonicalPath $DatabasePath
$root = Get-CanonicalPath $BackupRoot
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "SQLite database not found: $source"
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Get-CanonicalPath (Join-Path $root "platform-$stamp")
if (-not $destination.StartsWith($root.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup destination escaped the configured backup root.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null

$sourceFiles = @($source, "$source-wal", "$source-shm") | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
$manifestFiles = @()
foreach ($file in $sourceFiles) {
  $target = Join-Path $destination ([System.IO.Path]::GetFileName($file))
  Copy-Item -LiteralPath $file -Destination $target -Force
  $manifestFiles += [ordered]@{
    name = [System.IO.Path]::GetFileName($file)
    sizeBytes = (Get-Item -LiteralPath $target).Length
    sha256 = Get-Sha256 $target
  }
}

$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceDatabase = $source
  backupDirectory = $destination
  files = $manifestFiles
  scope = 'local SQLite only; no .env.local, token, password, or production data copied'
}
$manifestPath = Join-Path $destination 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Local SQLite backup created: $destination" -ForegroundColor Green
Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan
