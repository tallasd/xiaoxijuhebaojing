import "dotenv/config";
import { ImapFlow } from "imapflow";
import { ParsedMail, simpleParser } from "mailparser";
import { z } from "zod";

const envSchema = z.object({
  HUB_API_URL: z.string().url().default("http://localhost:4100"),
  IMAP_HOST: z.string(),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_SECURE: z.coerce.boolean().default(true),
  IMAP_USER: z.string(),
  IMAP_PASS: z.string(),
  IMAP_MAILBOX: z.string().default("INBOX"),
  POLL_SECONDS: z.coerce.number().default(30)
});

const env = envSchema.parse(process.env);

const envelopeSchema = z.object({
  schema: z.literal("xiaoxijuhe.mail-relay.v1"),
  kind: z.enum(["message_ingest", "chat_observe", "collector_heartbeat"]),
  collector: z.object({
    token: z.string(),
    deviceName: z.string(),
    deviceType: z.string(),
    location: z.string().optional()
  }),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string()
});

async function post(path: string, body: unknown) {
  const response = await fetch(`${env.HUB_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

function extractJson(parsed: ParsedMail) {
  const text = parsed.text ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(text.slice(start, end + 1));
}

async function processEnvelope(raw: unknown) {
  const envelope = envelopeSchema.parse(raw);
  const collectorHeartbeat = {
    token: envelope.collector.token,
    status: "在线",
    name: envelope.collector.token,
    deviceName: envelope.collector.deviceName,
    deviceType: envelope.collector.deviceType,
    location: envelope.collector.location,
    message: `邮件中转上报：${envelope.kind}`
  };

  await post("/api/collectors/heartbeat", collectorHeartbeat);

  if (envelope.kind === "message_ingest") {
    await post("/api/messages/ingest", {
      ...envelope.payload,
      sourceExternalId:
        typeof envelope.payload.sourceExternalId === "string"
          ? envelope.payload.sourceExternalId
          : `mail-relay-${envelope.collector.token}-${envelope.createdAt}`,
      detectedAt: envelope.payload.detectedAt ?? envelope.createdAt
    });
  }

  if (envelope.kind === "chat_observe") {
    await post("/api/chat-monitor/observe", {
      ...envelope.payload,
      sourceExternalId:
        typeof envelope.payload.sourceExternalId === "string"
          ? envelope.payload.sourceExternalId
          : `mail-relay-chat-${envelope.collector.token}-${envelope.createdAt}`
    });
  }
}

async function pollOnce(client: ImapFlow, seenUids: Set<number>) {
  await client.mailboxOpen(env.IMAP_MAILBOX);
  const lock = await client.getMailboxLock(env.IMAP_MAILBOX);
  try {
    for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
      if (seenUids.has(msg.uid)) continue;
      seenUids.add(msg.uid);
      if (!msg.source) continue;

      const parsed = (await simpleParser(msg.source)) as ParsedMail;
      if (!parsed.subject?.includes("[客服中台]")) continue;

      const json = extractJson(parsed);
      if (!json) continue;
      await processEnvelope(json);
    }
  } finally {
    lock.release();
  }
}

async function main() {
  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    auth: {
      user: env.IMAP_USER,
      pass: env.IMAP_PASS
    },
    logger: false
  });

  const seenUids = new Set<number>();
  await client.connect();
  console.log("Hub mail ingest connected.");

  for (;;) {
    try {
      await pollOnce(client, seenUids);
    } catch (error) {
      console.error(error);
    }
    await new Promise((resolve) => setTimeout(resolve, env.POLL_SECONDS * 1000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
