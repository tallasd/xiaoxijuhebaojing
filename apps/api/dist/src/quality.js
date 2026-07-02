import crypto from "node:crypto";
import { ChatSpeaker, QualityAlertStatus, QualityAlertType, RiskLevel, SourceType } from "@prisma/client";
import { ingestMessage } from "./domain.js";
import { prisma } from "./prisma.js";
const slowReplyMinutes = 5;
const violationKeywords = [
    "微信",
    "wechat",
    "line",
    "whatsapp",
    "telegram",
    "qq",
    "支付宝",
    "alipay",
    "银行卡",
    "线下",
    "私下",
    "私聊",
    "加我",
    "outside platform",
    "pay directly",
    "bank transfer"
];
const perfunctoryReplies = [
    "嗯",
    "哦",
    "好的",
    "好",
    "稍等",
    "不知道",
    "不清楚",
    "自己看",
    "ok",
    "k",
    "wait",
    "later",
    "no idea"
];
function fingerprint(parts) {
    return crypto.createHash("sha1").update(parts.filter(Boolean).join("|").toLowerCase()).digest("hex");
}
function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}
async function resolvePlatformAndShop(payload) {
    const platform = await prisma.platform.upsert({
        where: { name: payload.platform },
        update: { enabled: true },
        create: {
            name: payload.platform,
            type: "web-chat",
            country: payload.site ?? null
        }
    });
    const shop = await prisma.shopAccount.upsert({
        where: {
            platformId_shopName_site: {
                platformId: platform.id,
                shopName: payload.shopName,
                site: payload.site ?? ""
            }
        },
        update: {},
        create: {
            platformId: platform.id,
            shopName: payload.shopName,
            site: payload.site ?? "",
            status: "正常"
        }
    });
    return { platform, shop };
}
async function createAlert(data) {
    const alertFingerprint = fingerprint(data.fingerprintParts);
    const existing = await prisma.qualityAlert.findUnique({ where: { fingerprint: alertFingerprint } });
    if (existing)
        return existing;
    return prisma.qualityAlert.create({
        data: {
            fingerprint: alertFingerprint,
            observationId: data.observationId,
            platformId: data.platformId,
            shopAccountId: data.shopAccountId,
            platformName: data.platformName,
            shopName: data.shopName,
            conversationId: data.conversationId,
            customerName: data.customerName,
            alertType: data.alertType,
            severity: data.severity,
            title: data.title,
            detail: data.detail,
            sourceUrl: data.sourceUrl
        }
    });
}
function findViolation(content) {
    const text = normalizeText(content);
    return violationKeywords.find((keyword) => text.includes(keyword.toLowerCase()));
}
function isPerfunctory(content) {
    const text = normalizeText(content);
    if (text.length <= 2)
        return true;
    return perfunctoryReplies.some((reply) => text === reply || text === `${reply}.` || text === `${reply}!`);
}
async function evaluateAgentReply(observation) {
    const created = [];
    const violation = findViolation(observation.content);
    if (violation) {
        created.push(await createAlert({
            observationId: observation.id,
            platformId: observation.platformId ?? undefined,
            shopAccountId: observation.shopAccountId ?? undefined,
            platformName: observation.platformName,
            shopName: observation.shopName,
            conversationId: observation.conversationId,
            customerName: observation.customerName,
            alertType: QualityAlertType.VIOLATION,
            severity: RiskLevel.CRITICAL,
            title: "客服回复可能违规",
            detail: `客服回复中出现敏感词「${violation}」，需要主管复核。`,
            sourceUrl: observation.sourceUrl,
            fingerprintParts: ["violation", observation.id, violation]
        }));
    }
    if (isPerfunctory(observation.content)) {
        created.push(await createAlert({
            observationId: observation.id,
            platformId: observation.platformId ?? undefined,
            shopAccountId: observation.shopAccountId ?? undefined,
            platformName: observation.platformName,
            shopName: observation.shopName,
            conversationId: observation.conversationId,
            customerName: observation.customerName,
            alertType: QualityAlertType.PERFUNCTORY,
            severity: RiskLevel.HIGH,
            title: "客服回复过于简单",
            detail: `客服回复「${observation.content}」可能不足以解决客户问题。`,
            sourceUrl: observation.sourceUrl,
            fingerprintParts: ["perfunctory", observation.id]
        }));
    }
    const replyAt = observation.sentAt ?? observation.detectedAt;
    const previousCustomer = await prisma.chatObservation.findFirst({
        where: {
            conversationId: observation.conversationId,
            speaker: ChatSpeaker.CUSTOMER,
            detectedAt: { lt: observation.detectedAt }
        },
        orderBy: { detectedAt: "desc" }
    });
    if (previousCustomer) {
        const waitedMinutes = Math.floor((replyAt.getTime() - (previousCustomer.sentAt ?? previousCustomer.detectedAt).getTime()) / 60000);
        if (waitedMinutes >= slowReplyMinutes) {
            created.push(await createAlert({
                observationId: observation.id,
                platformId: observation.platformId ?? undefined,
                shopAccountId: observation.shopAccountId ?? undefined,
                platformName: observation.platformName,
                shopName: observation.shopName,
                conversationId: observation.conversationId,
                customerName: observation.customerName ?? previousCustomer.customerName,
                alertType: QualityAlertType.SLOW_REPLY,
                severity: RiskLevel.HIGH,
                title: "客服回复不及时",
                detail: `客户等待约 ${waitedMinutes} 分钟后才收到回复，超过 ${slowReplyMinutes} 分钟质检线。`,
                sourceUrl: observation.sourceUrl,
                fingerprintParts: ["slow-reply", observation.conversationId, previousCustomer.id, observation.id]
            }));
        }
    }
    return created;
}
export async function observeChat(payload) {
    const { platform, shop } = await resolvePlatformAndShop(payload);
    const sourceExternalId = payload.sourceExternalId ??
        fingerprint([
            payload.platform,
            payload.shopName,
            payload.conversationId,
            payload.speaker,
            payload.content.slice(0, 180),
            payload.sentAt
        ]);
    const existing = await prisma.chatObservation.findUnique({ where: { sourceExternalId } });
    if (existing)
        return { observation: existing, alerts: [], duplicated: true };
    const observation = await prisma.chatObservation.create({
        data: {
            platformId: platform.id,
            shopAccountId: shop.id,
            platformName: payload.platform,
            shopName: payload.shopName,
            site: payload.site ?? "",
            conversationId: payload.conversationId,
            customerName: payload.customerName,
            speaker: payload.speaker,
            content: payload.content,
            sourceUrl: payload.sourceUrl,
            sourceExternalId,
            sentAt: payload.sentAt ? new Date(payload.sentAt) : null
        }
    });
    if (payload.speaker === ChatSpeaker.CUSTOMER) {
        await ingestMessage({
            platform: payload.platform,
            site: payload.site,
            shopName: payload.shopName,
            customerName: payload.customerName,
            conversationId: payload.conversationId,
            content: payload.content,
            sourceType: SourceType.WEB,
            sourceUrl: payload.sourceUrl,
            sourceExternalId: `chat-${sourceExternalId}`,
            receivedAt: payload.sentAt,
            tags: ["browser-chat"]
        });
    }
    const alerts = payload.speaker === ChatSpeaker.AGENT ? await evaluateAgentReply(observation) : [];
    return { observation, alerts, duplicated: false };
}
export async function checkMissedReplies() {
    const threshold = new Date(Date.now() - slowReplyMinutes * 60 * 1000);
    const candidates = await prisma.chatObservation.findMany({
        where: {
            speaker: ChatSpeaker.CUSTOMER,
            detectedAt: { lte: threshold }
        },
        orderBy: { detectedAt: "desc" },
        take: 300
    });
    const created = [];
    for (const customerMessage of candidates) {
        const laterAgent = await prisma.chatObservation.findFirst({
            where: {
                conversationId: customerMessage.conversationId,
                speaker: ChatSpeaker.AGENT,
                detectedAt: { gt: customerMessage.detectedAt }
            },
            orderBy: { detectedAt: "asc" }
        });
        if (laterAgent)
            continue;
        const waitedMinutes = Math.floor((Date.now() - customerMessage.detectedAt.getTime()) / 60000);
        created.push(await createAlert({
            observationId: customerMessage.id,
            platformId: customerMessage.platformId ?? undefined,
            shopAccountId: customerMessage.shopAccountId ?? undefined,
            platformName: customerMessage.platformName,
            shopName: customerMessage.shopName,
            conversationId: customerMessage.conversationId,
            customerName: customerMessage.customerName,
            alertType: QualityAlertType.MISSED_MESSAGE,
            severity: RiskLevel.CRITICAL,
            title: "客户消息未及时回复",
            detail: `客户消息已经等待约 ${waitedMinutes} 分钟，还没有检测到客服回复。`,
            sourceUrl: customerMessage.sourceUrl,
            fingerprintParts: ["missed-message", customerMessage.id]
        }));
    }
    return created;
}
export async function qualitySummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [openAlerts, criticalAlerts, observedToday, byType, latestAlerts] = await Promise.all([
        prisma.qualityAlert.count({ where: { status: QualityAlertStatus.OPEN } }),
        prisma.qualityAlert.count({ where: { status: QualityAlertStatus.OPEN, severity: RiskLevel.CRITICAL } }),
        prisma.chatObservation.count({ where: { detectedAt: { gte: today } } }),
        prisma.qualityAlert.groupBy({
            by: ["alertType"],
            where: { createdAt: { gte: today } },
            _count: true
        }),
        prisma.qualityAlert.findMany({
            where: { status: QualityAlertStatus.OPEN },
            orderBy: { createdAt: "desc" },
            take: 20
        })
    ]);
    return { openAlerts, criticalAlerts, observedToday, byType, latestAlerts };
}
