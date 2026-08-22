param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) { throw "Restore is destructive. Re-run with -ConfirmRestore during an approved maintenance window." }
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw "Backup file not found" }
& pg_restore --clean --if-exists --no-owner --no-privileges --dbname=$DatabaseUrl $BackupFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
Write-Output "Restore completed. Run prisma migrate deploy and application verification before reopening traffic."
