[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4176
)

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$connectorScript = Join-Path $scriptDirectory 'ai-ops-workbuddy-connector.mjs'
$healthUrl = "http://127.0.0.1:$Port/health"

function Test-AiOpsLocalClientConnector {
  try {
    $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 2
    $clients = @($health.clients)
    return $health.status -eq 'ok' -and $health.service -eq 'ai-ops-workbuddy-connector' -and $clients -contains 'workbuddy' -and $clients -contains 'codex'
  } catch {
    return $false
  }
}

if (Test-AiOpsLocalClientConnector) {
  Write-Output "AI OPS local client connector is already ready on port $Port."
  exit 0
}

$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $listenerProcessId = @($listener)[0].OwningProcess
  $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" -ErrorAction SilentlyContinue
  $isPreviousAiOpsConnector = $listenerProcess -and $listenerProcess.CommandLine -match [regex]::Escape('ai-ops-workbuddy-connector.mjs')
  if (-not $isPreviousAiOpsConnector) {
    Write-Error "Port $Port is occupied by another local process. AI OPS local client connector was not started."
    exit 1
  }
  # The process is a known older AI OPS connector. Restart only that exact
  # listener so newly added Codex endpoints become available.
  Stop-Process -Id $listenerProcessId -Force
  Start-Sleep -Milliseconds 250
}

if (-not (Test-Path -LiteralPath $connectorScript)) {
  Write-Error 'AI OPS local client connector script is missing.'
  exit 1
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logDirectory = Join-Path $env:LOCALAPPDATA 'AI OPS'
$standardOutput = Join-Path $logDirectory 'local-client-connector.log'
$standardError = Join-Path $logDirectory 'local-client-connector-error.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @("`"$connectorScript`"") `
  -WorkingDirectory $projectDirectory `
  -WindowStyle Hidden `
  -RedirectStandardOutput $standardOutput `
  -RedirectStandardError $standardError `
  -PassThru

$deadline = (Get-Date).AddSeconds(8)
do {
  Start-Sleep -Milliseconds 200
  if (Test-AiOpsLocalClientConnector) {
    Write-Output "AI OPS local client connector started on port $Port (PID $($process.Id))."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Error "AI OPS local client connector did not become ready. See $standardError."
exit 1
