import { prisma } from "../src/prisma.js";

const statements = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "languageSkills" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Platform" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "country" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultAssigneeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Platform_defaultAssigneeId_fkey" FOREIGN KEY ("defaultAssigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Collector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "location" TEXT,
    "ipNote" TEXT,
    "status" TEXT NOT NULL DEFAULT '离线',
    "lastHeartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "ShopAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "site" TEXT,
    "ownerId" TEXT,
    "collectorId" TEXT,
    "status" TEXT NOT NULL DEFAULT '正常',
    "riskNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopAccount_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ShopAccount_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformId" TEXT NOT NULL,
    "shopAccountId" TEXT,
    "customerName" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "orderId" TEXT,
    "productName" TEXT,
    "content" TEXT NOT NULL,
    "rawContent" TEXT,
    "translatedContent" TEXT,
    "summary" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceExternalId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT '普通咨询',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "language" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "viewedAt" DATETIME,
    "receivedAt" DATETIME,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReplyAt" DATETIME,
    "timeoutDeadline" DATETIME,
    "tags" TEXT,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Message_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_shopAccountId_fkey" FOREIGN KEY ("shopAccountId") REFERENCES "ShopAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "MessageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "note" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MessageEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "RiskRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "firstSlaMinutes" INTEGER NOT NULL,
    "escalateMinutes" INTEGER NOT NULL,
    "channels" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "CollectorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectorId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectorLog_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ChatObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformId" TEXT,
    "shopAccountId" TEXT,
    "platformName" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "site" TEXT,
    "conversationId" TEXT NOT NULL,
    "customerName" TEXT,
    "speaker" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceExternalId" TEXT,
    "sentAt" DATETIME,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "QualityAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "observationId" TEXT,
    "platformId" TEXT,
    "shopAccountId" TEXT,
    "platformName" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerName" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Platform_name_key" ON "Platform"("name")`,
  `CREATE INDEX IF NOT EXISTS "ShopAccount_ownerId_idx" ON "ShopAccount"("ownerId")`,
  `CREATE INDEX IF NOT EXISTS "ShopAccount_collectorId_idx" ON "ShopAccount"("collectorId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ShopAccount_platformId_shopName_site_key" ON "ShopAccount"("platformId", "shopName", "site")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Collector_token_key" ON "Collector"("token")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Message_fingerprint_key" ON "Message"("fingerprint")`,
  `CREATE INDEX IF NOT EXISTS "Message_platformId_idx" ON "Message"("platformId")`,
  `CREATE INDEX IF NOT EXISTS "Message_shopAccountId_idx" ON "Message"("shopAccountId")`,
  `CREATE INDEX IF NOT EXISTS "Message_assignedToId_idx" ON "Message"("assignedToId")`,
  `CREATE INDEX IF NOT EXISTS "Message_priority_idx" ON "Message"("priority")`,
  `CREATE INDEX IF NOT EXISTS "Message_status_idx" ON "Message"("status")`,
  `CREATE INDEX IF NOT EXISTS "Message_detectedAt_idx" ON "Message"("detectedAt")`,
  `CREATE INDEX IF NOT EXISTS "MessageEvent_messageId_idx" ON "MessageEvent"("messageId")`,
  `CREATE INDEX IF NOT EXISTS "MessageEvent_actorId_idx" ON "MessageEvent"("actorId")`,
  `CREATE INDEX IF NOT EXISTS "CollectorLog_collectorId_idx" ON "CollectorLog"("collectorId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ChatObservation_sourceExternalId_key" ON "ChatObservation"("sourceExternalId")`,
  `CREATE INDEX IF NOT EXISTS "ChatObservation_platformName_idx" ON "ChatObservation"("platformName")`,
  `CREATE INDEX IF NOT EXISTS "ChatObservation_shopName_idx" ON "ChatObservation"("shopName")`,
  `CREATE INDEX IF NOT EXISTS "ChatObservation_conversationId_idx" ON "ChatObservation"("conversationId")`,
  `CREATE INDEX IF NOT EXISTS "ChatObservation_speaker_idx" ON "ChatObservation"("speaker")`,
  `CREATE INDEX IF NOT EXISTS "ChatObservation_detectedAt_idx" ON "ChatObservation"("detectedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "QualityAlert_fingerprint_key" ON "QualityAlert"("fingerprint")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_platformName_idx" ON "QualityAlert"("platformName")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_shopName_idx" ON "QualityAlert"("shopName")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_conversationId_idx" ON "QualityAlert"("conversationId")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_alertType_idx" ON "QualityAlert"("alertType")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_severity_idx" ON "QualityAlert"("severity")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_status_idx" ON "QualityAlert"("status")`,
  `CREATE INDEX IF NOT EXISTS "QualityAlert_createdAt_idx" ON "QualityAlert"("createdAt")`
];

async function main() {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("SQLite schema initialized.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
