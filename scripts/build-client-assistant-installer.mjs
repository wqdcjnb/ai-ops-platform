import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptsDirectory, '..')
const sourcePath = resolve(scriptsDirectory, 'ai-ops-client-assistant.ps1')
const outputPath = resolve(projectDirectory, 'apps', 'web', 'public', 'AI-OPS-助手安装.cmd')

const bootstrap = String.raw`$ErrorActionPreference = 'Stop'
try {
  # The .cmd package is UTF-8 without a BOM so cmd.exe can run its ASCII
  # header. Read it explicitly as UTF-8, then write the extracted .ps1 with
  # a BOM because Windows PowerShell 5.1 otherwise treats it as ANSI.
  $packageEncoding = New-Object System.Text.UTF8Encoding($false)
  $scriptEncoding = New-Object System.Text.UTF8Encoding($true)
  $source = [IO.File]::ReadAllText($env:AI_OPS_INSTALLER_PATH, $packageEncoding)
  $marker = '::AI_OPS_' + 'ASSISTANT_PAYLOAD::'
  $index = $source.IndexOf($marker, [StringComparison]::Ordinal)
  if ($index -lt 0) { throw 'AI OPS 助手安装包不完整。' }
  $payload = $source.Substring($index + $marker.Length).TrimStart([char]13, [char]10)
  $directory = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'AI OPS'
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $destination = Join-Path $directory 'ai-ops-client-assistant.ps1'
  [IO.File]::WriteAllText($destination, $payload, $scriptEncoding)
  & $destination -Install
  exit 0
} catch {
  Write-Error 'AI OPS 助手安装失败。请关闭此窗口后重试，或联系管理员。'
  exit 1
}`

const encodedBootstrap = Buffer.from(bootstrap, 'utf16le').toString('base64')
const assistant = await readFile(sourcePath, 'utf8')
const payload = assistant.replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '')
const output = `@echo off\r\nsetlocal\r\nset "AI_OPS_INSTALLER_PATH=%~f0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedBootstrap}\r\nset "AI_OPS_EXIT=%ERRORLEVEL%"\r\nif not "%AI_OPS_EXIT%"=="0" pause\r\nexit /b %AI_OPS_EXIT%\r\n::AI_OPS_ASSISTANT_PAYLOAD::\r\n${payload}\r\n`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, output, 'utf8')
