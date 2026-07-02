# 第一阶段：邮箱中转版落地方案

这个阶段先不要求中台服务器公网可访问。远程电脑、海外主机、指纹浏览器只需要能发邮件。

## 数据流

```text
远程电脑里的平台浏览器插件
        ↓
远程电脑本机邮件中转采集器 http://127.0.0.1:4222
        ↓
SMTP 发邮件
        ↓
统一中台邮箱
        ↓
中台电脑邮箱入库采集器读取 IMAP
        ↓
中台统一收件箱 / 质检雷达
```

## 中台电脑要做什么

中台电脑运行：

1. 中台系统。
2. 网易邮箱大师。
3. 邮件采集器。
4. 中台邮箱入库采集器。

你截图里的“所有收件箱”是网易邮箱大师的软件聚合视图。中台程序不建议去读这个界面，而是用 IMAP 读取这些邮箱账号。这样更稳定，也不会受网易邮箱大师界面变化影响。

如果只是读取 eBay、Etsy、日本平台这些正常平台提醒邮件，用：

```text
collectors/email-imap
```

它现在支持多邮箱配置，可以像“所有收件箱”一样轮询多个邮箱。

如果是远程电脑通过 SMTP 发来的结构化中转邮件，用：

中台邮箱入库采集器位置：

```text
collectors/hub-mail-ingest
```

配置文件参考：

```text
collectors/hub-mail-ingest/.env.example
```

需要填写：

```text
HUB_API_URL=http://localhost:4100
IMAP_HOST=你的中台邮箱 IMAP 地址
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=统一中台收件邮箱
IMAP_PASS=IMAP 授权码
IMAP_MAILBOX=INBOX
POLL_SECONDS=30
```

启动：

```bash
npm run relay:hub
```

正常平台提醒邮件采集器启动：

```bash
npm run dev -w @xiaoxijuhe/email-imap-collector
```

## 多邮箱配置示例

`collectors/email-imap/.env` 可以配置多个邮箱：

```text
HUB_API_URL=http://localhost:4100
COLLECTOR_TOKEN=collector-email-main
POLL_SECONDS=60
INGEST_UNKNOWN=false
MAIL_ACCOUNTS_JSON=[{"name":"eBay邮箱1","host":"imap.example.com","port":993,"secure":true,"user":"a@example.com","pass":"授权码","mailbox":"INBOX","defaultShop":"eBay 店铺A"},{"name":"eBay邮箱2","host":"imap.example.com","port":993,"secure":true,"user":"b@example.com","pass":"授权码","mailbox":"INBOX","defaultShop":"eBay 店铺B"}]
```

`INGEST_UNKNOWN=false` 表示只入库 eBay、Etsy、日本平台等目标邮件，像“网易邮箱账号安全提醒”这类普通邮件不会进入中台。

## 每台远程电脑要做什么

每台远程电脑运行：

1. 平台所在 Chrome / 指纹浏览器。
2. 浏览器插件。
3. 本地邮件中转采集器。

本地邮件中转采集器位置：

```text
collectors/local-mail-relay
```

配置文件参考：

```text
collectors/local-mail-relay/.env.example
```

建议每台远程电脑使用一个独立 SMTP 发件邮箱。

```text
DEVICE_NAME=海外主机A
DEVICE_TYPE=Windows VPS
LOCATION=US
COLLECTOR_TOKEN=collector-vps-a
SMTP_HOST=SMTP 地址
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=这台电脑专用发件邮箱
SMTP_PASS=SMTP 授权码
MAIL_FROM=这台电脑专用发件邮箱
HUB_MAIL_TO=统一中台收件邮箱
```

启动：

```bash
npm run relay:local
```

## 插件怎么填

插件装在平台所在浏览器里。

插件里的“中台/本地中转地址”填：

```text
http://127.0.0.1:4222
```

这样插件只和本机通信，不需要访问公网中台。

## 邮件内容

远程电脑会发送结构化邮件到统一中台邮箱，正文是 JSON，例如：

```json
{
  "schema": "xiaoxijuhe.mail-relay.v1",
  "kind": "message_ingest",
  "collector": {
    "token": "collector-vps-a",
    "deviceName": "海外主机A",
    "deviceType": "Windows VPS",
    "location": "US"
  },
  "payload": {
    "platform": "Shopee MY",
    "shopName": "Shopee 马来店1",
    "content": "When can you deliver?",
    "sourceType": "WEB",
    "sourceUrl": "https://seller.shopee.com.my/..."
  }
}
```

中台邮箱入库采集器会读取这些邮件，再转成中台消息。

## 这个阶段能做到什么

- 不需要公网中台服务器。
- 每台远程电脑只要能发邮件即可。
- 网页红点、未读数字、新消息可以汇总到中台。
- 客服聊天观察可以进入质检雷达。
- 中台能知道是哪台远程电脑、哪个平台、哪个店铺上报的。

## 注意

- 邮件中转会有延迟，通常是几十秒到几分钟。
- 告警太频繁时可能触发邮箱限流，所以中台和插件都做去重。
- 正式规模变大后，再升级为 HTTPS 直连云中台会更实时。
