import { ChatSpeaker, Role, SourceType } from "@prisma/client";
import { ingestMessage } from "../src/domain.js";
import { prisma } from "../src/prisma.js";
import { observeChat } from "../src/quality.js";
async function ensureUser(name, role, languageSkills) {
    const existing = await prisma.user.findFirst({ where: { name } });
    if (existing)
        return existing;
    return prisma.user.create({ data: { name, role, languageSkills } });
}
export async function applyPhaseOneSetup(options = {}) {
    const [owner, supervisor, twAgent, enAgent, jaAgent, tech] = await Promise.all([
        ensureUser("老板", Role.OWNER, "zh,en,ja"),
        ensureUser("客服组长", Role.SUPERVISOR, "zh,en"),
        ensureUser("台湾客服A", Role.AGENT, "zh"),
        ensureUser("英语客服A", Role.AGENT, "en,ms"),
        ensureUser("日语客服A", Role.AGENT, "ja"),
        ensureUser("技术管理员", Role.TECH, "zh")
    ]);
    const collectorSeeds = [
        {
            token: "collector-email-main",
            name: "邮箱采集器-eBay/Game Club",
            deviceName: "中台电脑",
            deviceType: "IMAP多邮箱采集器",
            location: "本地电脑",
            ipNote: "读取 eBay 和 Game Club 对应邮箱",
            status: "待填IMAP"
        },
        {
            token: "collector-shopee-tw-01",
            name: "网页插件-Shopee台湾店1",
            deviceName: "云端浏览器-Shopee台湾店1",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-shopee-tw-02",
            name: "网页插件-Shopee台湾店2",
            deviceName: "云端浏览器-Shopee台湾店2",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-shopee-tw-03",
            name: "网页插件-Shopee台湾店3",
            deviceName: "云端浏览器-Shopee台湾店3",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-shopee-tw-04",
            name: "网页插件-Shopee台湾店4",
            deviceName: "云端浏览器-Shopee台湾店4",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-shopee-my-01",
            name: "网页插件-Shopee马来店1",
            deviceName: "云端浏览器-Shopee马来店1",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-discord-01",
            name: "网页插件-Discord环境1",
            deviceName: "Discord聊天环境1",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        },
        {
            token: "collector-discord-02",
            name: "网页插件-Discord环境2",
            deviceName: "Discord聊天环境2",
            deviceType: "浏览器插件",
            location: "本地云端浏览器",
            ipNote: "插件直连 http://127.0.0.1:4100",
            status: "待安装插件"
        }
    ];
    const collectors = await Promise.all(collectorSeeds.map((seed) => prisma.collector.upsert({
        where: { token: seed.token },
        update: {
            name: seed.name,
            deviceName: seed.deviceName,
            deviceType: seed.deviceType,
            location: seed.location,
            ipNote: seed.ipNote,
            ...(options.overwriteCollectorStatus ? { status: seed.status } : {})
        },
        create: {
            ...seed,
            lastHeartbeatAt: seed.status === "在线" ? new Date() : null
        }
    })));
    const collectorByToken = new Map(collectors.map((collector) => [collector.token, collector]));
    const platformSeeds = [
        { name: "eBay", type: "邮件IMAP", country: "US", assigneeId: enAgent.id },
        { name: "Game Club", type: "邮件IMAP", country: "JP", assigneeId: jaAgent.id },
        { name: "Shopee TW", type: "网页插件", country: "TW", assigneeId: twAgent.id },
        { name: "Shopee MY", type: "网页插件", country: "MY", assigneeId: enAgent.id },
        { name: "Discord", type: "网页聊天插件", country: "Global", assigneeId: supervisor.id }
    ];
    const platforms = await Promise.all(platformSeeds.map((seed) => prisma.platform.upsert({
        where: { name: seed.name },
        update: {
            type: seed.type,
            country: seed.country,
            enabled: true,
            defaultAssigneeId: seed.assigneeId
        },
        create: {
            name: seed.name,
            type: seed.type,
            country: seed.country,
            defaultAssigneeId: seed.assigneeId
        }
    })));
    const platformByName = new Map(platforms.map((platform) => [platform.name, platform]));
    const shopSeeds = [
        {
            platform: "eBay",
            shopName: "扬总 eBay",
            site: "US",
            ownerId: enAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：dsmxw20@163.com。"
        },
        {
            platform: "eBay",
            shopName: "青瓜 eBay",
            site: "US",
            ownerId: enAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：dsmxw20@163.com。"
        },
        {
            platform: "eBay",
            shopName: "yukl eBay",
            site: "US",
            ownerId: enAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：dsmxw20@163.com。"
        },
        {
            platform: "eBay",
            shopName: "Winnie 的 eBay",
            site: "US",
            ownerId: enAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：dsmxwwangkang10@163.com。"
        },
        {
            platform: "Game Club",
            shopName: "老gc",
            site: "JP",
            ownerId: jaAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：jianz551@163.com。"
        },
        {
            platform: "Game Club",
            shopName: "gc2",
            site: "JP",
            ownerId: jaAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：rukwzg@163.com。"
        },
        {
            platform: "Game Club",
            shopName: "gc3",
            site: "JP",
            ownerId: jaAgent.id,
            collectorToken: "collector-email-main",
            status: "待填IMAP",
            riskNote: "第一阶段走邮箱 IMAP 接入，邮箱：zbhth51@163.com。"
        },
        {
            platform: "Shopee TW",
            shopName: "Shopee 台湾店1",
            site: "TW",
            ownerId: twAgent.id,
            collectorToken: "collector-shopee-tw-01",
            status: "待安装插件",
            riskNote: "必须在对应云端浏览器安装插件，直连本机中台。"
        },
        {
            platform: "Shopee TW",
            shopName: "Shopee 台湾店2",
            site: "TW",
            ownerId: twAgent.id,
            collectorToken: "collector-shopee-tw-02",
            status: "待安装插件",
            riskNote: "必须在对应云端浏览器安装插件，直连本机中台。"
        },
        {
            platform: "Shopee TW",
            shopName: "Shopee 台湾店3",
            site: "TW",
            ownerId: twAgent.id,
            collectorToken: "collector-shopee-tw-03",
            status: "待安装插件",
            riskNote: "必须在对应云端浏览器安装插件，直连本机中台。"
        },
        {
            platform: "Shopee TW",
            shopName: "Shopee 台湾店4",
            site: "TW",
            ownerId: twAgent.id,
            collectorToken: "collector-shopee-tw-04",
            status: "待安装插件",
            riskNote: "必须在对应云端浏览器安装插件，直连本机中台。"
        },
        {
            platform: "Shopee MY",
            shopName: "Shopee 马来店1",
            site: "MY",
            ownerId: enAgent.id,
            collectorToken: "collector-shopee-my-01",
            status: "待安装插件",
            riskNote: "必须在对应云端浏览器安装插件，直连本机中台。"
        },
        {
            platform: "Discord",
            shopName: "Discord 环境1",
            site: "GLOBAL",
            ownerId: supervisor.id,
            collectorToken: "collector-discord-01",
            status: "待安装插件",
            riskNote: "按网页聊天环境巡检，重点看漏回复和违规回复。"
        },
        {
            platform: "Discord",
            shopName: "Discord 环境2",
            site: "GLOBAL",
            ownerId: supervisor.id,
            collectorToken: "collector-discord-02",
            status: "待安装插件",
            riskNote: "按网页聊天环境巡检，重点看漏回复和违规回复。"
        }
    ];
    for (const seed of shopSeeds) {
        const platform = platformByName.get(seed.platform);
        const collector = collectorByToken.get(seed.collectorToken);
        if (!platform)
            continue;
        await prisma.shopAccount.upsert({
            where: {
                platformId_shopName_site: {
                    platformId: platform.id,
                    shopName: seed.shopName,
                    site: seed.site
                }
            },
            update: {
                ownerId: seed.ownerId,
                collectorId: collector?.id,
                status: seed.status,
                riskNote: seed.riskNote
            },
            create: {
                platformId: platform.id,
                shopName: seed.shopName,
                site: seed.site,
                ownerId: seed.ownerId,
                collectorId: collector?.id,
                status: seed.status,
                riskNote: seed.riskNote
            }
        });
    }
    const riskRules = [
        {
            name: "退款风险",
            language: "multi",
            keywords: "退款, refund, reembolso, 返金, chargeback, cancel order, キャンセル",
            priority: "P0",
            riskLevel: "CRITICAL",
            messageType: "退款"
        },
        {
            name: "纠纷投诉",
            language: "multi",
            keywords: "投诉, dispute, claim, case, complaint, queja, 通報, 苦情, 平台介入",
            priority: "P0",
            riskLevel: "CRITICAL",
            messageType: "投诉/纠纷"
        },
        {
            name: "差评风险",
            language: "multi",
            keywords: "差评, bad review, negative feedback, 悪い評価, mala reseña",
            priority: "P0",
            riskLevel: "HIGH",
            messageType: "差评风险"
        },
        {
            name: "催单交付",
            language: "multi",
            keywords: "什么时候, 还没送到, not received, deliver, delivery, 届かない, tidak terima",
            priority: "P1",
            riskLevel: "HIGH",
            messageType: "催单/交付"
        },
        {
            name: "封号风险",
            language: "multi",
            keywords: "封号, banned, account suspended, アカウント停止",
            priority: "P0",
            riskLevel: "CRITICAL",
            messageType: "封号风险"
        }
    ];
    for (const rule of riskRules) {
        const existing = await prisma.riskRule.findFirst({ where: { name: rule.name } });
        if (existing) {
            await prisma.riskRule.update({ where: { id: existing.id }, data: rule });
        }
        else {
            await prisma.riskRule.create({ data: rule });
        }
    }
    const alertRules = [
        { name: "P0 立即升级", priority: "P0", firstSlaMinutes: 1, escalateMinutes: 3, channels: "声音,弹窗,老板提醒" },
        { name: "P1 强提醒", priority: "P1", firstSlaMinutes: 3, escalateMinutes: 5, channels: "声音,弹窗,客服提醒" },
        { name: "P2 普通提醒", priority: "P2", firstSlaMinutes: 10, escalateMinutes: 15, channels: "红点,普通提醒" }
    ];
    for (const rule of alertRules) {
        const existing = await prisma.alertRule.findFirst({ where: { name: rule.name } });
        if (existing) {
            await prisma.alertRule.update({ where: { id: existing.id }, data: rule });
        }
        else {
            await prisma.alertRule.create({ data: rule });
        }
    }
    if (options.includeSamples) {
        await ingestMessage({
            platform: "eBay",
            site: "US",
            shopName: "扬总 eBay",
            accountEnvironment: "中台电脑 / 邮箱IMAP",
            customerName: "John",
            orderId: "EB-10086",
            content: "I still have not received my item. If you do not reply, I will open a case.",
            sourceType: SourceType.EMAIL,
            sourceUrl: "https://www.ebay.com/",
            sourceExternalId: "phase1-ebay-case-1",
            receivedAt: new Date().toISOString()
        });
        await ingestMessage({
            platform: "Game Club",
            site: "JP",
            shopName: "老gc",
            accountEnvironment: "中台电脑 / 邮箱IMAP",
            customerName: "山田",
            content: "商品が届かないので返金できますか？",
            sourceType: SourceType.EMAIL,
            sourceExternalId: "phase1-gameclub-refund-1",
            receivedAt: new Date().toISOString()
        });
        await ingestMessage({
            platform: "Shopee TW",
            site: "TW",
            shopName: "Shopee 台湾店1",
            accountEnvironment: "云端浏览器-Shopee台湾店1 / 浏览器插件",
            customerName: "王先生",
            content: "請問什麼時候可以出貨？我昨天已經付款。",
            sourceType: SourceType.WEB,
            sourceUrl: "https://seller.shopee.tw/",
            sourceExternalId: "phase1-shopee-tw-delivery-1",
            receivedAt: new Date().toISOString()
        });
        await ingestMessage({
            platform: "Shopee MY",
            site: "MY",
            shopName: "Shopee 马来店1",
            accountEnvironment: "云端浏览器-Shopee马来店1 / 浏览器插件",
            customerName: "Ahmad",
            content: "When can you deliver? I already paid yesterday.",
            sourceType: SourceType.WEB,
            sourceUrl: "https://seller.shopee.com.my/",
            sourceExternalId: "phase1-shopee-my-delivery-1",
            receivedAt: new Date().toISOString()
        });
        const slowCustomerAt = new Date(Date.now() - 9 * 60 * 1000);
        const slowAgentAt = new Date(Date.now() - 2 * 60 * 1000);
        await observeChat({
            platform: "Shopee TW",
            site: "TW",
            shopName: "Shopee 台湾店1",
            conversationId: "phase1-chat-shopee-tw-1",
            customerName: "王先生",
            speaker: ChatSpeaker.CUSTOMER,
            content: "我付款了，为什么还没有出货？",
            sourceUrl: "https://seller.shopee.tw/",
            sourceExternalId: "phase1-quality-customer-tw-1",
            sentAt: slowCustomerAt.toISOString()
        });
        await observeChat({
            platform: "Shopee TW",
            site: "TW",
            shopName: "Shopee 台湾店1",
            conversationId: "phase1-chat-shopee-tw-1",
            customerName: "王先生",
            speaker: ChatSpeaker.AGENT,
            content: "ok",
            sourceUrl: "https://seller.shopee.tw/",
            sourceExternalId: "phase1-quality-agent-tw-1",
            sentAt: slowAgentAt.toISOString()
        });
        await observeChat({
            platform: "Discord",
            site: "GLOBAL",
            shopName: "Discord 环境1",
            conversationId: "phase1-chat-discord-1",
            customerName: "Alex",
            speaker: ChatSpeaker.AGENT,
            content: "You can add my WhatsApp and pay directly outside platform.",
            sourceUrl: "https://discord.com/channels/@me",
            sourceExternalId: "phase1-quality-discord-violation-1",
            sentAt: new Date().toISOString()
        });
    }
    return {
        users: [owner, supervisor, twAgent, enAgent, jaAgent, tech].length,
        collectors: collectorSeeds.length,
        platforms: platformSeeds.length,
        shops: shopSeeds.length
    };
}
