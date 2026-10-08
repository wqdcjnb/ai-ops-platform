[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$composePath = Join-Path $projectDirectory 'docker-compose.yml'
$environmentPath = Join-Path $projectDirectory '.env'
if (-not (Test-Path -LiteralPath $environmentPath)) { throw '未找到 .env。请先运行 start-docker.cmd。' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker。' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $projectDirectory 'backups' }

function Get-AiOpsContainer([string]$Service) {
  $arguments = @('-f', $composePath, 'ps', '-q', $Service)
  & cmd.exe /d /c 'docker compose version >NUL 2>NUL'
  if ($LASTEXITCODE -eq 0) { $result = & docker compose @arguments }
  elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { $result = & docker-compose @arguments }
  else { throw 'Docker Compose 不可用。' }
  if ($LASTEXITCODE -ne 0 -or -not $result) { throw "$Service 容器未运行。" }
  return ($result | Select-Object -First 1).Trim()
}

Push-Location $projectDirectory
try {
  $postgres = Get-AiOpsContainer 'postgres'
  $server = Get-AiOpsContainer 'server'
  $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
  $destination = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) "ai-ops-$stamp"
  New-Item -ItemType Directory -Path $destination | Out-Null
  $dump = "/tmp/ai-ops-$stamp.dump"
  $archive = "/tmp/ai-ops-$stamp.tar.gz"
  try {
    # Consistent online snapshot. Never redirect binary through PowerShell 5.1.
    & docker exec $postgres pg_dump -U ai_ops -d ai_ops --format=custom --no-owner --no-acl --file=$dump
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 备份失败。' }
    & docker exec $postgres pg_restore --list $dump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 备份目录校验失败。' }
    & docker cp "${postgres}:$dump" (Join-Path $destination 'platform.dump')
    if ($LASTEXITCODE -ne 0) { throw '复制 PostgreSQL 备份失败。' }
    # Now migration/rollback material, not the live DB.
    & docker exec $server tar -C /app -czf $archive data
    if ($LASTEXITCODE -ne 0) { throw '打包迁移保留文件失败。' }
    & docker cp "${server}:$archive" (Join-Path $destination 'legacy-data.tar.gz')
    if ($LASTEXITCODE -ne 0) { throw '复制迁移保留文件失败。' }
    Copy-Item -LiteralPath $environmentPath -Destination (Join-Path $destination '.env')
    $manifest = [ordered]@{
      createdAt = (Get-Date).ToUniversalTime().ToString('o')
      engine = 'PostgreSQL 18'
      files = @(Get-ChildItem -LiteralPath $destination -File -Force | ForEach-Object {
        [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
      })
    }
    [IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  } finally {
    # Exact temporary files created above, never database volumes.
    & docker exec $postgres rm -f $dump | Out-Null
    & docker exec $server rm -f $archive | Out-Null
  }
  Write-Host "备份已创建并校验：$destination" -ForegroundColor Green
  Write-Host '包含数据库、第三方账号加密凭据及私有 .env，请按密码文件保管，勿发送或提交。Redis 无需恢复。' -ForegroundColor Yellow
} finally { Pop-Location }
