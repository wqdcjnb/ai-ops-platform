[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$LaunchUri,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-AiOpsAssistantDirectory {
  return (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'AI OPS')
}

function Write-AiOpsAssistantLog {
  param([string]$Stage)
  try {
    $directory = Get-AiOpsAssistantDirectory
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Add-Content -LiteralPath (Join-Path $directory 'assistant.log') -Value "$(Get-Date -Format o) $Stage" -Encoding utf8
  } catch {
    # A failed diagnostic write must never interrupt a configuration request.
  }
}

function ConvertFrom-AiOpsLaunchUri {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { throw '缺少本机配置请求。' }
  try { $uri = [Uri]$Value } catch { throw '本机配置请求格式无效。' }
  if ($uri.Scheme -ne 'aiops' -or $uri.Host -ne 'configure') { throw '本机配置请求不受支持。' }

  $query = @{}
  foreach ($part in $uri.Query.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries)) {
    $pair = $part.Split('=', 2)
    if ($pair.Count -eq 2) { $query[[Uri]::UnescapeDataString($pair[0])] = [Uri]::UnescapeDataString($pair[1]) }
  }
  $ticket = [string]$query['ticket']
  $serverValue = [string]$query['server']
  if ($ticket -notmatch '^[A-Za-z0-9_-]{40,128}$') { throw '本机配置请求已损坏。' }
  try { $server = [Uri]$serverValue } catch { throw 'AI OPS 服务地址无效。' }
  if ($server.Scheme -notin @('http', 'https') -or -not $server.Host -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath -notin @('', '/')) {
    throw 'AI OPS 服务地址无效。'
  }
  return [pscustomobject]@{
    Ticket = $ticket
    ServerUrl = $server.GetLeftPart([UriPartial]::Authority)
  }
}

function Invoke-AiOpsJson {
  param(
    [string]$Uri,
    [hashtable]$Body
  )
  return Invoke-RestMethod -Uri $Uri -Method Post -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 20 -ErrorAction Stop
}

function Normalize-AiOpsResponsesUrl {
  param([string]$GatewayBaseUrl)
  try { $url = [Uri]$GatewayBaseUrl } catch { throw 'AI OPS 网关地址无效。' }
  if ($url.Scheme -notin @('http', 'https') -or -not $url.Host -or $url.UserInfo) { throw 'AI OPS 网关地址无效。' }
  $path = $url.AbsolutePath.TrimEnd('/')
  if ($path.EndsWith('/v1/responses')) { $path = $path.Substring(0, $path.Length - '/responses'.Length) }
  elseif (-not $path.EndsWith('/v1')) { $path = (($path.TrimEnd('/') + '/v1').Replace('//', '/')) }
  if ([string]::IsNullOrWhiteSpace($path)) { $path = '/v1' }
  $builder = [UriBuilder]::new($url)
  $builder.Path = $path
  $builder.Query = ''
  $builder.Fragment = ''
  return $builder.Uri.AbsoluteUri.TrimEnd('/')
}

function Normalize-AiOpsChatCompletionsUrl {
  param([string]$GatewayBaseUrl)
  try { $url = [Uri]$GatewayBaseUrl } catch { throw 'AI OPS 网关地址无效。' }
  if ($url.Scheme -notin @('http', 'https') -or -not $url.Host -or $url.UserInfo) { throw 'AI OPS 网关地址无效。' }
  $path = $url.AbsolutePath.TrimEnd('/')
  if (-not $path.EndsWith('/chat/completions')) {
    if ($path.EndsWith('/v1')) { $path = $path + '/chat/completions' }
    else { $path = (($path.TrimEnd('/') + '/v1/chat/completions').Replace('//', '/')) }
  }
  $builder = [UriBuilder]::new($url)
  $builder.Path = $path
  $builder.Query = ''
  $builder.Fragment = ''
  return $builder.Uri.AbsoluteUri.TrimEnd('/')
}

function ConvertTo-AiOpsTomlString {
  param([string]$Value)
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
  return '"' + $escaped + '"'
}

function Test-AiOpsTomlTableHeader {
  param([string]$Line)
  return $Line -match '^\s*\[\[?'
}

function Test-AiOpsProviderHeader {
  param([string]$Line)
  return $Line -match '^\s*\[\s*model_providers\s*\.\s*(?:ai-ops|"ai-ops"|''ai-ops'')\s*\]\s*(?:#.*)?$'
}

function Set-AiOpsTomlRootString {
  param([System.Collections.ArrayList]$Lines, [string]$Name, [string]$Value)
  $bound = $Lines.Count
  for ($index = 0; $index -lt $Lines.Count; $index += 1) {
    if (Test-AiOpsTomlTableHeader ([string]$Lines[$index])) { $bound = $index; break }
  }
  # `$Matches` is a PowerShell automatic variable populated by every `-match`.
  # Do not use a case-insensitive variant of that name to collect line indexes,
  # otherwise the first match replaces this ArrayList with a Hashtable.
  $matchingIndexes = New-Object System.Collections.ArrayList
  for ($index = 0; $index -lt $bound; $index += 1) {
    if ([string]$Lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) { [void]$matchingIndexes.Add($index) }
  }
  if ($matchingIndexes.Count -gt 1) { throw "现有 Codex 配置中重复定义了 $Name，未作任何修改。" }
  $nextLine = "$Name = $(ConvertTo-AiOpsTomlString $Value)"
  if ($matchingIndexes.Count -eq 1) { $Lines[[int]$matchingIndexes[0]] = $nextLine } else { $Lines.Insert($bound, $nextLine) }
}

function Get-AiOpsTomlRootString {
  param([System.Collections.ArrayList]$Lines, [string]$Name)
  $bound = $Lines.Count
  for ($index = 0; $index -lt $Lines.Count; $index += 1) {
    if (Test-AiOpsTomlTableHeader ([string]$Lines[$index])) { $bound = $index; break }
  }
  $matchingIndexes = New-Object System.Collections.ArrayList
  for ($index = 0; $index -lt $bound; $index += 1) {
    if ([string]$Lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) { [void]$matchingIndexes.Add($index) }
  }
  if ($matchingIndexes.Count -gt 1) { throw "现有 Codex 配置中重复定义了 $Name，未作任何修改。" }
  if ($matchingIndexes.Count -eq 0) { return $null }
  $line = [string]$Lines[[int]$matchingIndexes[0]]
  $doubleQuoted = [regex]::Match($line, ('^\s*' + [regex]::Escape($Name) + '\s*=\s*"(?<value>(?:[^"\\]|\\.)*)"\s*(?:#.*)?$'))
  if ($doubleQuoted.Success) {
    $raw = $doubleQuoted.Groups['value'].Value
    return $raw.Replace('\\', '\').Replace('\"', '"')
  }
  $singleQuoted = [regex]::Match($line, ('^\s*' + [regex]::Escape($Name) + "\s*=\s*'(?<value>[^']*)'\s*(?:#.*)?$"))
  if ($singleQuoted.Success) { return $singleQuoted.Groups['value'].Value }
  throw "现有 Codex 配置中的 $Name 不是可安全读取的字符串，未作任何修改。"
}

function Copy-AiOpsJsonValue {
  param($Value)
  return (ConvertTo-Json -InputObject $Value -Depth 100 | ConvertFrom-Json -ErrorAction Stop)
}

function Resolve-AiOpsTomlPath {
  param([string]$Value, [string]$BaseDirectory)
  if ([string]::IsNullOrWhiteSpace($Value)) { throw 'Codex 模型目录路径为空，未作任何修改。' }
  if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
  return [IO.Path]::GetFullPath((Join-Path $BaseDirectory $Value))
}

function Read-AiOpsCodexCatalog {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { throw '现有 Codex 模型目录文件不存在，未作任何修改。' }
  try { $catalog = [IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop } catch { throw '现有 Codex 模型目录不是有效 JSON，未作任何修改。' }
  if ($null -eq $catalog -or -not ($catalog.PSObject.Properties.Name -contains 'models') -or $null -eq $catalog.models) {
    throw '现有 Codex 模型目录缺少 models 列表，未作任何修改。'
  }
  return $catalog
}

function Get-AiOpsCodexCatalogTemplate {
  param([string]$CodexDirectory, [string]$PreferredSlug)
  $cachePath = Join-Path $CodexDirectory 'models_cache.json'
  if (-not (Test-Path -LiteralPath $cachePath)) { throw '未找到 Codex 的 models_cache.json；请先启动一次 Codex 后再导入，未作任何修改。' }
  try { $cache = [IO.File]::ReadAllText($cachePath) | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Codex 的 models_cache.json 无法读取，未作任何修改。' }
  if ($null -eq $cache -or -not ($cache.PSObject.Properties.Name -contains 'models') -or $null -eq $cache.models) {
    throw 'Codex 的 models_cache.json 缺少模型目录，未作任何修改。'
  }
  $models = @($cache.models | Where-Object { $null -ne $_ })
  if ($models.Count -eq 0) { throw 'Codex 的 models_cache.json 没有可用模型模板，未作任何修改。' }
  $template = @($models | Where-Object { ([string]$_.slug).Trim() -eq $PreferredSlug }) | Select-Object -First 1
  if ($null -eq $template) { $template = @($models | Where-Object { ([string]$_.visibility).Trim().ToLowerInvariant() -eq 'list' }) | Select-Object -First 1 }
  if ($null -eq $template) { $template = $models[0] }
  foreach ($property in @('slug', 'display_name', 'context_window')) {
    if (-not ($template.PSObject.Properties.Name -contains $property)) { throw 'Codex 的模型模板缺少必要字段，未作任何修改。' }
  }
  return (Copy-AiOpsJsonValue $template)
}

function Test-AiOpsCodexCatalogModel {
  param($Model)
  if ($null -eq $Model) { return $false }
  return ([string]$Model.slug).Trim().ToLowerInvariant() -eq 'ai-ops' -and ([string]$Model.display_name).Trim().ToLowerInvariant() -eq 'ai ops'
}

function Test-AiOpsCodexCatalogSlugConflict {
  param($Model)
  if ($null -eq $Model) { return $false }
  return ([string]$Model.slug).Trim().ToLowerInvariant() -eq 'ai-ops' -and -not (Test-AiOpsCodexCatalogModel $Model)
}

function Merge-AiOpsCodexCatalog {
  param($ExistingCatalog, [object[]]$ExistingModels, $AiOpsModel)
  $conflicts = @($ExistingModels | Where-Object { Test-AiOpsCodexCatalogSlugConflict $_ })
  if ($conflicts.Count -gt 0) {
    throw '现有 Codex 模型目录中有其他模型使用了保留 slug “ai-ops”；为避免覆盖该模型，未作任何修改。'
  }
  $preserved = @($ExistingModels | Where-Object { -not (Test-AiOpsCodexCatalogModel $_) })
  if ($null -eq $ExistingCatalog) {
    $catalog = [pscustomobject]@{ models = [object[]]@($preserved + @($AiOpsModel)) }
  } else {
    $catalog = Copy-AiOpsJsonValue $ExistingCatalog
    $catalog.models = [object[]]@($preserved + @($AiOpsModel))
  }
  return [pscustomobject]@{ Catalog = $catalog; PreservedModelCount = $preserved.Count }
}

function Get-AiOpsProviderBlock {
  param([string]$GatewayBaseUrl)
  return @(
    '# >>> AI OPS provider (managed by AI OPS) >>>',
    '[model_providers.ai-ops]',
    'name = "AI OPS"',
    "base_url = $(ConvertTo-AiOpsTomlString (Normalize-AiOpsResponsesUrl $GatewayBaseUrl))",
    'env_key = "AI_OPS_TOKEN"',
    'requires_openai_auth = false',
    'wire_api = "responses"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '# <<< AI OPS provider (managed by AI OPS) <<<'
  )
}

function Replace-AiOpsProviderBlock {
  param([System.Collections.ArrayList]$Lines, [string]$GatewayBaseUrl)
  $starts = New-Object System.Collections.ArrayList
  for ($index = 0; $index -lt $Lines.Count; $index += 1) {
    if (Test-AiOpsProviderHeader ([string]$Lines[$index])) { [void]$starts.Add($index) }
  }
  if ($starts.Count -gt 1) { throw '现有 Codex 配置中重复定义了 AI OPS Provider，未作任何修改。' }
  $replacement = @(Get-AiOpsProviderBlock $GatewayBaseUrl)
  if ($starts.Count -eq 1) {
    $providerStart = [int]$starts[0]
    $start = $providerStart
    while ($start -gt 0 -and ([string]$Lines[$start - 1]).Trim() -eq '# >>> AI OPS provider (managed by AI OPS) >>>') { $start -= 1 }
    $end = $Lines.Count
    for ($index = $providerStart + 1; $index -lt $Lines.Count; $index += 1) {
      if (Test-AiOpsTomlTableHeader ([string]$Lines[$index])) { $end = $index; break }
    }
    for ($index = $end - 1; $index -ge $start; $index -= 1) { $Lines.RemoveAt($index) }
    for ($index = $replacement.Count - 1; $index -ge 0; $index -= 1) { $Lines.Insert($start, $replacement[$index]) }
    return
  }
  while ($Lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace([string]$Lines[$Lines.Count - 1])) { $Lines.RemoveAt($Lines.Count - 1) }
  if ($Lines.Count -gt 0) { [void]$Lines.Add('') }
  foreach ($line in $replacement) { [void]$Lines.Add($line) }
}

function Write-AiOpsTextAtomically {
  param([string]$Path, [string]$Content)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, $Content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Backup-AiOpsFile {
  param([string]$Path, [string]$Extension)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $stamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
  Copy-Item -LiteralPath $Path -Destination "$Path.ai-ops-backup-$stamp.$Extension" -Force
  return $true
}

function Configure-AiOpsCodex {
  param([string]$ApiKey, [string]$GatewayBaseUrl)
  $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $codexDirectory = Join-Path $profile '.codex'
  $configPath = Join-Path $codexDirectory 'config.toml'
  $catalogPath = Join-Path $codexDirectory 'ai-ops-catalog.json'
  $source = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { '' }
  $newline = if ($source.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lines = New-Object System.Collections.ArrayList
  foreach ($line in @($source.TrimStart([char]0xFEFF) -split "`r?`n")) { [void]$lines.Add($line) }
  while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace([string]$lines[$lines.Count - 1])) { $lines.RemoveAt($lines.Count - 1) }
  $previousModel = Get-AiOpsTomlRootString $lines 'model'
  $existingCatalogSetting = Get-AiOpsTomlRootString $lines 'model_catalog_json'
  $existingCatalog = $null
  $existingModels = @()
  if (-not [string]::IsNullOrWhiteSpace($existingCatalogSetting)) {
    $existingCatalog = Read-AiOpsCodexCatalog (Resolve-AiOpsTomlPath $existingCatalogSetting $codexDirectory)
    $existingModels = @($existingCatalog.models | Where-Object { $null -ne $_ })
  } elseif (Test-Path -LiteralPath $catalogPath) {
    throw '检测到未被当前 Codex 配置引用的 AI OPS 模型目录；为避免覆盖该文件，未作任何修改。'
  }
  $aiOpsCatalogModel = Get-AiOpsCodexCatalogTemplate $codexDirectory $previousModel
  $aiOpsCatalogModel.slug = 'ai-ops'
  $aiOpsCatalogModel.display_name = 'AI OPS'
  $aiOpsCatalogModel.context_window = 272000
  $catalogMerge = Merge-AiOpsCodexCatalog $existingCatalog $existingModels $aiOpsCatalogModel
  Set-AiOpsTomlRootString $lines 'model' 'ai-ops'
  Set-AiOpsTomlRootString $lines 'model_provider' 'ai-ops'
  Set-AiOpsTomlRootString $lines 'model_catalog_json' ($catalogPath.Replace('\', '/'))
  Replace-AiOpsProviderBlock $lines $GatewayBaseUrl
  [void](Backup-AiOpsFile $catalogPath 'json')
  [void](Backup-AiOpsFile $configPath 'toml')
  Write-AiOpsTextAtomically $catalogPath ((ConvertTo-Json -InputObject $catalogMerge.Catalog -Depth 100) + "`n")
  Write-AiOpsTextAtomically $configPath (([string]::Join($newline, [string[]]$lines)) + $newline)
  [Environment]::SetEnvironmentVariable('AI_OPS_TOKEN', $ApiKey.Trim(), 'User')
}

function Test-AiOpsWorkBuddyModel {
  param($Model)
  if ($null -eq $Model) { return $false }
  $id = ([string]$Model.id).Trim().ToLowerInvariant()
  $name = ([string]$Model.name).Trim().ToLowerInvariant()
  $vendor = ([string]$Model.vendor).Trim().ToLowerInvariant()
  # An entry is replaceable only when all three AI OPS identity fields match.
  # Name or vendor alone are user-controlled WorkBuddy fields and must never
  # cause an unrelated custom model to be deleted.
  return $id -eq 'ai-ops' -and $name -eq 'ai ops' -and $vendor -eq 'ai ops'
}

function Test-AiOpsWorkBuddyReservedIdConflict {
  param($Model)
  if ($null -eq $Model) { return $false }
  $id = ([string]$Model.id).Trim().ToLowerInvariant()
  return $id -eq 'ai-ops' -and -not (Test-AiOpsWorkBuddyModel $Model)
}

function Merge-AiOpsWorkBuddyModels {
  param([object[]]$Models, $AiOpsModel)
  # Do not replace another custom model that already occupies our required
  # WorkBuddy id. Abort before creating a backup or writing the config.
  $conflicts = @($Models | Where-Object { Test-AiOpsWorkBuddyReservedIdConflict $_ })
  if ($conflicts.Count -gt 0) {
    throw 'WorkBuddy 的 models.json 中已有非 AI OPS 的自定义模型使用了保留 ID “ai-ops”；为避免覆盖该模型，未作任何修改。请先修改原模型 ID 后重新导入。'
  }
  $preserved = @($Models | Where-Object { -not (Test-AiOpsWorkBuddyModel $_) })
  return [pscustomobject]@{
    Models = [object[]]@($preserved + @($AiOpsModel))
    PreservedModelCount = $preserved.Count
  }
}

function Configure-AiOpsWorkBuddy {
  param([string]$ApiKey, [string]$GatewayBaseUrl)
  $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $configPath = Join-Path (Join-Path $profile '.workbuddy') 'models.json'
  $models = @()
  if (Test-Path -LiteralPath $configPath) {
    $raw = [IO.File]::ReadAllText($configPath)
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      try { $source = $raw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'WorkBuddy 的 models.json 不是有效 JSON，未作任何修改。' }
      $trimmed = $raw.TrimStart([char[]]@([char]0xFEFF, [char]0x20, [char]0x09, [char]0x0D, [char]0x0A))
      if ($trimmed.StartsWith('[')) {
        # ConvertFrom-Json unwraps a one-item JSON array in Windows PowerShell.
        # Re-wrap the result so the original top-level array is preserved.
        $models = @($source | Where-Object { $null -ne $_ })
      } elseif ($null -ne $source -and (([string]$source.id).Trim() -or ([string]$source.name).Trim())) {
        # Repair the singleton-object file produced by earlier assistants and
        # preserve any employee-defined model before adding AI OPS.
        $models = @($source)
        Write-AiOpsAssistantLog 'workbuddy-single-model-migrated'
      } elseif ($null -ne $source -and $source.PSObject.Properties.Name -contains 'models') {
        # Accept the prior object wrapper once, then write WorkBuddy's required
        # array-only shape on disk.
        $models = @($source.models | Where-Object { $null -ne $_ })
        Write-AiOpsAssistantLog 'workbuddy-models-wrapper-migrated'
      } else {
        throw 'WorkBuddy 的 models.json 顶层不是模型数组，且未识别到可迁移的模型；已保留原文件。'
      }
    }
  }
  $aiOpsModel = [pscustomobject]@{
    id = 'ai-ops'; name = 'AI OPS'; vendor = 'AI OPS'; apiKey = $ApiKey.Trim(); url = Normalize-AiOpsChatCompletionsUrl $GatewayBaseUrl
    supportsToolCall = $true; supportsImages = $false; supportsReasoning = $false
  }
  $existingAiOps = @($models | Where-Object { Test-AiOpsWorkBuddyModel $_ })
  Write-AiOpsAssistantLog $(if ($existingAiOps.Count) { 'workbuddy-ai-ops-updated' } else { 'workbuddy-ai-ops-added' })
  $merge = Merge-AiOpsWorkBuddyModels $models $aiOpsModel
  $nextModels = [object[]]$merge.Models
  Write-AiOpsAssistantLog ('workbuddy-preserved-models:' + $merge.PreservedModelCount)
  [void](Backup-AiOpsFile $configPath 'json')
  # -InputObject is required here: piping a one-item array causes Windows
  # PowerShell to serialize the item as an object instead of a JSON array.
  Write-AiOpsTextAtomically $configPath ((ConvertTo-Json -InputObject $nextModels -Depth 32) + "`n")
}

function Install-AiOpsAssistant {
  $source = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path -LiteralPath $source)) { throw 'AI OPS 助手安装文件不完整。' }
  $directory = Get-AiOpsAssistantDirectory
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $target = Join-Path $directory 'ai-ops-client-assistant.ps1'
  if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($target)) { Copy-Item -LiteralPath $source -Destination $target -Force }
  $protocolKey = 'HKCU:\Software\Classes\aiops'
  New-Item -Path $protocolKey -Force | Out-Null
  Set-ItemProperty -Path $protocolKey -Name '(Default)' -Value 'URL:AI OPS Client Assistant'
  New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  $commandKey = Join-Path $protocolKey 'shell\open\command'
  New-Item -Path $commandKey -Force | Out-Null
  $command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $target + '" "%1"'
  Set-ItemProperty -Path $commandKey -Name '(Default)' -Value $command
  Write-Output 'AI OPS 助手已安装。回到员工门户后，直接点击“导入 Codex”或“导入 WorkBuddy”。'
}

function Get-AiOpsSetupFailureCode {
  param($ErrorRecord)
  $message = [string]$ErrorRecord.Exception.Message
  if ($message -like 'WorkBuddy 的 models.json 不是有效 JSON*') { return 'WORKBUDDY_INVALID_JSON' }
  if ($message -like 'WorkBuddy 的 models.json 顶层不是模型数组*') { return 'WORKBUDDY_UNSUPPORTED_ROOT' }
  if ($message -like 'WorkBuddy 的 models.json 中已有非 AI OPS 的自定义模型使用了保留 ID*') { return 'WORKBUDDY_MODEL_ID_CONFLICT' }
  return 'LOCAL_CONFIG_WRITE_FAILED'
}

function Complete-AiOpsSetup {
  param([string]$ServerUrl, [string]$Ticket, [bool]$Succeeded, [string]$FailureCode)
  try {
    $body = @{ succeeded = $Succeeded }
    if (-not $Succeeded -and -not [string]::IsNullOrWhiteSpace($FailureCode)) { $body.failureCode = $FailureCode }
    Invoke-AiOpsJson "$ServerUrl/api/device-setup-tickets/$Ticket/complete" $body | Out-Null
  } catch { Write-AiOpsAssistantLog 'completion-report-failed' }
}

if ($Install) {
  Install-AiOpsAssistant
  exit 0
}

$claimed = $false
try {
  $request = ConvertFrom-AiOpsLaunchUri $LaunchUri
  $claim = Invoke-AiOpsJson "$($request.ServerUrl)/api/device-setup-tickets/$($request.Ticket)/claim" @{}
  $claimed = $true
  $apiKey = [string]$claim.config.apiKey
  $gatewayBaseUrl = [string]$claim.config.gatewayBaseUrl
  if ($apiKey.Length -lt 8 -or $apiKey -match '[\r\n]' -or [string]::IsNullOrWhiteSpace($gatewayBaseUrl)) { throw '本机配置数据无效。' }
  if ($claim.target -eq 'codex') { Configure-AiOpsCodex $apiKey $gatewayBaseUrl }
  elseif ($claim.target -eq 'workbuddy') { Configure-AiOpsWorkBuddy $apiKey $gatewayBaseUrl }
  else { throw '不支持的客户端类型。' }
  Complete-AiOpsSetup $request.ServerUrl $request.Ticket $true
  Write-AiOpsAssistantLog 'configuration-succeeded'
} catch {
  $failureCode = Get-AiOpsSetupFailureCode $_
  if ($claimed -and $null -ne $request) { Complete-AiOpsSetup $request.ServerUrl $request.Ticket $false $failureCode }
  Write-AiOpsAssistantLog ('configuration-failed:' + $failureCode)
  exit 1
}
