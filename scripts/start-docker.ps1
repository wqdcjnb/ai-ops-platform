[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$SkipBuild,
  [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$environmentPath = Join-Path $projectDirectory '.env'
$composePath = Join-Path $projectDirectory 'docker-compose.yml'
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)

function Write-AiOpsEnvironmentFile {
  param([string]$Path, [string[]]$Lines)
  [System.IO.File]::WriteAllText($Path, (($Lines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8WithoutBom)
}

function New-AiOpsSecret {
  $bytes = [byte[]]::new(32)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function New-AiOpsPassword {
  $bytes = [byte[]]::new(18)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('='))
}

function Get-AiOpsEnvironmentValue {
  param([string]$Name)
  if (-not (Test-Path -LiteralPath $environmentPath)) { return $null }
  $value = $null
  # .env is UTF-8 without BOM. Windows PowerShell 5.1 otherwise reads ANSI,
  # corrupting Chinese values every time another setting is written.
  foreach ($line in Get-Content -LiteralPath $environmentPath -Encoding UTF8) {
    if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)\s*$')) {
      $value = $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  # Match Compose's last-assignment-wins behavior for older duplicate keys.
  return $value
}

function Set-AiOpsEnvironmentValue {
  param([string]$Name, [string]$Value)
  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $environmentPath) {
    foreach ($existingLine in Get-Content -LiteralPath $environmentPath -Encoding UTF8) {
      [void]$lines.Add([string]$existingLine)
    }
  }
  $expression = '^\s*' + [regex]::Escape($Name) + '\s*='
  $updated = $false
  for ($index = $lines.Count - 1; $index -ge 0; $index -= 1) {
    if ($lines[$index] -match $expression) {
      if ($updated) {
        $lines.RemoveAt($index)
      } else {
        $lines[$index] = "$Name=$Value"
        $updated = $true
      }
    }
  }
  if (-not $updated) {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne '') { $lines.Add('') }
    $lines.Add("$Name=$Value")
  }
  Write-AiOpsEnvironmentFile -Path $environmentPath -Lines $lines.ToArray()
}

function Test-AiOpsPlaceholder {
  param([AllowNull()][string]$Value)
  return [string]::IsNullOrWhiteSpace($Value) -or $Value -match '^(?:replace-with|change-this|example|your-)'
}

function Read-AiOpsAdminEmail {
  do {
    $entered = Read-Host '超级管理员邮箱（直接回车使用 admin@aiops.local）'
    if ([string]::IsNullOrWhiteSpace($entered)) { return 'admin@aiops.local' }
    try {
      $mailAddress = [System.Net.Mail.MailAddress]::new($entered.Trim())
      if ($mailAddress.Address -eq $entered.Trim()) { return $mailAddress.Address.ToLowerInvariant() }
    } catch { }
    Write-Host '请输入有效的邮箱地址。' -ForegroundColor Yellow
  } while ($true)
}

function Read-AiOpsAdminPassword {
  Write-Host '管理员密码可以直接回车，由启动器生成一个安全密码；也可输入至少 12 位英文、数字、点、下划线或连字符。'
  do {
    $entered = Read-Host '管理员密码（回车自动生成）'
    if ([string]::IsNullOrWhiteSpace($entered)) { return New-AiOpsPassword }
    if ($entered -match '^[A-Za-z0-9._-]{12,200}$') { return $entered }
    Write-Host '密码格式不符合要求，请重试。' -ForegroundColor Yellow
  } while ($true)
}

function Read-AiOpsDeploymentSettings {
  $mode = Read-Host '访问范围：1=仅本机（推荐）  2=可信局域网  3=公开测试（临时） [1]'
  if ($mode -eq '3') {
    Write-Host '请配置 HTTPS 反向代理；临时直连测试才需要转发 4174/4175。' -ForegroundColor Yellow
    do {
      $webUrl = Read-Host '请输入公网网页地址，例如 https://demo.example.com:4174'
      try {
        $parsedWebUrl = [Uri]::new($webUrl.Trim().TrimEnd('/'))
        if ($parsedWebUrl.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($parsedWebUrl.Host) -or $parsedWebUrl.AbsolutePath -ne '/' -or $parsedWebUrl.UserInfo -or $parsedWebUrl.Query -or $parsedWebUrl.Fragment) { throw 'invalid' }
        $normalizedWebUrl = $parsedWebUrl.GetLeftPart([UriPartial]::Authority)
        break
      } catch { Write-Host '请输入不带路径的 http:// 或 https:// 地址。' -ForegroundColor Yellow }
    } while ($true)
    do {
      $gatewayUrl = Read-Host '请输入公网网关地址，例如 https://demo.example.com:4175'
      try {
        $parsedGatewayUrl = [Uri]::new($gatewayUrl.Trim().TrimEnd('/'))
        if ($parsedGatewayUrl.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($parsedGatewayUrl.Host) -or $parsedGatewayUrl.AbsolutePath -ne '/' -or $parsedGatewayUrl.UserInfo -or $parsedGatewayUrl.Query -or $parsedGatewayUrl.Fragment) { throw 'invalid' }
        $normalizedGatewayUrl = $parsedGatewayUrl.GetLeftPart([UriPartial]::Authority)
        break
      } catch { Write-Host '请输入不带路径的 http:// 或 https:// 地址。' -ForegroundColor Yellow }
    } while ($true)
    $cookieSecure = if ($parsedWebUrl.Scheme -eq 'https') { 'true' } else { 'false' }
    if ($cookieSecure -eq 'false') { Write-Host '警告：HTTP 公开测试会明文传输登录会话，请仅短时间使用。' -ForegroundColor Yellow }
    return @{ bindAddress = '0.0.0.0'; gatewayBaseUrl = $normalizedGatewayUrl; webBaseUrl = $normalizedWebUrl; cookieSecure = $cookieSecure }
  }
  if ($mode -ne '2') {
    return @{ bindAddress = '127.0.0.1'; gatewayBaseUrl = 'http://127.0.0.1:4175'; webBaseUrl = 'http://127.0.0.1:4174'; cookieSecure = 'false' }
  }

  do {
    $hostName = Read-Host '请输入其他电脑可访问的服务器 IP 或域名，例如 192.168.1.20'
    $hostName = $hostName.Trim().TrimEnd('/')
    if ($hostName -match '^[A-Za-z0-9.-]+$') {
      return @{ bindAddress = '0.0.0.0'; gatewayBaseUrl = "http://${hostName}:4175"; webBaseUrl = "http://${hostName}:4174"; cookieSecure = 'false' }
    }
    Write-Host '请输入 IP 或域名，不要包含 http://、端口或路径。' -ForegroundColor Yellow
  } while ($true)
}

function Initialize-AiOpsEnvironment {
  $created = -not (Test-Path -LiteralPath $environmentPath)
  $initialCredentials = $null
  if ($created) {
    # A missing .env cannot safely be recreated over a known data volume: the
    # encryption secrets and bootstrap password must match the original file.
    $existingVolumes = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw '无法检查已有数据卷，已停止初始化。' }
    if (@($existingVolumes | Where-Object { $_ -in @('ai-ops-platform_platform-data', 'ai-ops-platform_postgres-v2-data', 'ai-ops-platform_redis-v2-data') }).Count -gt 0) {
      throw '检测到已有 AI OPS 数据卷，但 .env 已缺失。请从部署备份恢复原 .env；不要生成新密钥，否则已保存的第三方账号凭据将无法读取。'
    }
    Write-Host ''
    Write-Host '首次启动：正在创建仅保存在本机的 .env 配置。' -ForegroundColor Cyan
    $settings = Read-AiOpsDeploymentSettings
    $adminEmail = Read-AiOpsAdminEmail
    $adminPassword = Read-AiOpsAdminPassword
    $lines = @(
      '# Generated by scripts/start-docker.ps1. Keep this file private.',
      'COMPOSE_PROJECT_NAME=ai-ops-platform',
      "AI_OPS_BIND_ADDRESS=$($settings.bindAddress)",
      'AI_OPS_WEB_PORT=4174',
      'AI_OPS_GATEWAY_PORT=4175',
      '',
      "AUTH_ADMIN_USERNAME=$adminEmail",
      "AUTH_ADMIN_PASSWORD=$adminPassword",
      'AUTH_ADMIN_DISPLAY_NAME=超级管理员',
      "AI_OPS_KEY_ENCRYPTION_SECRET=$(New-AiOpsSecret)",
      "AI_OPS_AUDIT_ENCRYPTION_SECRET=$(New-AiOpsSecret)",
      '',
      "AI_OPS_PUBLIC_GATEWAY_BASE_URL=$($settings.gatewayBaseUrl)",
      "AI_OPS_PUBLIC_WEB_BASE_URL=$($settings.webBaseUrl)",
      "AI_OPS_COOKIE_SECURE=$($settings.cookieSecure)",
      'AI_OPS_GATEWAY_MODE=relay',
      'AI_OPS_GATEWAY_TIMEOUT_MS=60000',
      'AI_OPS_GATEWAY_DEFAULT_STREAMING=false',
      'AI_OPS_CONTEXT_OPTIMIZATION_ENABLED=true',
      'AI_OPS_CONTEXT_MAX_INPUT_CHARS=48000',
      'AI_OPS_CONTEXT_MAX_MESSAGES=24',
      'AI_OPS_RELAY_PROBE_FANOUT=3',
      'AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS=',
      'AI_OPS_ALLOW_INSECURE_EXTERNAL_PROVIDER=false'
    )
    Write-AiOpsEnvironmentFile -Path $environmentPath -Lines $lines
    $initialCredentials = @{ email = $adminEmail; password = $adminPassword }
  }

  $defaults = [ordered]@{
    COMPOSE_PROJECT_NAME = 'ai-ops-platform'
    AI_OPS_BIND_ADDRESS = '127.0.0.1'
    AI_OPS_WEB_PORT = '4174'
    AI_OPS_GATEWAY_PORT = '4175'
    AUTH_ADMIN_USERNAME = 'admin@aiops.local'
    AUTH_ADMIN_DISPLAY_NAME = '超级管理员'
    AI_OPS_PUBLIC_GATEWAY_BASE_URL = 'http://127.0.0.1:4175'
    AI_OPS_PUBLIC_WEB_BASE_URL = 'http://127.0.0.1:4174'
    AI_OPS_CORS_ORIGINS = ''
    AI_OPS_GATEWAY_MODE = 'relay'
    AI_OPS_GATEWAY_TIMEOUT_MS = '60000'
    AI_OPS_GATEWAY_DEFAULT_STREAMING = 'false'
    AI_OPS_CONTEXT_OPTIMIZATION_ENABLED = 'true'
    AI_OPS_CONTEXT_MAX_INPUT_CHARS = '48000'
    AI_OPS_CONTEXT_MAX_MESSAGES = '24'
    AI_OPS_RELAY_PROBE_FANOUT = '3'
    AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS = ''
    AI_OPS_ALLOW_INSECURE_EXTERNAL_PROVIDER = 'false'
  }
  foreach ($entry in $defaults.GetEnumerator()) {
    if ($null -eq (Get-AiOpsEnvironmentValue -Name $entry.Key)) {
      Set-AiOpsEnvironmentValue -Name $entry.Key -Value $entry.Value
    }
  }

  if ($null -eq (Get-AiOpsEnvironmentValue -Name 'AI_OPS_COOKIE_SECURE')) {
    $webUrl = [Uri]::new((Get-AiOpsEnvironmentValue -Name 'AI_OPS_PUBLIC_WEB_BASE_URL'))
    $cookieSecure = if ($webUrl.Scheme -eq 'https') { 'true' } else { 'false' }
    Set-AiOpsEnvironmentValue -Name 'AI_OPS_COOKIE_SECURE' -Value $cookieSecure
  }

  foreach ($secretName in @('AI_OPS_KEY_ENCRYPTION_SECRET', 'AI_OPS_AUDIT_ENCRYPTION_SECRET')) {
    if (Test-AiOpsPlaceholder (Get-AiOpsEnvironmentValue -Name $secretName)) {
      $projectName = Get-AiOpsEnvironmentValue -Name 'COMPOSE_PROJECT_NAME'
      $existingVolumes = @(& docker volume ls --format '{{.Name}}')
      if ($LASTEXITCODE -ne 0) { throw '无法检查已有数据卷，已停止生成密钥。' }
      if ($existingVolumes -contains "${projectName}_platform-data" -or $existingVolumes -contains "${projectName}_postgres-v2-data") {
        throw "$secretName 缺失，但已有平台数据。请从备份恢复原加密密钥，不能为旧数据生成新密钥。"
      }
      Set-AiOpsEnvironmentValue -Name $secretName -Value (New-AiOpsSecret)
      Write-Host "$secretName 已生成新的本机密钥。" -ForegroundColor Cyan
    }
  }

  # Add database credentials without changing any existing application key,
  # employee Key, administrator password or encryption secret.
  foreach ($storage in @(
    @{ Name = 'POSTGRES_PASSWORD'; Volume = 'postgres-v2-data' },
    @{ Name = 'REDIS_PASSWORD'; Volume = 'redis-v2-data' }
  )) {
    $value = Get-AiOpsEnvironmentValue -Name $storage.Name
    if (Test-AiOpsPlaceholder $value) {
      $projectName = Get-AiOpsEnvironmentValue -Name 'COMPOSE_PROJECT_NAME'
      $volumeName = "${projectName}_$($storage.Volume)"
      $foundVolumes = & docker volume ls --format '{{.Name}}'
      if ($foundVolumes -contains $volumeName) { throw "$($storage.Name) 缺失，但已有数据库数据卷。请恢复原 .env，不要重新生成数据库密码。" }
      Set-AiOpsEnvironmentValue -Name $storage.Name -Value (New-AiOpsSecret)
      Write-Host "$($storage.Name) 已生成并保存在本机 .env。" -ForegroundColor Cyan
    } elseif ($value -notmatch '^[A-Za-z0-9._-]{16,200}$') {
      throw "$($storage.Name) 应使用至少 16 位英文、数字、点、下划线或连字符，以安全构造容器连接地址。"
    }
  }

  if (Test-AiOpsPlaceholder (Get-AiOpsEnvironmentValue -Name 'AUTH_ADMIN_PASSWORD')) {
    $adminPassword = Read-AiOpsAdminPassword
    Set-AiOpsEnvironmentValue -Name 'AUTH_ADMIN_PASSWORD' -Value $adminPassword
    $initialCredentials = @{ email = (Get-AiOpsEnvironmentValue -Name 'AUTH_ADMIN_USERNAME'); password = $adminPassword }
  }

  return $initialCredentials
}

function Select-AiOpsComposeCommand {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) { throw '未找到 Docker。请先安装并启动 Docker Desktop。' }

  & cmd.exe /d /c 'docker version --format "{{.Server.Version}}" >NUL 2>NUL'
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop 尚未启动。请启动 Docker Desktop 后重试。' }

  # Run the probe through cmd.exe so an older Docker CLI's stderr does not
  # become a terminating PowerShell native-command error.
  & cmd.exe /d /c 'docker compose version >NUL 2>NUL'
  if ($LASTEXITCODE -eq 0) { return 'plugin' }
  if (Get-Command docker-compose -ErrorAction SilentlyContinue) { return 'legacy' }
  throw 'Docker Compose 不可用。请升级或重新安装 Docker Desktop。'
}

function Invoke-AiOpsCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)
  if ($script:composeCommand -eq 'plugin') { & docker compose @ComposeArguments } else { & docker-compose @ComposeArguments }
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 命令执行失败。' }
}

function Wait-AiOpsHttpService {
  param([string]$Url, [string]$ServiceName)
  $deadline = (Get-Date).AddSeconds(90)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
    } catch { }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "$ServiceName 未能在 90 秒内就绪：$Url"
}

Push-Location $projectDirectory
try {
  $script:composeCommand = Select-AiOpsComposeCommand
  $firstCredentials = Initialize-AiOpsEnvironment
  if ($PrepareOnly) { Write-Host '环境配置已准备，未重启服务。'; return }
  $upArguments = @('-f', $composePath, 'up', '-d', '--remove-orphans')
  if (-not $SkipBuild) { $upArguments += '--build' }
  Write-Host '正在启动 AI OPS Docker 服务…' -ForegroundColor Cyan
  Invoke-AiOpsCompose @upArguments

  $webPort = Get-AiOpsEnvironmentValue -Name 'AI_OPS_WEB_PORT'
  $gatewayPort = Get-AiOpsEnvironmentValue -Name 'AI_OPS_GATEWAY_PORT'
  $localWebUrl = "http://127.0.0.1:$webPort/"
  Wait-AiOpsHttpService -Url "http://127.0.0.1:$gatewayPort/health" -ServiceName 'AI OPS 网关'
  Wait-AiOpsHttpService -Url $localWebUrl -ServiceName 'AI OPS 管理界面'
  $webUrl = (Get-AiOpsEnvironmentValue -Name 'AI_OPS_PUBLIC_WEB_BASE_URL').TrimEnd('/') + '/'

  Write-Host ''
  Write-Host "AI OPS 已启动：$webUrl" -ForegroundColor Green
  Write-Host "员工网关地址：$(Get-AiOpsEnvironmentValue -Name 'AI_OPS_PUBLIC_GATEWAY_BASE_URL')" -ForegroundColor Green
  if ($firstCredentials) {
    Write-Host ''
    Write-Host '请立即保存首次超级管理员凭据；启动器不会再次显示密码。' -ForegroundColor Yellow
    Write-Host "邮箱：$($firstCredentials.email)" -ForegroundColor Yellow
    Write-Host "密码：$($firstCredentials.password)" -ForegroundColor Yellow
  }
  if (-not $NoBrowser) { Start-Process $webUrl }
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  Pop-Location
}
