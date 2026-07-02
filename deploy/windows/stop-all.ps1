param(
  [switch]$Quiet
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Logs = Join-Path $Root "logs"
$PidFile = Join-Path $Logs "message-hub-processes.json"

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not $Quiet) {
  Write-Host ""
  Write-Host "==== 停止客服消息中台 ====" -ForegroundColor Cyan
}

if (Test-Path $PidFile) {
  $records = Get-Content -Raw -Encoding UTF8 $PidFile | ConvertFrom-Json
  foreach ($record in $records) {
    if (-not $Quiet) {
      Write-Host "停止 $($record.name) PID $($record.pid)"
    }
    Stop-ProcessTree -ProcessId ([int]$record.pid)
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

if (-not $Quiet) {
  Write-Host "已停止。"
}
