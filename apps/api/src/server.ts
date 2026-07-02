import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  ChatSpeaker,
  MessageStatus,
  QualityAlertStatus,
  RiskLevel,
  SourceType
} from "@prisma/client";
import { z } from "zod";
import {
  ingestMessage,
  messageInclude,
  normalizeSourceType,
  serializeMessage
} from "./domain.js";
import { prisma } from "./prisma.js";
import { checkMissedReplies, observeChat, qualitySummary } from "./quality.js";

const app = express();
const port = Number(process.env.PORT ?? 4100);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "2mb" }));

const ingestSchema = z.object({
  platform: z.string().min(1),
  site: z.string().optional(),
  shopName: z.string().min(1),
  accountEnvironment: z.string().optional(),
  customerName: z.string().optional(),
  customerId: z.string().optional(),
  conversationId: z.string().optional(),
  orderId: z.string().optional(),
  productName: z.string().optional(),
  messageType: z.string().optional(),
  content: z.string().min(1),
  rawContent: z.string().optional(),
  sourceType: z.string().min(1),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  sourceExternalId: z.string().optional(),
  receivedAt: z.string().optional(),
  detectedAt: z.string().optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).optional()
});

function ok(data: unknown) {
  return { ok: true, data };
}

function badRequest(message: string) {
  return { ok: false, error: message };
}

app.get("/health", async (_req, res) => {
  const collectors = await prisma.collector.count();
  res.json({ ok: true, service: "message-hub-api", collectors });
});

app.get("/api/dashboard", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    todayTotal,
    openTotal,
    p0Total,
    timeoutTotal,
    onlineCollectors,
    offlineCollectors,
    byPlatform
  ] = await Promise.all([
    prisma.message.count({ where: { detectedAt: { gte: today } } }),
    prisma.message.count({
      where: {
        status: {
          in: [
            MessageStatus.NEW,
            MessageStatus.UNASSIGNED,
            MessageStatus.ASSIGNED,
            MessageStatus.IN_PROGRESS,
            MessageStatus.ESCALATED,
            MessageStatus.MANUAL_REVIEW
          ]
        }
      }
    }),
    prisma.message.count({ where: { riskLevel: { in: [RiskLevel.HIGH, RiskLevel.CRITICAL] } } }),
    prisma.message.count({ where: { status: MessageStatus.TIMEOUT } }),
    prisma.collector.count({ where: { status: "在线" } }),
    prisma.collector.count({ where: { NOT: { status: "在线" } } }),
    prisma.message.groupBy({
      by: ["platformId"],
      _count: true,
      orderBy: { _count: { platformId: "desc" } },
      take: 8
    })
  ]);

  const platformIds = byPlatform.map((item) => item.platformId);
  const platforms = await prisma.platform.findMany({ where: { id: { in: platformIds } } });

  res.json(
    ok({
      todayTotal,
      openTotal,
      p0Total,
      timeoutTotal,
      onlineCollectors,
      offlineCollectors,
      byPlatform: byPlatform.map((item) => ({
        platform: platforms.find((platform) => platform.id === item.platformId)?.name ?? item.platformId,
        count: item._count
      })),
      byPriority: []
    })
  );
});

app.get("/api/imap-status", async (_req, res) => {
  const collectors = await prisma.collector.findMany({
    where: {
      lastHeartbeatAt: { not: null },
      OR: [{ deviceType: { contains: "IMAP" } }, { name: { contains: "邮箱采集器" } }]
    },
    include: { logs: { take: 1, orderBy: { createdAt: "desc" } } },
    orderBy: { name: "asc" }
  });

  const staleAfterMs = 12 * 60 * 1000;
  const now = Date.now();
  const accounts = collectors.map((collector) => {
    const latestLog = collector.logs[0];
    const message = latestLog?.message ?? "";
    const lastHeartbeatAt = collector.lastHeartbeatAt?.toISOString() ?? null;
    const stale = collector.lastHeartbeatAt ? now - collector.lastHeartbeatAt.getTime() > staleAfterMs : true;
    const limited = collector.status.includes("限流") || message.includes("流量超限");
    const errored = collector.status.includes("异常") || collector.status.includes("错误");
    const status = limited ? "LIMITED" : errored ? "ERROR" : stale ? "UNKNOWN" : collector.status === "在线" ? "OK" : "UNKNOWN";

    return {
      id: collector.id,
      name: collector.name.replace(/^邮箱采集器-/, ""),
      status,
      label:
        status === "OK"
          ? "正常"
          : status === "LIMITED"
            ? "限流"
            : status === "ERROR"
              ? "异常"
              : "未知",
      message: message || collector.status,
      lastCheckedAt: lastHeartbeatAt
    };
  });

  const overall = accounts.some((account) => account.status === "LIMITED")
    ? "LIMITED"
    : accounts.some((account) => account.status === "ERROR")
      ? "ERROR"
      : accounts.length === 0 || accounts.some((account) => account.status === "UNKNOWN")
        ? "UNKNOWN"
        : "OK";

  res.json(
    ok({
      overall,
      label:
        overall === "OK"
          ? "正常"
          : overall === "LIMITED"
            ? "限流"
            : overall === "ERROR"
              ? "异常"
              : "未知",
      summary:
        overall === "OK"
          ? "网易 IMAP 正常"
          : overall === "LIMITED"
            ? "网易 IMAP 流量限流"
            : overall === "ERROR"
              ? "网易 IMAP 异常"
              : "等待采集器上报",
      checkedAt: new Date().toISOString(),
      accounts
    })
  );
});

app.get("/api/bootstrap", async (_req, res) => {
  const [users, platforms, shops, collectors, riskRules] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
    prisma.shopAccount.findMany({ include: { platform: true, owner: true, collector: true } }),
    prisma.collector.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.riskRule.findMany({ orderBy: { createdAt: "asc" } })
  ]);

  res.json(ok({ users, platforms, shops, collectors, riskRules }));
});

app.get("/api/messages", async (req, res) => {
  const { platform, status, riskLevel, q } = req.query;
  const where = {
    ...(platform ? { platform: { name: String(platform) } } : {}),
    ...(status ? { status: String(status) as MessageStatus } : {}),
    ...(riskLevel ? { riskLevel: String(riskLevel) as RiskLevel } : {}),
    ...(q
      ? {
          OR: [
            { content: { contains: String(q) } },
            { customerName: { contains: String(q) } },
            { orderId: { contains: String(q) } },
            { productName: { contains: String(q) } }
          ]
        }
      : {})
  };

  const messages = await prisma.message.findMany({
    where,
    include: messageInclude,
    orderBy: { detectedAt: "desc" },
    take: 200
  });

  res.json(ok(messages.map(serializeMessage)));
});

app.get("/api/messages/:id", async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: req.params.id },
    include: messageInclude
  });

  if (!message) {
    res.status(404).json(badRequest("消息不存在"));
    return;
  }

  res.json(ok(serializeMessage(message)));
});

app.post("/api/messages/ingest", async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const payload = {
    ...parsed.data,
    sourceType: normalizeSourceType(parsed.data.sourceType),
    sourceUrl: parsed.data.sourceUrl || undefined
  };

  const result = await ingestMessage(payload);
  res.status(result.duplicated ? 200 : 201).json(ok({
    duplicated: result.duplicated,
    message: serializeMessage(result.message)
  }));
});

app.patch("/api/messages/:id/status", async (req, res) => {
  const schema = z.object({
    status: z.nativeEnum(MessageStatus),
    actorId: z.string().optional(),
    note: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json(badRequest("消息不存在"));
    return;
  }

  const updated = await prisma.message.update({
    where: { id: req.params.id },
    data: {
      status: parsed.data.status,
      lastReplyAt: parsed.data.status === MessageStatus.REPLIED ? new Date() : existing.lastReplyAt,
      ...(parsed.data.status === MessageStatus.DONE || parsed.data.status === MessageStatus.CLOSED
        ? { timeoutDeadline: null }
        : {})
    },
    include: messageInclude
  });

  await prisma.messageEvent.create({
    data: {
      messageId: existing.id,
      actorId: parsed.data.actorId,
      eventType: "status_changed",
      fromStatus: existing.status,
      toStatus: parsed.data.status,
      note: parsed.data.note
    }
  });

  res.json(ok(serializeMessage(updated)));
});

app.patch("/api/messages/:id/viewed", async (req, res) => {
  const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json(badRequest("消息不存在"));
    return;
  }

  const viewedAt = existing.viewedAt ?? new Date();
  const updated = await prisma.message.update({
    where: { id: existing.id },
    data: { viewedAt },
    include: messageInclude
  });

  if (!existing.viewedAt) {
    await prisma.messageEvent.create({
      data: {
        messageId: existing.id,
        eventType: "message_viewed",
        note: "消息已在中台点开查看。"
      }
    });
  }

  res.json(ok(serializeMessage(updated)));
});

app.patch("/api/messages/:id/assign", async (req, res) => {
  const schema = z.object({
    assignedToId: z.string().nullable(),
    actorId: z.string().optional(),
    note: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json(badRequest("消息不存在"));
    return;
  }

  const updated = await prisma.message.update({
    where: { id: req.params.id },
    data: {
      assignedToId: parsed.data.assignedToId,
      status: parsed.data.assignedToId ? MessageStatus.ASSIGNED : MessageStatus.UNASSIGNED
    },
    include: messageInclude
  });

  await prisma.messageEvent.create({
    data: {
      messageId: existing.id,
      actorId: parsed.data.actorId,
      eventType: "assigned",
      fromStatus: existing.status,
      toStatus: updated.status,
      note: parsed.data.note ?? "消息负责人已更新。"
    }
  });

  res.json(ok(serializeMessage(updated)));
});

app.post("/api/collectors/heartbeat", async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    status: z.string().optional(),
    message: z.string().optional(),
    name: z.string().optional(),
    deviceName: z.string().optional(),
    deviceType: z.string().optional(),
    location: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const collector = await prisma.collector.upsert({
    where: { token: parsed.data.token },
    update: {
      status: parsed.data.status ?? "在线",
      lastHeartbeatAt: new Date(),
      logs: parsed.data.message
        ? {
            create: {
              level: "info",
              message: parsed.data.message
            }
        }
        : undefined
    },
    create: {
      token: parsed.data.token,
      name: parsed.data.name ?? parsed.data.token,
      deviceName: parsed.data.deviceName ?? "未命名设备",
      deviceType: parsed.data.deviceType ?? "邮件中转采集器",
      location: parsed.data.location,
      status: parsed.data.status ?? "在线",
      lastHeartbeatAt: new Date(),
      logs: parsed.data.message
        ? {
            create: {
              level: "info",
              message: parsed.data.message
            }
          }
        : undefined
    }
  });

  res.json(ok(collector));
});

app.post("/api/collectors/register", async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    platform: z.string().min(1),
    platformType: z.string().optional(),
    site: z.string().optional(),
    shopName: z.string().min(1),
    deviceName: z.string().optional(),
    deviceType: z.string().optional(),
    location: z.string().optional(),
    status: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const data = parsed.data;
  const site = data.site ?? "";
  const platform = await prisma.platform.upsert({
    where: { name: data.platform },
    update: {
      type: data.platformType ?? "网页插件",
      country: site || null,
      enabled: true
    },
    create: {
      name: data.platform,
      type: data.platformType ?? "网页插件",
      country: site || null,
      enabled: true
    }
  });

  const collector = await prisma.collector.upsert({
    where: { token: data.token },
    update: {
      name: `网页插件-${data.shopName}`,
      deviceName: data.deviceName ?? data.shopName,
      deviceType: data.deviceType ?? "浏览器插件",
      location: data.location,
      status: data.status ?? "已登记",
      lastHeartbeatAt: new Date(),
      logs: {
        create: {
          level: "info",
          message: `${data.platform} / ${data.shopName} 已从插件登记。`
        }
      }
    },
    create: {
      token: data.token,
      name: `网页插件-${data.shopName}`,
      deviceName: data.deviceName ?? data.shopName,
      deviceType: data.deviceType ?? "浏览器插件",
      location: data.location,
      status: data.status ?? "已登记",
      lastHeartbeatAt: new Date(),
      logs: {
        create: {
          level: "info",
          message: `${data.platform} / ${data.shopName} 已从插件登记。`
        }
      }
    }
  });

  const shop = await prisma.shopAccount.upsert({
    where: {
      platformId_shopName_site: {
        platformId: platform.id,
        shopName: data.shopName,
        site
      }
    },
    update: {
      collectorId: collector.id,
      status: "已登记",
      riskNote: `插件登记：${data.deviceName ?? data.shopName}`
    },
    create: {
      platformId: platform.id,
      shopName: data.shopName,
      site,
      collectorId: collector.id,
      status: "已登记",
      riskNote: `插件登记：${data.deviceName ?? data.shopName}`
    },
    include: { platform: true, collector: true }
  });

  res.status(201).json(ok({ platform, collector, shop }));
});

app.get("/api/platforms", async (_req, res) => {
  const platforms = await prisma.platform.findMany({
    include: { defaultAssignee: true, shops: true },
    orderBy: { name: "asc" }
  });
  res.json(ok(platforms));
});

app.get("/api/shops", async (_req, res) => {
  const shops = await prisma.shopAccount.findMany({
    include: { platform: true, owner: true, collector: true },
    orderBy: { createdAt: "asc" }
  });
  res.json(ok(shops));
});

app.get("/api/collectors", async (_req, res) => {
  const collectors = await prisma.collector.findMany({
    include: { shops: { include: { platform: true } }, logs: { take: 5, orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "asc" }
  });
  res.json(ok(collectors));
});

app.get("/api/risk-rules", async (_req, res) => {
  const rules = await prisma.riskRule.findMany({ orderBy: { createdAt: "asc" } });
  res.json(ok(rules));
});

app.get("/api/chat-monitor/summary", async (_req, res) => {
  res.json(ok(await qualitySummary()));
});

app.get("/api/chat-monitor/alerts", async (req, res) => {
  const { status } = req.query;
  const alerts = await prisma.qualityAlert.findMany({
    where: status ? { status: String(status) as QualityAlertStatus } : {},
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(ok(alerts));
});

app.post("/api/chat-monitor/observe", async (req, res) => {
  const schema = z.object({
    platform: z.string().min(1),
    site: z.string().optional(),
    shopName: z.string().min(1),
    conversationId: z.string().min(1),
    customerName: z.string().optional(),
    speaker: z.nativeEnum(ChatSpeaker),
    content: z.string().min(1),
    sourceUrl: z.string().url().optional().or(z.literal("")),
    sourceExternalId: z.string().optional(),
    sentAt: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const result = await observeChat({
    ...parsed.data,
    sourceUrl: parsed.data.sourceUrl || undefined
  });
  res.status(result.duplicated ? 200 : 201).json(ok(result));
});

app.post("/api/chat-monitor/check-sla", async (_req, res) => {
  const alerts = await checkMissedReplies();
  res.json(ok({ count: alerts.length, alerts }));
});

app.patch("/api/chat-monitor/alerts/:id/status", async (req, res) => {
  const schema = z.object({
    status: z.nativeEnum(QualityAlertStatus)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.message));
    return;
  }

  const alert = await prisma.qualityAlert.update({
    where: { id: req.params.id },
    data: {
      status: parsed.data.status,
      resolvedAt: parsed.data.status === QualityAlertStatus.RESOLVED ? new Date() : null
    }
  });
  res.json(ok(alert));
});

app.post("/api/timers/mark-timeouts", async (_req, res) => {
  const now = new Date();
  const result = await prisma.message.updateMany({
    where: {
      timeoutDeadline: { lte: now },
      status: {
        in: [
          MessageStatus.NEW,
          MessageStatus.UNASSIGNED,
          MessageStatus.ASSIGNED,
          MessageStatus.IN_PROGRESS,
          MessageStatus.ESCALATED,
          MessageStatus.MANUAL_REVIEW
        ]
      }
    },
    data: { status: MessageStatus.TIMEOUT }
  });

  res.json(ok(result));
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json(badRequest("服务器内部错误"));
});

app.listen(port, () => {
  console.log(`Message hub API listening on http://localhost:${port}`);
});
