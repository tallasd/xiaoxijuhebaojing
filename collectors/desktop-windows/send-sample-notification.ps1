param(
  [string]$HubApiUrl = "http://localhost:4100",
  [string]$CollectorToken = "collector-desktop-cn",
  [string]$Platform = "微信",
  [string]$ShopName = "微信客服号A",
  [string]$CustomerName = "客户-通知样例",
  [string]$Content = "客户发来一条新的桌面通知消息"
)

$heartbeatBody = @{
  token = $CollectorToken
  status = "在线"
  message = "Windows 桌面通知采集器样例心跳。"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "$HubApiUrl/api/collectors/heartbeat" -ContentType "application/json" -Body $heartbeatBody | Out-Null

$messageBody = @{
  platform = $Platform
  site = "CN"
  shopName = $ShopName
  accountEnvironment = "$env:COMPUTERNAME / Windows 通知"
  customerName = $CustomerName
  content = $Content
  rawContent = $Content
  sourceType = "DESKTOP_NOTIFICATION"
  sourceExternalId = "desktop-$([Guid]::NewGuid().ToString())"
  detectedAt = (Get-Date).ToUniversalTime().ToString("o")
  tags = @("desktop")
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "$HubApiUrl/api/messages/ingest" -ContentType "application/json" -Body $messageBody
