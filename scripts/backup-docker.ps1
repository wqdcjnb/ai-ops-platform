[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$composePath = Join-Path $projectDirectory 'docker-compose.yml'
$environmentPath = Join-Path $projectDirectory '.env'

function Get-AiOpsServerContainerId {
  $arguments = @('-f', $composePath, 'ps', '-q', 'server')
  & cmd.exe /d /c 'docker compose version >NUL 2>NUL'
  if ($LASTEXITCODE -eq 0) {
    $result = & docker compose @arguments
  } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $result = & docker-compose @arguments
  } else {
    throw 'Docker Compose 不可用。'
  }
  if ($LASTEXITCODE -ne 0) { throw '无法读取 AI OPS server 容器状态。' }
  return ($result | Select-Object -First 1).Trim()
}

if (-not (Test-Path -LiteralPath $environmentPath)) { throw '未找到 .env。请先运行 start-docker.cmd。' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $projectDirectory 'backups' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker。' }

Push-Location $projectDirectory
try {
  $containerId = Get-AiOpsServerContainerId
  if ([string]::IsNullOrWhiteSpace($containerId)) { throw 'AI OPS server 容器未运行。请先运行 start-docker.cmd。' }

  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $archiveFile = Join-Path $OutputDirectory "ai-ops-data-$timestamp.tar.gz"
  $temporaryArchive = "/tmp/ai-ops-data-$timestamp.tar.gz"
  $containerId = $containerId.Trim()

  & docker exec $containerId sh -c "tar -C /app -czf $temporaryArchive data"
  if ($LASTEXITCODE -ne 0) { throw '无法在 server 容器中打包数据。' }
  try {
    & docker cp "${containerId}:$temporaryArchive" $archiveFile
    if ($LASTEXITCODE -ne 0) { throw '无法复制 AI OPS 数据备份到主机。' }
  } finally {
    & docker exec $containerId rm -f $temporaryArchive | Out-Null
  }

  Write-Host "备份已创建：$archiveFile" -ForegroundColor Green
  Write-Host '备份包含 SQLite 数据库与加密后的第三方账号配置，请妥善保管。' -ForegroundColor Yellow
} finally {
  Pop-Location
}
