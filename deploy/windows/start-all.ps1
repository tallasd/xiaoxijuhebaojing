$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Logs = Join-Path $Root "logs"
$PidFile = Join-Path $Logs "message-hub-processes.json"
Set-Location $Root
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Start-HubProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $outFile = Join-Path $Logs "$Name.out.log"
  $errFile = Join-Path $Logs "$Name.err.log"
  if (Test-Path $outFile) { Clear-Content $outFile }
  if (Test-Path $errFile) { Clear-Content $errFile }

  $process = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/d /s /c `"$Command`"" `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $outFile `
    -RedirectStandardError $errFile `
    -WindowStyle Hidden `
    -PassThru

  [pscustomobject]@{
    name = $Name
    pid = $process.Id
    command = $Command
    startedAt = (Get-Date).ToString("s")
    outLog = $outFile
    errLog = $errFile
  }
}

Write-Host ""
Write-Host "==== 启动客服消息中台 ====" -ForegroundColor Cyan

if (Test-Path $PidFile) {
  Write-Host "检测到旧的进程记录，先执行一次停止..." -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot "stop-all.ps1") -Quiet
}

$processes = @()
$processes += Start-HubProcess -Name "api" -Command "npm run start -w @xiaoxijuhe/api"
$processes += Start-HubProcess -Name "web" -Command "npm run preview -w @xiaoxijuhe/web -- --host 0.0.0.0 --port 5173"
$processes += Start-HubProcess -Name "email-imap" -Command "npm run start -w @xiaoxijuhe/email-imap-collector"

$processes | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $PidFile

Start-Sleep -Seconds 6

Write-Host ""
Write-Host "启动完成：" -ForegroundColor Green
Write-Host "中台页面：http://localhost:5173/"
Write-Host "接口地址：http://localhost:4100/"
Write-Host "日志目录：$Logs"
Write-Host ""
Write-Host "建议现在双击 deploy\windows\status.bat 检查状态。"
