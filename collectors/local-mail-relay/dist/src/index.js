import "dotenv/config";
import cors from "cors";
import express from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
const envSchema = z.object({
    PORT: z.coerce.number().default(4222),
    DEVICE_NAME: z.string().default("未命名远程电脑"),
    DEVICE_TYPE: z.string().default("Remote PC"),
    LOCATION: z.string().optional(),
    COLLECTOR_TOKEN: z.string().default("collector-local-mail-relay"),
    SMTP_HOST: z.string(),
    SMTP_PORT: z.coerce.number().default(465),
    SMTP_SECURE: z.coerce.boolean().default(true),
    SMTP_USER: z.string(),
    SMTP_PASS: z.string(),
    MAIL_FROM: z.string(),
    HUB_MAIL_TO: z.string()
});
const env = envSchema.parse(process.env);
const app = express();
const messageSchema = z.object({
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
    sourceUrl: z.string().optional(),
    sourceExternalId: z.string().optional(),
    receivedAt: z.string().optional(),
    detectedAt: z.string().optional(),
    language: z.string().optional(),
    tags: z.array(z.string()).optional()
});
const chatSchema = z.object({
    platform: z.string().min(1),
    site: z.string().optional(),
    shopName: z.string().min(1),
    conversationId: z.string().min(1),
    customerName: z.string().optional(),
    speaker: z.enum(["CUSTOMER", "AGENT", "SYSTEM"]),
    content: z.string().min(1),
    sourceUrl: z.string().optional(),
    sourceExternalId: z.string().optional(),
    sentAt: z.string().optional()
});
const heartbeatSchema = z.object({
    token: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional()
});
const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
    }
});
app.use(cors());
app.use(express.json({ limit: "2mb" }));
function subjectFor(kind, payload) {
    const platform = String(payload.platform ?? "system");
    const shop = String(payload.shopName ?? env.DEVICE_NAME);
    return `[客服中台][${kind}][${platform}][${shop}]`;
}
async function sendRelayMail(kind, payload) {
    const envelope = {
        schema: "xiaoxijuhe.mail-relay.v1",
        kind,
        collector: {
            token: env.COLLECTOR_TOKEN,
            deviceName: env.DEVICE_NAME,
            deviceType: env.DEVICE_TYPE,
            location: env.LOCATION
        },
        payload,
        createdAt: new Date().toISOString()
    };
    await transporter.sendMail({
        from: env.MAIL_FROM,
        to: env.HUB_MAIL_TO,
        subject: subjectFor(kind, payload),
        text: JSON.stringify(envelope, null, 2)
    });
    return envelope;
}
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "local-mail-relay",
        deviceName: env.DEVICE_NAME,
        collectorToken: env.COLLECTOR_TOKEN
    });
});
app.post("/api/messages/ingest", async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.message });
        return;
    }
    const envelope = await sendRelayMail("message_ingest", {
        ...parsed.data,
        accountEnvironment: parsed.data.accountEnvironment ?? env.DEVICE_NAME,
        tags: [...(parsed.data.tags ?? []), "mail-relay"]
    });
    res.status(202).json({ ok: true, data: { queued: true, envelopeId: envelope.createdAt } });
});
app.post("/api/chat-monitor/observe", async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.message });
        return;
    }
    const envelope = await sendRelayMail("chat_observe", parsed.data);
    res.status(202).json({ ok: true, data: { queued: true, envelopeId: envelope.createdAt } });
});
app.post("/api/collectors/heartbeat", async (req, res) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.message });
        return;
    }
    const envelope = await sendRelayMail("collector_heartbeat", {
        token: parsed.data.token ?? env.COLLECTOR_TOKEN,
        status: parsed.data.status ?? "在线",
        message: parsed.data.message ?? "本地邮件中转采集器心跳。"
    });
    res.status(202).json({ ok: true, data: { queued: true, envelopeId: envelope.createdAt } });
});
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "本地邮件中转失败" });
});
app.listen(env.PORT, "127.0.0.1", () => {
    console.log(`Local mail relay listening on http://127.0.0.1:${env.PORT}`);
});
