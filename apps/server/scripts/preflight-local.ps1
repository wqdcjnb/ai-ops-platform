param(
  [int]$WebPort = 4174,
  [int]$ServerPort = 4175,
  [switch]$SkipHealth
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = Split-Path -Parent $scriptRoot
$envPath = Join-Path $serverRoot '.env.local'
$dbPath = Join-Path $serverRoot 'data\platform.sqlite'

function Read-LocalEnv([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$Matches[1]] = $value
    }
  }
  return $values
}

function Test-Flag([hashtable]$Values, [string]$Name, [string]$Expected) {
  if (-not $Values.ContainsKey($Name)) {
    Write-Host "FAIL  $Name is missing from .env.local" -ForegroundColor Red
    return $false
  }
  if ($Values[$Name] -ne $Expected) {
    Write-Host "FAIL  $Name must be $Expected for internal testing" -ForegroundColor Red
    return $false
  }
  Write-Host "PASS  $Name=$Expected" -ForegroundColor Green
  return $true
}

function Test-Port([int]$Port, [string]$Label) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    Write-Host "PASS  $Label is listening on 127.0.0.1:$Port" -ForegroundColor Green
    return $true
  }
  Write-Host "WARN  $Label is not listening on 127.0.0.1:$Port (start it before browser testing)" -ForegroundColor Yellow
  return $true
}

function Test-Health([int]$Port, [string]$Path) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port$Path" -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      Write-Host "PASS  $Path responded with HTTP 200" -ForegroundColor Green
      return $true
    }
    Write-Host "FAIL  $Path responded with HTTP $($response.StatusCode)" -ForegroundColor Red
    return $false
  } catch {
    Write-Host "WARN  $Path is not reachable yet; start the BFF before browser testing" -ForegroundColor Yellow
    return $true
  }
}

Write-Host 'AI OPS local release preflight' -ForegroundColor Cyan
Write-Host "Config: $envPath"

$failures = 0
$values = Read-LocalEnv $envPath
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  Write-Host 'FAIL  apps/server/.env.local is missing' -ForegroundColor Red
  $failures++
}
if (-not (Test-Flag $values 'AI_OPS_ADMIN_ONLY' 'true')) { $failures++ }
if (-not (Test-Flag $values 'AI_OPS_SEED_DEMO_DATA' 'false')) { $failures++ }
if (-not (Test-Flag $values 'AI_OPS_SOFT_QUOTA_ENABLED' 'false')) { $failures++ }

if ($values.ContainsKey('AUTH_MODE') -and $values['AUTH_MODE'] -eq 'disabled') {
  Write-Host 'FAIL  AUTH_MODE=disabled is not allowed for internal release' -ForegroundColor Red
  $failures++
} else {
  Write-Host 'PASS  authentication remains enabled' -ForegroundColor Green
}

if (Test-Path -LiteralPath $dbPath -PathType Leaf) {
  Write-Host "PASS  SQLite database exists: $dbPath" -ForegroundColor Green
} else {
  Write-Host "FAIL  SQLite database is missing: $dbPath" -ForegroundColor Red
  $failures++
}

[void](Test-Port $WebPort 'web')
[void](Test-Port $ServerPort 'BFF')
if (-not $SkipHealth) {
  [void](Test-Health $ServerPort '/health')
  [void](Test-Health $ServerPort '/gateway/health')
}

if ($failures -gt 0) {
  Write-Host "Preflight failed with $failures blocking issue(s)." -ForegroundColor Red
  exit 1
}
Write-Host 'Preflight passed. This environment is limited to local administrator testing.' -ForegroundColor Green
