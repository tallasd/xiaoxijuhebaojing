$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Logs = Join-Path $Root "logs"
$PidFile = Join-Path $Logs "message-hub-processes.json"

function Test-Url {
  param(
    [string]$Name,
    [string]$Url
  )
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    Write-Host "OK  $Name $Url 状态码 $($response.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "FAIL $Name $Url $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "==== 客服消息中台状态 ====" -ForegroundColor Cyan
Test-Url -Name "网页" -Url "http://localhost:5173/"
Test-Url -Name "接口" -Url "http://localhost:4100/health"
Test-Url -Name "IMAP状态" -Url "http://localhost:4100/api/imap-status"

Write-Host ""
Write-Host "进程："
if (Test-Path $PidFile) {
  $records = Get-Content -Raw -Encoding UTF8 $PidFile | ConvertFrom-Json
  foreach ($record in $records) {
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host "OK  $($record.name) PID $($record.pid)" -ForegroundColor Green
    } else {
      Write-Host "FAIL $($record.name) PID $($record.pid) 不存在" -ForegroundColor Red
    }
  }
} else {
  Write-Host "没有找到进程记录。请先运行 start-all.bat。"
}

Write-Host ""
Write-Host "未查看新消息数量："
try {
  $messages = Invoke-RestMethod -Uri "http://localhost:4100/api/messages" -TimeoutSec 5
  $count = @($messages.data | Where-Object { -not $_.viewedAt }).Count
  Write-Host "$count"
} catch {
  Write-Host "读取失败：$($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "日志目录：$Logs"
