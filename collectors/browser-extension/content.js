let lastFingerprint = "";
let lastSentAt = 0;
const seenChatFingerprints = new Set();
let patrolTimer = 0;

function visibleText(element) {
  return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
}

function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index);
    result |= 0;
  }
  return String(result);
}

function findUnreadSignals() {
  const selectors = [
    ".unread",
    ".badge",
    "[class*=unread]",
    "[class*=badge]",
    "[aria-label*=unread]",
    "[title*=unread]",
    "[aria-label*=未读]",
    "[title*=未读]"
  ];

  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .map((element) => visibleText(element))
    .filter(Boolean)
    .slice(0, 8);
}

function findLatestMessageText() {
  const selectors = [
    "[class*=message]",
    "[class*=conversation]",
    "[class*=chat]",
    "[class*=notification]",
    "main",
    "body"
  ];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector)).slice(-8);
    const text = nodes.map((node) => visibleText(node)).filter((item) => item.length > 8).pop();
    if (text) return text.slice(0, 800);
  }

  return document.title;
}

function detect() {
  const unreadSignals = findUnreadSignals();
  const titleSignal = /\(\d+\)|未读|unread|message|消息/i.test(document.title) ? document.title : "";
  if (unreadSignals.length === 0 && !titleSignal) return;

  const content = findLatestMessageText();
  const fingerprint = hash(`${location.href}|${document.title}|${unreadSignals.join("|")}|${content.slice(0, 120)}`);
  const now = Date.now();
  if (fingerprint === lastFingerprint && now - lastSentAt < 10_000) return;

  lastFingerprint = fingerprint;
  lastSentAt = now;

  chrome.runtime.sendMessage({
    type: "message-hub-detected",
    fingerprint,
    content,
    raw: {
      title: document.title,
      url: location.href,
      unreadSignals
    }
  });
}

function inferSpeaker(element) {
  const value = [
    element.className,
    element.getAttribute("data-role"),
    element.getAttribute("data-sender"),
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/agent|seller|service|outgoing|sent|right|me|self|客服|卖家|我/.test(value)) return "AGENT";
  if (/buyer|customer|incoming|received|left|client|客户|买家/.test(value)) return "CUSTOMER";
  return "CUSTOMER";
}

function scanChatTurns() {
  const selectors = [
    "[data-message-id]",
    "[data-msg-id]",
    "[class*=message]",
    "[class*=bubble]",
    "[class*=chat-item]",
    "[class*=conversation-item]"
  ];

  const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).slice(-30);
  for (const node of nodes) {
    const content = visibleText(node);
    if (!content || content.length < 2 || content.length > 1200) continue;
    if (/^\d+$/.test(content)) continue;

    const messageId = node.getAttribute("data-message-id") || node.getAttribute("data-msg-id") || "";
    const speaker = inferSpeaker(node);
    const fingerprint = hash(`${location.href}|${messageId}|${speaker}|${content.slice(0, 180)}`);
    if (seenChatFingerprints.has(fingerprint)) continue;
    seenChatFingerprints.add(fingerprint);

    chrome.runtime.sendMessage({
      type: "message-hub-chat-observed",
      fingerprint,
      speaker,
      content,
      conversationId: location.pathname || location.href,
      sentAt: new Date().toISOString()
    });
  }
}

const observer = new MutationObserver(() => {
  window.clearTimeout(window.__messageHubTimer);
  window.__messageHubTimer = window.setTimeout(runPatrol, 600);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true
});

function getRuntimeConfig() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "message-hub-get-config" }, (response) => {
        resolve(response?.config ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function runPatrol() {
  detect();
  scanChatTurns();
}

async function schedulePatrol() {
  const config = await getRuntimeConfig();
  const seconds = Number(config.patrolIntervalSeconds ?? 30);
  const intervalMs = Math.max(5, seconds) * 1000;
  window.clearInterval(patrolTimer);
  runPatrol();
  patrolTimer = window.setInterval(runPatrol, intervalMs);
}

window.addEventListener("focus", runPatrol);
schedulePatrol();
