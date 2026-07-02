# 多平台电商客服消息聚合系统 MVP

这是一个“中央中台 + 分布式采集器”的第一阶段落地版本。当前实现重点是：

- 统一接收邮件、网页、桌面通知、手机通知、手动录入等来源的消息。
- 自动识别平台、店铺、风险词、优先级和 SLA 截止时间。
- 提供客服工作台，支持筛选、查看详情、标记处理中、已回复、升级和忽略。
- 提供平台、店铺、采集器、风险词的基础数据模型。
- 提供浏览器插件、邮件采集器、桌面通知采集器的样例入口。
- 新增聊天质检雷达：插件可上报客户消息与客服回复，系统识别违规、敷衍、回复慢、未回复。

## 本地启动

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

默认地址：

- 前端工作台：http://localhost:5173
- 后端 API：http://localhost:4100

## 目录

```text
apps/api                  中央中台 API
apps/web                  客服工作台前端
collectors/email-imap     邮件采集器样例
collectors/browser-extension 浏览器网页采集器样例
collectors/desktop-windows Windows 桌面通知采集器说明和脚本
docs                      项目说明和部署建议
```

## 新想法落地

网页接待平台优先安装 `collectors/browser-extension` 插件；邮件提醒平台可以继续使用网易邮箱大师统一收件，再通过 IMAP 或 Windows 桌面通知接入中台。

详细方案见 [docs/browser-plugin-mail-master-flow.md](docs/browser-plugin-mail-master-flow.md)。

当前优先实现前四点，本机直连为主：

- eBay → 邮箱 IMAP → 中台
- Game Club → 邮箱 IMAP → 中台
- Shopee 台湾 4 个店铺 → 浏览器插件 → `http://127.0.0.1:4100`
- Shopee 马来 1 个店铺 → 浏览器插件 → `http://127.0.0.1:4100`
- Discord 2 个环境 → 浏览器插件 → `http://127.0.0.1:4100`

可执行清单见 [docs/前四点落地执行清单.md](docs/前四点落地执行清单.md)。
插件安装表见 [docs/插件直连安装清单.csv](docs/插件直连安装清单.csv)。
邮箱填写表见 [docs/第一阶段邮箱清单.csv](docs/第一阶段邮箱清单.csv)。

远程邮件中转先保留为备用方案：

- 远程电脑插件 → 本机邮件中转采集器 → SMTP → 统一中台邮箱
- 中台电脑 → IMAP 读取统一中台邮箱 → 写入中台收件箱
- 中台电脑也可以用多邮箱 IMAP 采集器读取 eBay/Etsy 等平台提醒邮件，对应网易邮箱大师里的“所有收件箱”场景

备用落地步骤见 [docs/phase-one-mail-relay.md](docs/phase-one-mail-relay.md)。

## 第一阶段边界

第一阶段不做破解客户端协议、不绕过验证码、不集中登录海外账号、不自动发送客服回复。系统只做消息发现、提醒、派单、状态追踪和 AI 辅助占位。
