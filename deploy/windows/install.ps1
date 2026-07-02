$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host ""
Write-Host "==== 客服消息中台：生产电脑安装 ====" -ForegroundColor Cyan
Write-Host "项目目录：$Root"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "没有检测到 Node.js。请先安装 Node.js 22 或更高版本，然后重新运行本脚本。"
}

Write-Host "Node 版本：" (node -v)
Write-Host "npm 版本：" (npm -v)

New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

Write-Host ""
Write-Host "1/4 安装项目依赖..." -ForegroundColor Yellow
npm install

Write-Host ""
Write-Host "2/4 同步数据库结构..." -ForegroundColor Yellow
Push-Location (Join-Path $Root "apps\api")
npx prisma db push
npx prisma generate
Pop-Location

Write-Host ""
Write-Host "3/4 构建接口、网页和采集器..." -ForegroundColor Yellow
npm run build --workspaces --if-present

Write-Host ""
Write-Host "4/4 检查关键配置文件..." -ForegroundColor Yellow
$required = @(
  "apps\api\.env",
  "apps\api\prisma\dev.db",
  "collectors\email-imap\.env",
  "collectors\email-imap\.email-imap-state.json",
  "apps\web\public\alerts\gametrade.wav",
  "apps\web\public\alerts\game-club.wav"
)

foreach ($item in $required) {
  $path = Join-Path $Root $item
  if (-not (Test-Path $path)) {
    throw "缺少关键文件：$item"
  }
  Write-Host "OK $item"
}

Write-Host ""
Write-Host "安装完成。下一步双击 deploy\windows\start-all.bat 启动中台。" -ForegroundColor Green
