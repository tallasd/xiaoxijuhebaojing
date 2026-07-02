const DEFAULT_CONFIG = {
  hubApiUrl: "http://127.0.0.1:4100",
  collectorToken: "collector-shopee-tw-01",
  platform: "Shopee TW",
  shopName: "Shopee 台湾店1",
  site: "TW",
  deviceName: "云端浏览器-Shopee台湾店1",
  location: "本地云端浏览器",
  unreadSelectors: ".unread, .badge, [class*=unread], [class*=badge]",
  messageSelectors: "[class*=message], [class*=conversation], [class*=chat]",
  patrolIntervalSeconds: 30
};

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

async function post(path, body) {
  const config = await getConfig();
  await fetch(`${config.hubApiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(DEFAULT_CONFIG);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "message-hub-get-config") {
    getConfig()
      .then((config) => sendResponse({ config }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "message-hub-detected") {
    getConfig()
      .then((config) =>
        post("/api/messages/ingest", {
          platform: config.platform,
          site: config.site,
          shopName: config.shopName,
          accountEnvironment: `${config.deviceName || "浏览器插件"} / 浏览器标签 ${sender.tab?.title ?? ""}`,
          customerName: message.customerName,
          content: message.content,
          rawContent: JSON.stringify(message.raw),
          sourceType: "WEB",
          sourceUrl: sender.tab?.url,
          sourceExternalId: message.fingerprint,
          detectedAt: new Date().toISOString(),
          tags: ["web"]
        })
      )
      .catch(console.error);
  }

  if (message.type === "message-hub-chat-observed") {
    getConfig()
      .then((config) =>
        post("/api/chat-monitor/observe", {
          platform: config.platform,
          site: config.site,
          shopName: config.shopName,
          conversationId: message.conversationId || sender.tab?.url || "unknown-conversation",
          customerName: message.customerName,
          speaker: message.speaker,
          content: message.content,
          sourceUrl: sender.tab?.url,
          sourceExternalId: message.fingerprint,
          sentAt: message.sentAt
        })
      )
      .catch(console.error);
  }

  return false;
});

async function sendHeartbeat() {
  getConfig()
    .then((config) =>
      post("/api/collectors/heartbeat", {
        token: config.collectorToken,
        name: `网页插件-${config.shopName}`,
        deviceName: config.deviceName || config.shopName,
        deviceType: "浏览器插件",
        location: config.location,
        status: "在线",
        message: `${config.platform} / ${config.shopName} 网页插件心跳。`
      })
    )
    .catch(console.error);
}

sendHeartbeat();
setInterval(sendHeartbeat, 60_000);
