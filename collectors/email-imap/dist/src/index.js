import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { z } from "zod";
const booleanEnv = z.preprocess((value) => {
    if (typeof value !== "string")
        return value;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized))
        return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized))
        return false;
    return value;
}, z.boolean());
const baseEnvSchema = z.object({
    HUB_API_URL: z.string().url().default("http://localhost:4100"),
    COLLECTOR_TOKEN: z.string().default("collector-email-main"),
    POLL_SECONDS: z.coerce.number().int().positive().default(600),
    HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(300),
    MAX_MESSAGES_PER_POLL: z.coerce.number().int().positive().default(5),
    MAX_UID_CATCHUP_WINDOW: z.coerce.number().int().positive().default(50),
    LIMIT_BACKOFF_MINUTES: z.coerce.number().int().positive().default(60),
    FETCH_BODY_ENABLED: booleanEnv.default(false),
    BODY_FETCH_DISABLED_PLATFORMS: z.string().default("eBay"),
    IMAP_PUSH_ENABLED: booleanEnv.default(true),
    PUSH_DEBOUNCE_MS: z.coerce.number().int().positive().default(1500),
    INITIAL_SYNC_MODE: z.enum(["skip_old", "latest"]).default("skip_old"),
    INITIAL_LOOKBACK: z.coerce.number().int().nonnegative().default(10),
    IMAP_STATE_FILE: z.string().default(".email-imap-state.json"),
    INGEST_UNKNOWN: booleanEnv.default(false),
    MAIL_ACCOUNTS_JSON: z.string().optional(),
    IMAP_HOST: z.string().optional(),
    IMAP_PORT: z.coerce.number().default(993),
    IMAP_SECURE: booleanEnv.default(true),
    IMAP_USER: z.string().optional(),
    IMAP_PASS: z.string().optional(),
    IMAP_MAILBOX: z.string().default("INBOX"),
    DEFAULT_SHOP: z.string().default("默认店铺"),
    DEFAULT_PLATFORM: z.string().optional(),
    DEFAULT_SITE: z.string().optional()
});
const mailAccountSchema = z.object({
    name: z.string(),
    collectorToken: z.string().optional(),
    host: z.string(),
    port: z.coerce.number().default(993),
    secure: booleanEnv.default(true),
    user: z.string(),
    pass: z.string(),
    mailbox: z.string().default("INBOX"),
    defaultShop: z.string().default("默认店铺"),
    defaultPlatform: z.string().optional(),
    defaultSite: z.string().optional()
});
const env = baseEnvSchema.parse(process.env);
const stateFilePath = path.resolve(process.cwd(), env.IMAP_STATE_FILE);
const bodyFetchDisabledPlatforms = new Set(env.BODY_FETCH_DISABLED_PLATFORMS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
const platformRules = [
    {
        platform: "eBay",
        site: "US",
        from: ["ebay", "member@ebay", "messages.ebay"],
        subject: [
            "sent a message about",
            "you made the sale",
            "buyer wants to cancel",
            "new offer",
            "we sent your payout",
            "has been listed",
            "item not received request",
            "counterfeit policy",
            "buyer received your refund",
            "order disputed",
            "dispute lost",
            "message received from",
            "your order needs a reply",
            "buyer sent a message"
        ],
        allowSubjectOnly: true
    },
    {
        platform: "GameTrade",
        site: "JP",
        from: ["gametrade", "game-trade", "ゲームトレード"],
        subject: ["gametrade", "ゲームトレード"],
        allowSubjectOnly: true
    },
    {
        platform: "Game Club",
        site: "JP",
        from: ["gameclub", "game club", "ゲームクラブ"],
        subject: ["gameclub", "game club", "ゲームクラブ"]
    },
    {
        platform: "rmt.club",
        site: "JP",
        from: ["rmt.club", "rmt-club"],
        subject: ["rmt.club", "rmt-club"]
    }
];
let collectorState = loadState();
function loadAccounts() {
    if (env.MAIL_ACCOUNTS_JSON) {
        const raw = JSON.parse(env.MAIL_ACCOUNTS_JSON);
        return z.array(mailAccountSchema).parse(raw);
    }
    if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS) {
        throw new Error("请配置 IMAP_HOST / IMAP_USER / IMAP_PASS，或使用 MAIL_ACCOUNTS_JSON 配置多邮箱。");
    }
    return [
        mailAccountSchema.parse({
            name: env.IMAP_USER,
            collectorToken: env.COLLECTOR_TOKEN,
            host: env.IMAP_HOST,
            port: env.IMAP_PORT,
            secure: env.IMAP_SECURE,
            user: env.IMAP_USER,
            pass: env.IMAP_PASS,
            mailbox: env.IMAP_MAILBOX,
            defaultShop: env.DEFAULT_SHOP,
            defaultPlatform: env.DEFAULT_PLATFORM,
            defaultSite: env.DEFAULT_SITE
        })
    ];
}
function loadState() {
    try {
        if (!fs.existsSync(stateFilePath))
            return { accounts: {} };
        const parsed = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
        return normalizeState(parsed);
    }
    catch (error) {
        console.warn(`State file is not readable, starting with an empty state: ${String(error)}`);
        return { accounts: {} };
    }
}
function normalizeState(state) {
    const accounts = {};
    for (const [key, value] of Object.entries(state.accounts ?? {})) {
        const rawLastUid = value.lastUid;
        const lastUid = typeof rawLastUid === "number" ? rawLastUid : Number.NaN;
        const hasValidLastUid = Number.isFinite(lastUid) && lastUid >= 0;
        accounts[key] = {
            initialized: Boolean(value.initialized) && hasValidLastUid,
            lastUid: hasValidLastUid ? Math.floor(lastUid) : 0,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
            lastStatus: value.lastStatus
        };
    }
    return { accounts };
}
function saveState() {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    const tmpPath = `${stateFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(collectorState, null, 2), "utf8");
    fs.renameSync(tmpPath, stateFilePath);
}
function accountKey(account) {
    return `${account.user}|${account.mailbox}`;
}
function getAccountState(account) {
    const key = accountKey(account);
    collectorState.accounts[key] ??= {
        initialized: false,
        lastUid: 0,
        updatedAt: new Date().toISOString()
    };
    return collectorState.accounts[key];
}
function updateAccountState(account, patch) {
    const state = getAccountState(account);
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
    saveState();
}
function detectPlatform(fromText, subjectText, account) {
    const from = fromText.toLowerCase();
    const subject = subjectText.toLowerCase();
    if (from.includes("etsy") || subject.includes("etsy"))
        return null;
    const matched = platformRules.find((rule) => {
        const fromMatched = rule.from.some((item) => from.includes(item.toLowerCase()));
        const subjectMatched = rule.subject.some((item) => subject.includes(item.toLowerCase()));
        return fromMatched || (rule.allowSubjectOnly === true && subjectMatched);
    });
    if (matched)
        return matched;
    if (env.INGEST_UNKNOWN && account.defaultPlatform) {
        return { platform: account.defaultPlatform, site: account.defaultSite ?? "", from: [], subject: [] };
    }
    return null;
}
function extractFirstLink(html, text) {
    const source = typeof html === "string" ? html : text ?? "";
    const match = source.match(/https?:\/\/[^\s"'<>]+/i);
    return match?.[0];
}
function compact(value) {
    return value.replace(/\s+/g, " ").trim();
}
function describeError(error) {
    const record = typeof error === "object" && error !== null ? error : {};
    const responseText = typeof record.responseText === "string" ? record.responseText : "";
    const message = error instanceof Error ? error.message : String(error);
    const text = responseText || message;
    if (/fetch volume limit exceed/i.test(text)) {
        return "网易 IMAP 流量超限，当前无法读取邮件，等待邮箱恢复后会继续采集。";
    }
    return text;
}
function isFetchVolumeLimit(error) {
    return /fetch volume limit exceed/i.test(describeError(error));
}
function formatAddresses(addresses) {
    return (addresses
        ?.map((address) => [address.name, address.address].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(", ") ?? "");
}
function shouldFetchBody(rule) {
    if (!env.FETCH_BODY_ENABLED)
        return false;
    if (!rule)
        return true;
    return !bodyFetchDisabledPlatforms.has(rule.platform.toLowerCase());
}
async function post(pathname, body) {
    const response = await fetch(`${env.HUB_API_URL}${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${pathname} failed: ${response.status} ${text}`);
    }
}
async function heartbeat(account, message, status = "在线") {
    await post("/api/collectors/heartbeat", {
        token: account.collectorToken ?? env.COLLECTOR_TOKEN,
        name: `邮箱采集器-${account.name}`,
        deviceName: "中台电脑",
        deviceType: "IMAP 多邮箱采集器",
        status,
        message
    });
}
async function initializeMailboxState(account, highestUid) {
    const state = getAccountState(account);
    if (state.initialized)
        return;
    const lastUid = env.INITIAL_SYNC_MODE === "latest" ? Math.max(0, highestUid - env.INITIAL_LOOKBACK) : Math.max(0, highestUid);
    updateAccountState(account, {
        initialized: true,
        lastUid,
        lastStatus: env.INITIAL_SYNC_MODE === "latest"
            ? `已建立基线，将补看最近 ${env.INITIAL_LOOKBACK} 封邮件。`
            : "已建立基线，从新邮件开始采集。"
    });
    await heartbeat(account, env.INITIAL_SYNC_MODE === "latest"
        ? `邮箱 ${account.name} 已进入省流量模式，将补看最近 ${env.INITIAL_LOOKBACK} 封邮件。`
        : `邮箱 ${account.name} 已进入省流量模式，只采集之后的新邮件。`);
}
async function resolveHighestUid(client, account, mailbox) {
    const uidNext = Number(mailbox.uidNext);
    if (Number.isFinite(uidNext) && uidNext > 1)
        return Math.floor(uidNext - 1);
    try {
        const status = await client.status(account.mailbox, { uidNext: true });
        const statusUidNext = Number(status.uidNext);
        if (Number.isFinite(statusUidNext) && statusUidNext > 1)
            return Math.floor(statusUidNext - 1);
    }
    catch (error) {
        console.warn(`Unable to read UIDNEXT for ${account.name}: ${String(error)}`);
    }
    try {
        if (Number(mailbox.exists) <= 0)
            return 0;
        const latest = await client.fetchOne("*", { uid: true });
        const latestUid = latest ? Number(latest.uid) : 0;
        if (Number.isFinite(latestUid) && latestUid > 0)
            return Math.floor(latestUid);
    }
    catch (error) {
        console.warn(`Unable to fetch latest UID for ${account.name}: ${String(error)}`);
    }
    return 0;
}
async function ingestMessage(client, account, uid, envelopeFrom, envelopeSubject) {
    const envelopeRule = detectPlatform(envelopeFrom, envelopeSubject, account);
    if (!envelopeRule && !env.INGEST_UNKNOWN) {
        return "skipped";
    }
    let parsedData = {
        fromText: envelopeFrom,
        subject: envelopeSubject || "(无标题)",
        customerName: envelopeFrom || undefined,
        content: `${envelopeSubject || "(无标题)"}\n发件人：${envelopeFrom || "-"}\n（网易省流模式：只读取邮件标题，不拉取正文，避免 IMAP 流量超限。）`,
        rawContent: `${envelopeSubject || "(无标题)"}\n发件人：${envelopeFrom || "-"}\n（网易省流模式：只读取邮件标题，不拉取正文，避免 IMAP 流量超限。）`,
        messageId: `${account.user}:${uid}`,
        tags: ["email", account.name, "省流标题"]
    };
    try {
        if (!shouldFetchBody(envelopeRule)) {
            throw new Error("body fetch disabled for traffic saver platform");
        }
        const fullMessage = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        if (fullMessage && fullMessage.source) {
            const parsed = (await simpleParser(fullMessage.source));
            const fromText = parsed.from?.text ?? envelopeFrom;
            const subject = parsed.subject ?? envelopeSubject ?? "(无标题)";
            const text = compact(parsed.text || parsed.textAsHtml || subject);
            const content = text || subject || "(空邮件)";
            const link = extractFirstLink(parsed.html, parsed.text);
            parsedData = {
                fromText,
                subject,
                customerName: parsed.from?.value?.[0]?.name,
                content,
                rawContent: content,
                link,
                messageId: parsed.messageId ?? `${account.user}:${uid}`,
                receivedAt: parsed.date?.toISOString(),
                tags: ["email", account.name]
            };
        }
    }
    catch (error) {
        const message = describeError(error);
        if (shouldFetchBody(envelopeRule)) {
            console.warn(`Body fetch skipped for ${account.name} uid ${uid}: ${message}`);
            parsedData.content = `${parsedData.subject}\n\n（网易暂时限制正文抓取，已先记录标题提醒。）`;
            parsedData.rawContent = parsedData.content;
        }
    }
    const rule = detectPlatform(parsedData.fromText, parsedData.subject, account) ?? envelopeRule;
    if (!rule && !env.INGEST_UNKNOWN) {
        return "skipped";
    }
    const platform = rule?.platform ?? "未知邮件平台";
    const site = rule?.site ?? account.defaultSite ?? "";
    await post("/api/messages/ingest", {
        platform,
        site,
        shopName: account.defaultShop,
        accountEnvironment: `邮箱 ${account.name} / ${account.user}`,
        customerName: parsedData.customerName,
        content: parsedData.content.slice(0, 1600),
        rawContent: parsedData.rawContent,
        sourceType: "EMAIL",
        sourceUrl: parsedData.link,
        sourceExternalId: parsedData.messageId,
        receivedAt: parsedData.receivedAt,
        detectedAt: new Date().toISOString(),
        tags: parsedData.tags
    });
    return "ingested";
}
async function pollOnce(client, account) {
    const mailbox = await client.mailboxOpen(account.mailbox);
    const highestUid = await resolveHighestUid(client, account, mailbox);
    await initializeMailboxState(account, highestUid);
    const state = getAccountState(account);
    if (highestUid <= state.lastUid)
        return { ingested: 0, skipped: 0, errors: 0, remaining: 0 };
    const gap = highestUid - state.lastUid;
    if (gap > env.MAX_UID_CATCHUP_WINDOW) {
        await heartbeat(account, `邮箱 ${account.name} 恢复后有 ${gap} 封积压邮件，将按每轮 ${env.MAX_MESSAGES_PER_POLL} 封慢慢补读，不跳过。`);
    }
    const fromUid = state.lastUid + 1;
    const toUid = Math.min(highestUid, state.lastUid + env.MAX_MESSAGES_PER_POLL);
    let ingested = 0;
    let skipped = 0;
    let errors = 0;
    const lock = await client.getMailboxLock(account.mailbox);
    try {
        for (let uid = fromUid; uid <= toUid; uid += 1) {
            const msg = await client.fetchOne(String(uid), { uid: true, envelope: true }, { uid: true });
            if (!msg) {
                skipped += 1;
                updateAccountState(account, { lastUid: uid, lastStatus: `missing uid: ${uid}` });
                continue;
            }
            const subject = msg.envelope?.subject ?? "(无标题)";
            const fromText = formatAddresses(msg.envelope?.from);
            try {
                const result = await ingestMessage(client, account, msg.uid, fromText, subject);
                if (result === "ingested")
                    ingested += 1;
                if (result === "skipped")
                    skipped += 1;
                updateAccountState(account, { lastUid: msg.uid, lastStatus: `${result}: ${subject}` });
            }
            catch (error) {
                errors += 1;
                console.error(describeError(error));
                updateAccountState(account, {
                    lastUid: msg.uid,
                    lastStatus: `error: ${describeError(error)}`
                });
            }
        }
    }
    finally {
        lock.release();
    }
    const latestState = getAccountState(account);
    if (latestState.lastUid < toUid) {
        updateAccountState(account, { lastUid: toUid, lastStatus: "UID range advanced without matching messages." });
    }
    return { ingested, skipped, errors, remaining: Math.max(0, highestUid - toUid) };
}
async function runAccount(account) {
    for (;;) {
        let client = null;
        let fallbackTimer = null;
        let heartbeatTimer = null;
        let pushTimer = null;
        let polling = false;
        let queuedReason = null;
        let reconnectDelayMs = 10_000;
        try {
            client = new ImapFlow({
                host: account.host,
                port: account.port,
                secure: account.secure,
                auth: {
                    user: account.user,
                    pass: account.pass
                },
                logger: false,
                maxIdleTime: 4 * 60 * 1000
            });
            const runPoll = async (reason) => {
                if (!client)
                    return;
                if (polling) {
                    queuedReason = reason;
                    return;
                }
                polling = true;
                try {
                    let currentReason = reason;
                    while (currentReason) {
                        queuedReason = null;
                        const result = await pollOnce(client, account);
                        await heartbeat(account, `邮箱 ${account.name} IMAP 正常，${currentReason}：入库 ${result.ingested} 封，跳过 ${result.skipped} 封，异常 ${result.errors} 封，待处理 ${result.remaining} 封。`);
                        currentReason = queuedReason;
                    }
                }
                catch (error) {
                    const message = describeError(error);
                    console.error(message);
                    await heartbeat(account, `邮箱 ${account.name} 采集异常：${message}`, isFetchVolumeLimit(error) ? "限流" : "异常");
                    if (isFetchVolumeLimit(error))
                        throw error;
                }
                finally {
                    polling = false;
                }
            };
            const schedulePushPoll = (reason) => {
                if (!env.IMAP_PUSH_ENABLED)
                    return;
                if (pushTimer)
                    windowClearTimeout(pushTimer);
                pushTimer = setTimeout(() => {
                    pushTimer = null;
                    runPoll(reason).catch((error) => console.error(error));
                }, env.PUSH_DEBOUNCE_MS);
            };
            client.on("exists", (data) => {
                if (data.path !== account.mailbox)
                    return;
                schedulePushPoll("新邮件推送");
            });
            client.on("error", (error) => {
                console.error(`IMAP error for ${account.name}:`, error);
            });
            await client.connect();
            await heartbeat(account, env.IMAP_PUSH_ENABLED
                ? `邮箱 ${account.name} 已连接 IMAP，新邮件推送已开启。`
                : `邮箱 ${account.name} 已连接 IMAP。`);
            await runPoll("启动检查");
            fallbackTimer = setInterval(() => {
                runPoll("定时兜底").catch((error) => console.error(error));
            }, env.POLL_SECONDS * 1000);
            heartbeatTimer = setInterval(() => {
                heartbeat(account, `邮箱 ${account.name} 采集器心跳。`).catch((error) => console.error(error));
            }, env.HEARTBEAT_SECONDS * 1000);
            await new Promise((resolve, reject) => {
                client?.once("close", resolve);
                client?.once("error", reject);
            });
        }
        catch (error) {
            const message = describeError(error);
            console.error(message);
            if (isFetchVolumeLimit(error)) {
                reconnectDelayMs = env.LIMIT_BACKOFF_MINUTES * 60_000;
            }
            try {
                await heartbeat(account, isFetchVolumeLimit(error)
                    ? `邮箱 ${account.name} 网易 IMAP 流量超限，${env.LIMIT_BACKOFF_MINUTES} 分钟后再轻量检测，避免反复触发限制。`
                    : `邮箱 ${account.name} 连接异常，10秒后重连：${message}`, isFetchVolumeLimit(error) ? "限流" : "异常");
            }
            catch { }
        }
        finally {
            if (fallbackTimer)
                clearInterval(fallbackTimer);
            if (heartbeatTimer)
                clearInterval(heartbeatTimer);
            if (pushTimer)
                windowClearTimeout(pushTimer);
            try {
                await client?.logout();
            }
            catch {
                client?.close();
            }
        }
        await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
    }
}
function windowClearTimeout(timer) {
    clearTimeout(timer);
}
async function main() {
    const accounts = loadAccounts();
    console.log(`Email collector starting with ${accounts.length} account(s).`);
    console.log(`Safe IMAP mode: push=${env.IMAP_PUSH_ENABLED}, bodyFetch=${env.FETCH_BODY_ENABLED}, bodyFetchDisabled=${env.BODY_FETCH_DISABLED_PLATFORMS}, ${env.POLL_SECONDS}s fallback poll, ${env.MAX_MESSAGES_PER_POLL} message(s) per account per poll.`);
    await Promise.all(accounts.map((account) => runAccount(account)));
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
