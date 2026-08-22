param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [int]$DailyRetention = 7,
  [int]$WeeklyRetention = 4
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$daily = Join-Path $BackupDirectory "growthifyx-$stamp.dump"
& pg_dump --format=custom --no-owner --no-privileges --dbname=$DatabaseUrl --file=$daily
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
$dailyFiles = Get-ChildItem -LiteralPath $BackupDirectory -Filter "growthifyx-*.dump" | Sort-Object LastWriteTime -Descending
$dailyFiles | Select-Object -Skip $DailyRetention | Remove-Item -Force
if ((Get-Date).DayOfWeek -eq [DayOfWeek]::Sunday) {
  $weekly = Join-Path $BackupDirectory "weekly-$stamp.dump"
  Copy-Item -LiteralPath $daily -Destination $weekly
  Get-ChildItem -LiteralPath $BackupDirectory -Filter "weekly-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $WeeklyRetention | Remove-Item -Force
}
Write-Output "Backup written to $daily"
