$ErrorActionPreference = 'Stop'

# Load function definitions only: never run the launcher or contact Docker.
$launcherPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-docker.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Launcher syntax errors.' }
foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($definition.Extent.Text))
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw $Message }
}

$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ai-ops-env-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$environmentPath = Join-Path $testDirectory '.env'
$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
# ASCII source also runs under Windows PowerShell 5.1 on any system code page.
$displayName = -join ([char[]]@(0x8D85, 0x7EA7, 0x7BA1, 0x7406, 0x5458))
try {
  Write-AiOpsEnvironmentFile -Path $environmentPath -Lines @(
    '# Preserve this comment.',
    "AUTH_ADMIN_DISPLAY_NAME=$displayName",
    'TEST_SECRET=fixture-only-secret',
    'TEST_FLAG=first',
    'TEST_FLAG=last'
  )
  Assert-Equal (Get-AiOpsEnvironmentValue 'TEST_FLAG') 'last' 'Duplicate reads must match Compose.'
  for ($index = 0; $index -lt 20; $index += 1) {
    Set-AiOpsEnvironmentValue -Name 'TEST_FLAG' -Value "value-$index"
  }
  Assert-Equal (Get-AiOpsEnvironmentValue 'AUTH_ADMIN_DISPLAY_NAME') $displayName 'Repeated writes corrupted UTF-8.'
  Assert-Equal (Get-AiOpsEnvironmentValue 'TEST_SECRET') 'fixture-only-secret' 'Unrelated values changed.'
  $lines = @(Get-Content -LiteralPath $environmentPath -Encoding UTF8)
  Assert-Equal (@($lines | Where-Object { $_ -match '^TEST_FLAG=' }).Count) 1 'Duplicate assignment survived update.'
  Assert-Equal $lines[0] '# Preserve this comment.' 'Comment was lost.'
  $bytes = [IO.File]::ReadAllBytes($environmentPath)
  if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw '.env must remain UTF-8 without BOM.' }

  # Exercise the interactive settings with fake answers, not operator input.
  $answers = [System.Collections.Generic.Queue[string]]::new()
  function Read-Host { param([string]$Prompt) return $answers.Dequeue() }
  foreach ($answer in @('3', 'https://ops.example.com/?invalid=1', 'https://ops.example.com/', 'https://gateway.example.com/')) { $answers.Enqueue($answer) }
  $settings = Read-AiOpsDeploymentSettings
  Assert-Equal $settings.webBaseUrl 'https://ops.example.com' 'Web URL validation/normalization failed.'
  Assert-Equal $settings.gatewayBaseUrl 'https://gateway.example.com' 'Gateway URL normalization failed.'
  Assert-Equal $settings.cookieSecure 'true' 'HTTPS must use Secure cookies.'
  Assert-Equal $answers.Count 0 'URL with a query was silently accepted.'
  foreach ($answer in @('2', 'lan.example.test')) { $answers.Enqueue($answer) }
  $settings = Read-AiOpsDeploymentSettings
  Assert-Equal $settings.webBaseUrl 'http://lan.example.test:4174' 'LAN URL is incorrect.'
  Assert-Equal $settings.cookieSecure 'false' 'HTTP LAN cannot use Secure cookies.'
  Write-Host 'PASS: UTF-8 round trips, duplicate keys, preserved settings, HTTPS and HTTP deployment settings.'
} finally {
  # Only remove the exact fixture file and now-empty directory created above.
  $resolvedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
  $resolvedEnvironmentPath = [IO.Path]::GetFullPath($environmentPath)
  if ([IO.Path]::GetDirectoryName($resolvedEnvironmentPath) -ne $resolvedTestDirectory) { throw 'Unexpected fixture path.' }
  if (Test-Path -LiteralPath $resolvedEnvironmentPath) { Remove-Item -LiteralPath $resolvedEnvironmentPath }
  Remove-Item -LiteralPath $resolvedTestDirectory
}
