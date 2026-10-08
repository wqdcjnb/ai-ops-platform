param([string]$BackupRoot)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
# Keep the old entry point; SQLite is no longer the live database.
& (Join-Path $projectDirectory 'scripts\backup-docker.ps1') -OutputDirectory $BackupRoot
