import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Filter,
  Gauge,
  Inbox,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  PlugZap,
  Radar,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  UserRoundCheck,
  UsersRound,
  Wifi,
  WifiOff,
  XCircle
} from "lucide-react";
import {
  assignMessage,
  changeMessageStatus,
  checkChatSla,
  fetchBootstrap,
  fetchDashboard,
  fetchImapStatus,
  fetchMessages,
  fetchQualityAlerts,
  fetchQualitySummary,
  ingestManualMessage,
  markMessageViewed,
  markTimeouts,
  observeChatMessage
} from "./api";
import type {
  Bootstrap,
  Dashboard,
  ImapStatus,
  Message,
  MessageStatus,
  QualityAlert,
  QualitySummary,
  RiskLevel
} from "./types";

const statusLabel: Record<MessageStatus, string> = {
  NEW: "新消息",
  UNASSIGNED: "未分配",
  ASSIGNED: "已分配",
  IN_PROGRESS: "处理中",
  REPLIED: "已回复",
  WAITING_CUSTOMER: "等客户",
  DONE: "已完成",
  CLOSED: "已关闭",
  IGNORED: "已忽略",
  TIMEOUT: "已超时",
  ESCALATED: "需老板处理",
  MANUAL_REVIEW: "需人工介入"
};

const riskLabel: Record<RiskLevel, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  CRITICAL: "严重"
};

const alertTypeLabel = {
  VIOLATION: "违规回复",
  SLOW_REPLY: "回复慢",
  PERFUNCTORY: "回复敷衍",
  MISSED_MESSAGE: "未及时回复",
  RISK_WORD: "风险词"
};

const quickStatuses: { status: MessageStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { status: "IN_PROGRESS", label: "接单", icon: ClipboardCheck },
  { status: "REPLIED", label: "已回复", icon: Send },
  { status: "ESCALATED", label: "升级", icon: ShieldAlert },
  { status: "DONE", label: "完成", icon: CheckCircle2 },
  { status: "IGNORED", label: "忽略", icon: XCircle }
];

type ViewKey = "inbox" | "monitor" | "quality" | "config";
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
type PlatformAlert = { platformName: string; count: number };

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function minutesAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function badgeClass(base: string, value: string) {
  return `${base} ${base}-${value.toLowerCase()}`;
}

function normalizePreviewText(value: string) {
  return value
    .replace(/\[[^\]]*https?:\/\/[^\]]+\]/gi, " ")
    .replace(/<https?:\/\/[^>\s]+>/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/_{5,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripForwardedMailHeader(value: string) {
  const subjectMarkers = ["主题:", "Subject:"];
  let text = value;
  subjectMarkers.forEach((marker) => {
    const index = text.lastIndexOf(marker);
    if (index >= 0) text = text.slice(index + marker.length).trim();
  });
  return text;
}

function firstPreviewMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return normalizePreviewText(match[0]);
  }
  return "";
}

function cleanMailPreview(content: string, platformName: string) {
  const key = platformKey(platformName);
  let text = normalizePreviewText(stripForwardedMailHeader(content));

  if (key.includes("gametrade")) {
    text = text
      .replace(/^【ゲームトレード】運営からのお知らせ\s*/i, "")
      .replace(/^運営事務局からのお知らせ\s*/i, "")
      .replace(/^[^。]{1,80}様\s*/, "")
      .replace(/ゲームトレード事務局でございます。?/g, "")
      .replace(/いつもご利用いただき、誠にありがとうございます。?/g, "")
      .trim();

    const matched = firstPreviewMatch(text, [
      /取引中の.+?メッセージが届きましたことをお知らせいたします。/,
      /出品中の.+?(?:コメント|質問)が届いております。/,
      /[^。]{1,180}さんから(?:メッセージ|コメント|質問)が届(?:いております|きましたことをお知らせいたします)。/,
      /[^。]{1,180}を購入しました。/,
      /[^。]{1,180}代金の振込を確認しました。/
    ]);
    if (matched) return matched;

    text = text.split(/こちらから確認する|ご不明点|お問い合わせ|※なお|このメール/)[0].trim();
  }

  if (key.includes("game club") || key.includes("gameclub")) {
    text = text
      .replace(/^ゲームクラブ\s*/i, "")
      .replace(/^【ゲームクラブ】\s*/i, "")
      .trim();

    const matched = firstPreviewMatch(text, [
      /[^。]{1,160}様から(?:取引チャット内に)?(?:メッセージ|質問)が届いておりますので、お知らせいたします。/,
      /[^。]{1,180}(?:メッセージ|質問)が届いています。/,
      /[^。]{1,160}決済方法を選択中です。/,
      /[^。]{1,180}支払いが完了されましたら.+?お待ちください。/
    ]);
    if (matched) return matched.replace(/^【ゲームクラブ】\s*/i, "");

    text = text
      .split(/■取引情報|■商品情報|【取引チャットはこちらから】|【質問の回答はこちらから】|このメールはゲームクラブ/)[0]
      .trim();
  }

  return text.split(/ご不明点|お問い合わせ|※なお|このメール/)[0].trim() || "暂无内容";
}

function messagePreview(message: Message) {
  return cleanMailPreview(message.content, message.platform.name);
}

function platformKey(platformName: string) {
  return platformName.toLowerCase().replace(/\s+/g, " ").trim();
}

function platformAlertText(platformName: string) {
  const key = platformKey(platformName);
  if (key.includes("gametrade")) return "GameTrade 有消息了，请处理";
  if (key.includes("game club") || key.includes("gameclub")) return "Game Club 有消息了，请处理";
  if (key.includes("ebay")) return "eBay 有消息了，请处理";
  if (key.includes("shopee tw")) return "Shopee 台湾有消息了，请处理";
  if (key.includes("shopee my")) return "Shopee 马来有消息了，请处理";
  if (key.includes("discord")) return "Discord 有消息了，请处理";
  return `${platformName} 有消息了，请处理`;
}

function platformTonePattern(platformName: string) {
  const key = platformKey(platformName);
  if (key.includes("gametrade")) return [660, 880, 1100, 880];
  if (key.includes("game club") || key.includes("gameclub")) return [520, 680, 840, 680];
  if (key.includes("ebay")) return [740, 980, 740];
  if (key.includes("shopee")) return [880, 660, 880];
  if (key.includes("discord")) return [440, 660, 880, 660];
  return [740, 980, 740];
}

function platformAudioPath(platformName: string) {
  const key = platformKey(platformName);
  if (key.includes("gametrade")) return "/alerts/gametrade.wav";
  if (key.includes("game club") || key.includes("gameclub")) return "/alerts/game-club.wav";
  if (key.includes("ebay")) return "/alerts/ebay.wav";
  if (key.includes("shopee tw")) return "/alerts/shopee-tw.wav";
  if (key.includes("shopee my")) return "/alerts/shopee-my.wav";
  if (key.includes("discord")) return "/alerts/discord.wav";
  return null;
}

function collectPlatformAlerts(messages: Message[]): PlatformAlert[] {
  const counts = new Map<string, PlatformAlert>();
  messages.forEach((message) => {
    const platformName = message.platform.name;
    const current = counts.get(platformName);
    counts.set(platformName, {
      platformName,
      count: (current?.count ?? 0) + 1
    });
  });
  return Array.from(counts.values());
}

function App() {
  const [view, setView] = useState<ViewKey>("inbox");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [imapStatus, setImapStatus] = useState<ImapStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [qualitySummary, setQualitySummary] = useState<QualitySummary | null>(null);
  const [qualityAlerts, setQualityAlerts] = useState<QualityAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const autoRefreshingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordedAlertRef = useRef<HTMLAudioElement | null>(null);
  const [filters, setFilters] = useState({
    q: "",
    platform: "",
    status: ""
  });
  const [manual, setManual] = useState({
    platform: "Shopee TW",
    shopName: "Shopee 台湾店1",
    customerName: "",
    content: ""
  });
  const [chatProbe, setChatProbe] = useState({
    platform: "Shopee TW",
    shopName: "Shopee 台湾店1",
    conversationId: "demo-shopee-tw",
    customerName: "王先生",
    speaker: "AGENT" as "CUSTOMER" | "AGENT" | "SYSTEM",
    content: "ok"
  });

  const selected = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId]
  );
  const unviewedMessages = useMemo(() => messages.filter((message) => !message.viewedAt), [messages]);
  const unviewedCount = unviewedMessages.length;
  const unviewedPlatformAlerts = useMemo(() => collectPlatformAlerts(unviewedMessages), [unviewedMessages]);
  const alertPlatformSummary = useMemo(
    () => unviewedPlatformAlerts.map((item) => `${item.platformName} ${item.count} 条`).join(" / "),
    [unviewedPlatformAlerts]
  );

  const ensureAudioReady = useCallback(async () => {
    const audioWindow = window as AudioWindow;
    const AudioContextClass: typeof AudioContext | undefined = window.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    const running = audioContextRef.current.state === "running";
    setAudioReady(running);
    return running;
  }, []);

  const playPlatformAlertTone = useCallback((platformName: string) => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    platformTonePattern(platformName).forEach((frequency, index) => {
      const startAt = now + index * 0.15;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.13);
    });
  }, []);

  const speakPlatformAlert = useCallback((platformName: string, count: number) => {
    if (!window.speechSynthesis) return;
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;

    const countText = count > 1 ? `，还有 ${count} 条未看` : "";
    const utterance = new SpeechSynthesisUtterance(`${platformAlertText(platformName)}${countText}`);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voice = window.speechSynthesis
      .getVoices()
      .find((item) => item.lang.toLowerCase().startsWith("zh") || /chinese|中文/i.test(item.name));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }, []);

  const playRecordedPlatformAlert = useCallback(async (platformName: string) => {
    const path = platformAudioPath(platformName);
    if (!path) return false;
    if (typeof Audio === "undefined") return false;

    const audio = recordedAlertRef.current ?? new Audio();
    recordedAlertRef.current = audio;
    audio.pause();
    audio.src = path;
    audio.currentTime = 0;
    audio.volume = 1;
    await audio.play();
    return true;
  }, []);

  const handleSelectMessage = useCallback(async (message: Message) => {
    setSelectedId(message.id);
    void ensureAudioReady();
    if (message.viewedAt) return;

    const viewedAt = new Date().toISOString();
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, viewedAt } : item))
    );

    try {
      const updated = await markMessageViewed(message.id);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "标记已查看失败");
    }
  }, [ensureAudioReady]);

  const focusFirstUnviewed = useCallback(() => {
    const first = unviewedMessages[0];
    if (!first) return;
    setView("inbox");
    void handleSelectMessage(first);
  }, [handleSelectMessage, unviewedMessages]);

  const loadAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const [nextBootstrap, nextDashboard, nextImapStatus, nextMessages, nextQualitySummary, nextQualityAlerts] = await Promise.all([
        fetchBootstrap(),
        fetchDashboard(),
        fetchImapStatus(),
        fetchMessages(filters),
        fetchQualitySummary(),
        fetchQualityAlerts()
      ]);
      setBootstrap(nextBootstrap);
      setDashboard(nextDashboard);
      setImapStatus(nextImapStatus);
      setMessages(nextMessages);
      setQualitySummary(nextQualitySummary);
      setQualityAlerts(nextQualityAlerts);
      setSelectedId((current) => current ?? nextMessages[0]?.id ?? null);
      setLastUpdatedAt(new Date());
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载失败");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (autoRefreshingRef.current) return;
      autoRefreshingRef.current = true;
      try {
        await loadAll({ silent: true });
      } finally {
        autoRefreshingRef.current = false;
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchMessages(filters)
        .then((nextMessages) => {
          setMessages(nextMessages);
          setLastUpdatedAt(new Date());
        })
        .catch((error) => setToast(error instanceof Error ? error.message : "筛选失败"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    const armAudio = () => {
      void ensureAudioReady();
    };
    window.addEventListener("pointerdown", armAudio, { once: true });
    window.addEventListener("keydown", armAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", armAudio);
      window.removeEventListener("keydown", armAudio);
    };
  }, [ensureAudioReady]);

  useEffect(() => {
    const baseTitle = "客服消息中台";
    if (unviewedCount === 0) {
      document.title = baseTitle;
      return;
    }

    let visible = true;
    const updateTitle = () => {
      document.title = visible ? `(${unviewedCount}) 新消息未看` : baseTitle;
      visible = !visible;
    };
    updateTitle();
    const timer = window.setInterval(updateTitle, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = baseTitle;
    };
  }, [unviewedCount]);

  useEffect(() => {
    if (unviewedPlatformAlerts.length === 0) {
      window.speechSynthesis?.cancel();
      return;
    }

    let stopped = false;
    let platformIndex = 0;
    const ring = () => {
      const alert = unviewedPlatformAlerts[platformIndex % unviewedPlatformAlerts.length];
      platformIndex += 1;
      ensureAudioReady()
        .then(async (ready) => {
          if (stopped) return;
          const playedRecordedAlert = await playRecordedPlatformAlert(alert.platformName).catch(() => false);
          if (stopped || playedRecordedAlert) return;
          if (ready) playPlatformAlertTone(alert.platformName);
          speakPlatformAlert(alert.platformName, alert.count);
        })
        .catch(() => setAudioReady(false));
    };

    ring();
    const timer = window.setInterval(ring, 3800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [ensureAudioReady, playPlatformAlertTone, playRecordedPlatformAlert, speakPlatformAlert, unviewedPlatformAlerts]);

  async function updateStatus(message: Message, status: MessageStatus) {
    const updated = await changeMessageStatus(message.id, status);
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedId(updated.id);
    setToast(`${message.platform.name} 消息已标记为${statusLabel[status]}`);
  }

  async function updateAssignee(message: Message, assignedToId: string) {
    const updated = await assignMessage(message.id, assignedToId || null);
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedId(updated.id);
    setToast("负责人已更新");
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manual.content.trim()) return;
    const result = await ingestManualMessage(manual);
    setManual((current) => ({ ...current, customerName: "", content: "" }));
    await loadAll();
    setSelectedId(result.message.id);
    setToast(result.duplicated ? "相同消息已合并" : "手动消息已进入消息池");
  }

  async function runTimeoutCheck() {
    const result = await markTimeouts();
    await loadAll();
    setToast(`已检查超时消息：${result.count} 条更新`);
  }

  async function runQualityCheck() {
    const result = await checkChatSla();
    await loadAll();
    setToast(`已检查聊天质检：新增 ${result.count} 条未回复告警`);
  }

  async function submitChatProbe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatProbe.content.trim()) return;
    const result = await observeChatMessage(chatProbe);
    await loadAll();
    setToast(result.alerts.length > 0 ? `已生成 ${result.alerts.length} 条质检告警` : "聊天观察已记录");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <MessageSquareText size={22} />
          </div>
          <div>
            <strong>客服消息中台</strong>
            <span>Message Hub</span>
          </div>
        </div>

        <nav className="nav">
          <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>
            <Inbox size={18} />
            <span>消息工作台</span>
          </button>
          <button className={view === "monitor" ? "active" : ""} onClick={() => setView("monitor")}>
            <Gauge size={18} />
            <span>实时监控</span>
          </button>
          <button className={view === "quality" ? "active" : ""} onClick={() => setView("quality")}>
            <Radar size={18} />
            <span>质检雷达</span>
          </button>
          <button className={view === "config" ? "active" : ""} onClick={() => setView("config")}>
            <Settings2 size={18} />
            <span>配置管理</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>
            <span className="muted">在线采集器</span>
            <strong>{dashboard?.onlineCollectors ?? 0}</strong>
          </div>
          <div>
            <span className="muted">离线/异常</span>
            <strong>{dashboard?.offlineCollectors ?? 0}</strong>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>
              {view === "inbox"
                ? "统一收件箱"
                : view === "monitor"
                  ? "实时监控"
                  : view === "quality"
                    ? "质检雷达"
                    : "配置管理"}
            </h1>
            <p>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "short" }).format(new Date())}</p>
          </div>
          <div className="top-actions">
            <ImapStatusBadge status={imapStatus} />
            <div className="refresh-status" title="页面每 15 秒自动刷新">
              <RefreshCw size={14} />
              <span>自动刷新</span>
              <strong>
                {lastUpdatedAt
                  ? new Intl.DateTimeFormat("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit"
                    }).format(lastUpdatedAt)
                  : "--:--:--"}
              </strong>
            </div>
            <button className="icon-button" title="刷新" onClick={() => loadAll()}>
              {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
            <button className="primary-button" onClick={runTimeoutCheck}>
              <Clock3 size={17} />
              <span>检查超时</span>
            </button>
            <button className="primary-button" onClick={runQualityCheck}>
              <Radar size={17} />
              <span>检查质检</span>
            </button>
          </div>
        </header>

        {unviewedCount > 0 && (
          <button className="urgent-alert-banner" onClick={focusFirstUnviewed}>
            <Bell size={22} />
            <strong>{unviewedCount} 条新消息未查看</strong>
            <em>{alertPlatformSummary}</em>
            <span>{audioReady ? "平台语音报警已开启" : "点击页面后开启平台语音报警"}</span>
          </button>
        )}

        {dashboard && <KpiStrip dashboard={dashboard} />}

        {view === "inbox" && (
          <section className="workspace-grid">
            <div className="inbox-pane">
              <div className="filters">
                <div className="search">
                  <Search size={16} />
                  <input
                    value={filters.q}
                    onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                    placeholder="搜索客户、订单、内容"
                  />
                </div>
                <select
                  value={filters.platform}
                  onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                  aria-label="平台"
                >
                  <option value="">全部平台</option>
                  {bootstrap?.platforms.map((platform) => (
                    <option key={platform.id} value={platform.name}>
                      {platform.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  aria-label="状态"
                >
                  <option value="">全部状态</option>
                  {Object.entries(statusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="message-list">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    className={`message-row ${selected?.id === message.id ? "selected" : ""} ${
                      !message.viewedAt ? "message-row-unseen-alert" : ""
                    }`}
                    onClick={() => handleSelectMessage(message)}
                  >
                    <div className="message-row-top">
                      <strong>{message.platform.name}</strong>
                      <span className="muted">{message.shopAccount?.shopName ?? "未绑定店铺"}</span>
                      <span className="row-time">{minutesAgo(message.detectedAt)}</span>
                    </div>
                    <div className="message-main">
                      <span className="message-customer">{message.customerName ?? "未知客户"}</span>
                      <p className="message-preview">{messagePreview(message)}</p>
                    </div>
                    <div className="message-row-bottom">
                      <span className={badgeClass("risk", message.riskLevel)}>{riskLabel[message.riskLevel]}</span>
                      <span>{message.messageType}</span>
                      <span>{statusLabel[message.status]}</span>
                      <span>{message.assignedTo?.name ?? "未分配"}</span>
                    </div>
                  </button>
                ))}

                {messages.length === 0 && (
                  <div className="empty-state">
                    <Filter size={24} />
                    <span>没有匹配的消息</span>
                  </div>
                )}
              </div>
            </div>

            <MessageDetail
              bootstrap={bootstrap}
              message={selected}
              onStatus={updateStatus}
              onAssign={updateAssignee}
              manual={manual}
              setManual={setManual}
              onManualSubmit={submitManual}
            />
          </section>
        )}

        {view === "monitor" && (
          <MonitorView
            dashboard={dashboard}
            imapStatus={imapStatus}
            collectors={bootstrap?.collectors ?? []}
            messages={messages}
          />
        )}

        {view === "quality" && (
          <QualityView
            summary={qualitySummary}
            alerts={qualityAlerts}
            chatProbe={chatProbe}
            setChatProbe={setChatProbe}
            onSubmit={submitChatProbe}
          />
        )}

        {view === "config" && bootstrap && <ConfigView bootstrap={bootstrap} />}
      </main>

      {toast && (
        <div className="toast" role="status" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

function KpiStrip({ dashboard }: { dashboard: Dashboard }) {
  return (
    <section className="kpi-strip">
      <Kpi icon={Inbox} label="今日消息" value={dashboard.todayTotal} tone="blue" />
      <Kpi icon={Bell} label="未处理" value={dashboard.openTotal} tone="amber" />
      <Kpi icon={ShieldAlert} label="高风险" value={dashboard.p0Total} tone="red" />
      <Kpi icon={Clock3} label="已超时" value={dashboard.timeoutTotal} tone="violet" />
      <Kpi icon={Wifi} label="采集器在线" value={dashboard.onlineCollectors} tone="green" />
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Inbox;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImapStatusBadge({ status }: { status: ImapStatus | null }) {
  const value = status?.overall ?? "UNKNOWN";
  const label = status?.summary ?? "网易 IMAP 状态未知";
  const checkedAt = status?.checkedAt ? formatTime(status.checkedAt) : "-";

  return (
    <div className={`imap-status-badge imap-${value.toLowerCase()}`} title={`最近检测：${checkedAt}`}>
      <Mail size={16} />
      <span>网易 IMAP</span>
      <strong>{label.replace("网易 IMAP ", "")}</strong>
    </div>
  );
}

function MessageDetail({
  bootstrap,
  message,
  onStatus,
  onAssign,
  manual,
  setManual,
  onManualSubmit
}: {
  bootstrap: Bootstrap | null;
  message: Message | null;
  onStatus: (message: Message, status: MessageStatus) => Promise<void>;
  onAssign: (message: Message, assignedToId: string) => Promise<void>;
  manual: { platform: string; shopName: string; customerName: string; content: string };
  setManual: React.Dispatch<React.SetStateAction<{ platform: string; shopName: string; customerName: string; content: string }>>;
  onManualSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <div className="detail-pane">
      {message ? (
        <>
          <div className="detail-head">
            <div>
              <h2>{message.customerName ?? "未知客户"}</h2>
              <p>
                {message.platform.name} / {message.shopAccount?.shopName ?? "未绑定店铺"}
              </p>
            </div>
            {message.sourceUrl && (
              <a className="open-link" href={message.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={17} />
                <span>原平台</span>
              </a>
            )}
          </div>

          <div className="detail-actions">
            {quickStatuses.map(({ status, label, icon: Icon }) => (
              <button key={status} onClick={() => onStatus(message, status)} title={label}>
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="field-grid">
            <Field label="状态" value={statusLabel[message.status]} />
            <Field label="风险" value={riskLabel[message.riskLevel]} />
            <Field label="类型" value={message.messageType} />
            <Field label="来源" value={message.sourceType} />
            <Field label="订单" value={message.orderId ?? "-"} />
            <Field label="发现时间" value={formatTime(message.detectedAt)} />
            <Field label="SLA 截止" value={formatTime(message.timeoutDeadline)} />
            <label className="field">
              <span>负责人</span>
              <select value={message.assignedToId ?? ""} onChange={(event) => onAssign(message, event.target.value)}>
                <option value="">未分配</option>
                {bootstrap?.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="content-block">
            <h3>消息内容</h3>
            <p>{message.content}</p>
          </section>

          <section className="content-block">
            <h3>AI 辅助</h3>
            <p>{message.summary ?? "暂无总结"}</p>
            <div className="tag-line">
              {message.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </section>

          <section className="timeline">
            <h3>处理记录</h3>
            {(message.events ?? []).map((event) => (
              <div key={event.id} className="timeline-item">
                <span>{formatTime(event.createdAt)}</span>
                <strong>{event.eventType}</strong>
                <p>{event.note ?? `${event.fromStatus ?? "-"} → ${event.toStatus ?? "-"}`}</p>
              </div>
            ))}
          </section>
        </>
      ) : (
        <div className="empty-state detail-empty">
          <Inbox size={26} />
          <span>请选择一条消息</span>
        </div>
      )}

      <form className="manual-form" onSubmit={onManualSubmit}>
        <div className="manual-title">
          <Plus size={17} />
          <strong>手动录入</strong>
        </div>
        <div className="manual-grid">
          <input
            value={manual.platform}
            onChange={(event) => setManual((current) => ({ ...current, platform: event.target.value }))}
            placeholder="平台"
          />
          <input
            value={manual.shopName}
            onChange={(event) => setManual((current) => ({ ...current, shopName: event.target.value }))}
            placeholder="店铺"
          />
          <input
            value={manual.customerName}
            onChange={(event) => setManual((current) => ({ ...current, customerName: event.target.value }))}
            placeholder="客户"
          />
        </div>
        <textarea
          value={manual.content}
          onChange={(event) => setManual((current) => ({ ...current, content: event.target.value }))}
          placeholder="消息内容"
          rows={3}
        />
        <button className="primary-button" type="submit">
          <Plus size={16} />
          <span>加入消息池</span>
        </button>
      </form>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MonitorView({
  dashboard,
  imapStatus,
  collectors,
  messages
}: {
  dashboard: Dashboard | null;
  imapStatus: ImapStatus | null;
  collectors: Bootstrap["collectors"];
  messages: Message[];
}) {
  const maxPlatform = Math.max(1, ...(dashboard?.byPlatform.map((item) => item.count) ?? [1]));

  return (
    <section className="monitor-grid">
      <div className={`panel imap-status-panel imap-panel-${(imapStatus?.overall ?? "UNKNOWN").toLowerCase()}`}>
        <div className="panel-title-row">
          <h2>网易 IMAP 流量</h2>
          <span>{imapStatus?.label ?? "未知"}</span>
        </div>
        <p className="imap-summary">
          {imapStatus?.summary ?? "等待采集器上报"} / 最近检测 {imapStatus?.checkedAt ? formatTime(imapStatus.checkedAt) : "-"}
        </p>
        <div className="imap-account-list">
          {imapStatus?.accounts.map((account) => (
            <div key={account.id} className={`imap-account-row imap-${account.status.toLowerCase()}`}>
              <Mail size={16} />
              <strong>{account.name}</strong>
              <span>{account.message}</span>
              <em>{account.label}</em>
            </div>
          ))}
          {(!imapStatus || imapStatus.accounts.length === 0) && (
            <div className="empty-state imap-empty">
              <Mail size={22} />
              <span>等待邮箱采集器上报</span>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>平台消息量</h2>
        <div className="bar-list">
          {dashboard?.byPlatform.map((item) => (
            <div key={item.platform} className="bar-row">
              <span>{item.platform}</span>
              <div>
                <i style={{ width: `${(item.count / maxPlatform) * 100}%` }} />
              </div>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>采集器状态</h2>
        <div className="collector-list">
          {collectors.map((collector) => (
            <div key={collector.id} className="collector-row">
              {collector.status === "在线" ? <Wifi size={18} /> : <WifiOff size={18} />}
              <div>
                <strong>{collector.name}</strong>
                <span>
                  {collector.deviceName} / {collector.deviceType} / {formatTime(collector.lastHeartbeatAt)}
                </span>
              </div>
              <em className={collector.status === "在线" ? "ok" : "bad"}>{collector.status}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide">
        <h2>高风险消息</h2>
        <div className="risk-table">
          {messages
            .filter((message) => message.riskLevel === "HIGH" || message.riskLevel === "CRITICAL")
            .slice(0, 8)
            .map((message) => (
              <div key={message.id} className="risk-table-row">
                <AlertTriangle size={17} />
                <strong>{message.platform.name}</strong>
                <span>{message.customerName ?? "未知客户"}</span>
                <p>{message.content}</p>
                <em>{statusLabel[message.status]}</em>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function QualityView({
  summary,
  alerts,
  chatProbe,
  setChatProbe,
  onSubmit
}: {
  summary: QualitySummary | null;
  alerts: QualityAlert[];
  chatProbe: {
    platform: string;
    shopName: string;
    conversationId: string;
    customerName: string;
    speaker: "CUSTOMER" | "AGENT" | "SYSTEM";
    content: string;
  };
  setChatProbe: React.Dispatch<
    React.SetStateAction<{
      platform: string;
      shopName: string;
      conversationId: string;
      customerName: string;
      speaker: "CUSTOMER" | "AGENT" | "SYSTEM";
      content: string;
    }>
  >;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="quality-grid">
      <div className="panel quality-hero">
        <div>
          <h2>网页插件直连 + 邮箱 IMAP + 聊天质检</h2>
          <p>
            当前先做本机方案：eBay 和 Game Club 走邮箱 IMAP，Shopee 台湾、Shopee 马来和 Discord 在对应云端浏览器安装插件，默认每 30 秒巡检一次。
          </p>
        </div>
        <div className="quality-flow">
          <span>
            <Mail size={18} />
            eBay / Game Club：邮箱 IMAP
          </span>
          <span>
            <PlugZap size={18} />
            Shopee / Discord：插件直连
          </span>
          <span>
            <Activity size={18} />
            中台质检
          </span>
        </div>
      </div>

      <div className="kpi quality-kpi">
        <Radar size={20} />
        <span>今日聊天观察</span>
        <strong>{summary?.observedToday ?? 0}</strong>
      </div>
      <div className="kpi quality-kpi">
        <ShieldAlert size={20} />
        <span>未处理质检</span>
        <strong>{summary?.openAlerts ?? 0}</strong>
      </div>
      <div className="kpi quality-kpi">
        <AlertTriangle size={20} />
        <span>严重告警</span>
        <strong>{summary?.criticalAlerts ?? 0}</strong>
      </div>

      <div className="panel">
        <h2>插件监控内容</h2>
        <div className="check-list">
          <span>新消息、红点、未读数字、网页标题变化</span>
          <span>客户发言、客服发言、会话链接、店铺环境</span>
          <span>违规词、站外联系、私下付款、敏感承诺</span>
          <span>回复太短、回复不及时、客户消息未处理</span>
          <span>同一消息和同一告警自动去重，避免重复轰炸</span>
        </div>
      </div>

      <div className="panel">
        <h2>第一阶段接入方式</h2>
        <div className="check-list">
          <span>网易邮箱大师继续给你人工看所有收件箱，中台程序用 IMAP 读每个邮箱</span>
          <span>浏览器插件默认直连本机中台：http://127.0.0.1:4100</span>
          <span>Shopee 台湾 4 个店铺、Shopee 马来 1 个店铺、Discord 2 个环境都需要安装插件</span>
          <span>邮件只负责发现 eBay / Game Club 这类会发邮件的平台消息</span>
          <span>同一消息和同一告警自动去重，避免重复提醒</span>
        </div>
      </div>

      <div className="panel wide">
        <h2>质检告警</h2>
        <div className="quality-alert-list">
          {alerts.map((alert) => (
            <div key={alert.id} className="quality-alert-row">
              <span className={badgeClass("risk", alert.severity)}>{riskLabel[alert.severity]}</span>
              <strong>{alert.title}</strong>
              <em>{alertTypeLabel[alert.alertType]}</em>
              <span>
                {alert.platformName} / {alert.shopName}
              </span>
              <p>{alert.detail}</p>
              <small>{formatTime(alert.createdAt)}</small>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="empty-state">
              <CheckCircle2 size={24} />
              <span>当前没有未处理质检告警</span>
            </div>
          )}
        </div>
      </div>

      <form className="panel chat-probe" onSubmit={onSubmit}>
        <h2>模拟插件上报</h2>
        <div className="manual-grid">
          <input
            value={chatProbe.platform}
            onChange={(event) => setChatProbe((current) => ({ ...current, platform: event.target.value }))}
            placeholder="平台"
          />
          <input
            value={chatProbe.shopName}
            onChange={(event) => setChatProbe((current) => ({ ...current, shopName: event.target.value }))}
            placeholder="店铺"
          />
          <input
            value={chatProbe.conversationId}
            onChange={(event) => setChatProbe((current) => ({ ...current, conversationId: event.target.value }))}
            placeholder="会话 ID"
          />
        </div>
        <div className="manual-grid">
          <input
            value={chatProbe.customerName}
            onChange={(event) => setChatProbe((current) => ({ ...current, customerName: event.target.value }))}
            placeholder="客户名"
          />
          <select
            value={chatProbe.speaker}
            onChange={(event) =>
              setChatProbe((current) => ({
                ...current,
                speaker: event.target.value as "CUSTOMER" | "AGENT" | "SYSTEM"
              }))
            }
          >
            <option value="AGENT">客服回复</option>
            <option value="CUSTOMER">客户消息</option>
            <option value="SYSTEM">系统消息</option>
          </select>
        </div>
        <textarea
          value={chatProbe.content}
          onChange={(event) => setChatProbe((current) => ({ ...current, content: event.target.value }))}
          placeholder="例如：ok / 加我 WhatsApp / 客户说还没收到"
          rows={4}
        />
        <button className="primary-button" type="submit">
          <Radar size={16} />
          <span>提交观察</span>
        </button>
      </form>
    </section>
  );
}

function ConfigView({ bootstrap }: { bootstrap: Bootstrap }) {
  const countShops = (platformName: string) =>
    bootstrap.shops.filter((shop) => shop.platform?.name === platformName).length;

  return (
    <section className="config-grid">
      <div className="panel wide">
        <h2>第一阶段接入路线</h2>
        <div className="route-list">
          <div className="route-row">
            <Mail size={18} />
            <strong>eBay</strong>
            <span>邮箱 IMAP 接入</span>
            <em>{countShops("eBay")} 个店铺</em>
          </div>
          <div className="route-row">
            <Mail size={18} />
            <strong>Game Club</strong>
            <span>邮箱 IMAP 接入，网页插件后续兜底</span>
            <em>{countShops("Game Club")} 个店铺</em>
          </div>
          <div className="route-row">
            <PlugZap size={18} />
            <strong>Shopee 台湾</strong>
            <span>每个云端浏览器安装插件，直连 http://127.0.0.1:4100</span>
            <em>{countShops("Shopee TW")} 个店铺</em>
          </div>
          <div className="route-row">
            <PlugZap size={18} />
            <strong>Shopee 马来</strong>
            <span>云端浏览器安装插件，直连 http://127.0.0.1:4100</span>
            <em>{countShops("Shopee MY")} 个店铺</em>
          </div>
          <div className="route-row">
            <PlugZap size={18} />
            <strong>Discord</strong>
            <span>两个聊天环境安装插件，监控漏回复、敷衍和违规</span>
            <em>{countShops("Discord")} 个环境</em>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>平台</h2>
        <div className="table-list">
          {bootstrap.platforms.map((platform) => (
            <div key={platform.id} className="table-row">
              <strong>{platform.name}</strong>
              <span>{platform.type}</span>
              <span>{platform.country ?? "-"}</span>
              <em>{platform.enabled ? "启用" : "停用"}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>店铺</h2>
        <div className="table-list">
          {bootstrap.shops.map((shop) => (
            <div key={shop.id} className="table-row">
              <strong>{shop.shopName}</strong>
              <span>{shop.platform?.name ?? "-"}</span>
              <span>{shop.owner?.name ?? "未分配"}</span>
              <em>{shop.status}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide">
        <h2>风险词</h2>
        <div className="table-list">
          {bootstrap.riskRules.map((rule) => (
            <div key={rule.id} className="rule-row">
              <strong>{rule.name}</strong>
              <span>{riskLabel[rule.riskLevel]}</span>
              <p>{rule.keywords}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>人员</h2>
        <div className="user-list">
          {bootstrap.users.map((user) => (
            <div key={user.id} className="user-row">
              <UsersRound size={17} />
              <strong>{user.name}</strong>
              <span>{user.role}</span>
              <em>{user.languageSkills ?? "-"}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>采集器</h2>
        <div className="table-list">
          {bootstrap.collectors.map((collector) => (
            <div key={collector.id} className="table-row">
              <strong>{collector.name}</strong>
              <span>{collector.deviceName}</span>
              <span>{collector.deviceType}</span>
              <em>{collector.status}</em>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default App;
