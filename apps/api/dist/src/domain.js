import crypto from "node:crypto";
import { MessageStatus, Priority, RiskLevel, SourceType } from "@prisma/client";
import { prisma } from "./prisma.js";
export const priorityRank = {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4
};
export const riskRank = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3
};
const slaMinutes = {
    P0: 3,
    P1: 5,
    P2: 15,
    P3: 30,
    P4: null
};
export function normalizeSourceType(value) {
    const normalized = value.toUpperCase();
    if (normalized === "DESKTOP")
        return SourceType.DESKTOP_NOTIFICATION;
    if (normalized === "MOBILE")
        return SourceType.MOBILE_NOTIFICATION;
    if (normalized in SourceType)
        return normalized;
    return SourceType.API;
}
export function detectLanguage(text) {
    if (/[\u3040-\u30ff\u3400-\u4dbf]/.test(text))
        return "ja";
    if (/[\u4e00-\u9fff]/.test(text))
        return "zh";
    if (/\b(reembolso|queja|disputa|recibido|pedido)\b/i.test(text))
        return "es";
    if (/\b(aduan|tidak|terima|batalkan|pesanan)\b/i.test(text))
        return "ms";
    return "en";
}
export function buildFingerprint(payload, platformId, shopId) {
    const base = payload.sourceExternalId
        ? `${platformId}:${shopId ?? "no-shop"}:${payload.sourceType}:${payload.sourceExternalId}`
        : [
            platformId,
            shopId ?? "no-shop",
            payload.sourceType,
            payload.conversationId ?? payload.customerId ?? payload.customerName ?? "unknown",
            payload.orderId ?? "",
            payload.content.trim().slice(0, 180)
        ].join("|");
    return crypto.createHash("sha1").update(base.toLowerCase()).digest("hex");
}
export async function evaluateRisk(content, fallbackType = "普通咨询") {
    const rules = await prisma.riskRule.findMany({ where: { enabled: true } });
    const text = content.toLowerCase();
    const matches = rules.filter((rule) => {
        const keywords = rule.keywords
            .split(/\r?\n|,/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        return keywords.some((keyword) => text.includes(keyword));
    });
    if (matches.length === 0) {
        return {
            priority: Priority.P2,
            riskLevel: RiskLevel.LOW,
            messageType: fallbackType,
            tags: []
        };
    }
    const best = matches.sort((a, b) => {
        const priorityDiff = priorityRank[a.priority] - priorityRank[b.priority];
        if (priorityDiff !== 0)
            return priorityDiff;
        return riskRank[a.riskLevel] - riskRank[b.riskLevel];
    })[0];
    return {
        priority: best.priority,
        riskLevel: best.riskLevel,
        messageType: best.messageType,
        tags: matches.map((rule) => rule.name)
    };
}
export function summarize(content, language, messageType, riskLevel) {
    const trimmed = content.replace(/\s+/g, " ").trim();
    const short = trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
    const riskText = riskLevel === RiskLevel.CRITICAL || riskLevel === RiskLevel.HIGH ? "高风险" : "普通";
    const languageText = {
        en: "英文",
        ja: "日文",
        zh: "中文",
        es: "西班牙文",
        ms: "马来文"
    };
    return `${languageText[language] ?? "外语"}客户消息：${short}。系统判断为${riskText}${messageType}，建议尽快人工确认。`;
}
export function getTimeoutDeadline(priority, detectedAt) {
    const minutes = slaMinutes[priority];
    if (minutes === null)
        return null;
    return new Date(detectedAt.getTime() + minutes * 60 * 1000);
}
export async function ingestMessage(payload) {
    const platform = await prisma.platform.upsert({
        where: { name: payload.platform },
        update: { enabled: true },
        create: {
            name: payload.platform,
            type: payload.sourceType === SourceType.EMAIL ? "邮件" : payload.sourceType === SourceType.WEB ? "网页" : "通知",
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
            riskNote: payload.accountEnvironment ? `环境：${payload.accountEnvironment}` : null
        },
        include: {
            owner: true
        }
    });
    const language = payload.language ?? detectLanguage(payload.content);
    const risk = await evaluateRisk(payload.content, payload.messageType ?? "普通咨询");
    const detectedAt = payload.detectedAt ? new Date(payload.detectedAt) : new Date();
    const fingerprint = buildFingerprint(payload, platform.id, shop.id);
    const assignedToId = shop.ownerId ?? platform.defaultAssigneeId ?? null;
    const existing = await prisma.message.findUnique({ where: { fingerprint } });
    if (existing) {
        const updated = await prisma.message.update({
            where: { id: existing.id },
            data: {
                duplicateCount: { increment: 1 },
                detectedAt,
                content: payload.content || existing.content
            },
            include: messageInclude
        });
        await prisma.messageEvent.create({
            data: {
                messageId: existing.id,
                eventType: "duplicate_detected",
                note: "收到重复来源提醒，已合并到原消息。"
            }
        });
        return { message: updated, duplicated: true };
    }
    const status = assignedToId ? MessageStatus.ASSIGNED : MessageStatus.UNASSIGNED;
    const message = await prisma.message.create({
        data: {
            platformId: platform.id,
            shopAccountId: shop.id,
            customerName: payload.customerName ?? null,
            customerId: payload.customerId ?? null,
            conversationId: payload.conversationId ?? null,
            orderId: payload.orderId ?? null,
            productName: payload.productName ?? null,
            content: payload.content,
            rawContent: payload.rawContent ?? payload.content,
            sourceType: payload.sourceType,
            sourceUrl: payload.sourceUrl ?? null,
            sourceExternalId: payload.sourceExternalId ?? null,
            fingerprint,
            messageType: risk.messageType,
            priority: risk.priority,
            riskLevel: risk.riskLevel,
            language,
            summary: summarize(payload.content, language, risk.messageType, risk.riskLevel),
            status,
            assignedToId,
            receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : null,
            detectedAt,
            timeoutDeadline: getTimeoutDeadline(risk.priority, detectedAt),
            tags: JSON.stringify([...(payload.tags ?? []), ...risk.tags])
        },
        include: messageInclude
    });
    await prisma.messageEvent.create({
        data: {
            messageId: message.id,
            eventType: "message_ingested",
            toStatus: status,
            note: "新消息进入统一消息池。"
        }
    });
    return { message, duplicated: false };
}
export const messageInclude = {
    platform: true,
    shopAccount: true,
    assignedTo: true,
    events: {
        orderBy: { createdAt: "desc" },
        include: { actor: true }
    }
};
export function parseTags(tags) {
    if (!tags)
        return [];
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export function serializeMessage(message) {
    return {
        ...message,
        tags: parseTags(message.tags)
    };
}
