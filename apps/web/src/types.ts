export type Role = "OWNER" | "SUPERVISOR" | "AGENT" | "OPS" | "TECH";
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MessageStatus =
  | "NEW"
  | "UNASSIGNED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "REPLIED"
  | "WAITING_CUSTOMER"
  | "DONE"
  | "CLOSED"
  | "IGNORED"
  | "TIMEOUT"
  | "ESCALATED"
  | "MANUAL_REVIEW";

export type SourceType =
  | "EMAIL"
  | "WEB"
  | "DESKTOP_NOTIFICATION"
  | "MOBILE_NOTIFICATION"
  | "MANUAL"
  | "API";

export type ChatSpeaker = "CUSTOMER" | "AGENT" | "SYSTEM";
export type QualityAlertType = "VIOLATION" | "SLOW_REPLY" | "PERFUNCTORY" | "MISSED_MESSAGE" | "RISK_WORD";
export type QualityAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "IGNORED";

export type User = {
  id: string;
  name: string;
  role: Role;
  languageSkills?: string | null;
  status: string;
};

export type Platform = {
  id: string;
  name: string;
  type: string;
  country?: string | null;
  enabled: boolean;
};

export type Collector = {
  id: string;
  token: string;
  name: string;
  deviceName: string;
  deviceType: string;
  location?: string | null;
  ipNote?: string | null;
  status: string;
  lastHeartbeatAt?: string | null;
  shops?: ShopAccount[];
};

export type ShopAccount = {
  id: string;
  platformId: string;
  platform?: Platform;
  shopName: string;
  site?: string | null;
  ownerId?: string | null;
  owner?: User | null;
  collectorId?: string | null;
  collector?: Collector | null;
  status: string;
  riskNote?: string | null;
};

export type MessageEvent = {
  id: string;
  eventType: string;
  note?: string | null;
  fromStatus?: MessageStatus | null;
  toStatus?: MessageStatus | null;
  createdAt: string;
  actor?: User | null;
};

export type Message = {
  id: string;
  platformId: string;
  platform: Platform;
  shopAccount?: ShopAccount | null;
  customerName?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  orderId?: string | null;
  productName?: string | null;
  content: string;
  rawContent?: string | null;
  translatedContent?: string | null;
  summary?: string | null;
  sourceType: SourceType;
  sourceUrl?: string | null;
  messageType: string;
  priority: Priority;
  riskLevel: RiskLevel;
  language?: string | null;
  status: MessageStatus;
  assignedTo?: User | null;
  assignedToId?: string | null;
  viewedAt?: string | null;
  receivedAt?: string | null;
  detectedAt: string;
  lastReplyAt?: string | null;
  timeoutDeadline?: string | null;
  tags: string[];
  duplicateCount: number;
  events?: MessageEvent[];
};

export type RiskRule = {
  id: string;
  name: string;
  language: string;
  keywords: string;
  priority: Priority;
  riskLevel: RiskLevel;
  messageType: string;
  enabled: boolean;
};

export type Bootstrap = {
  users: User[];
  platforms: Platform[];
  shops: ShopAccount[];
  collectors: Collector[];
  riskRules: RiskRule[];
};

export type Dashboard = {
  todayTotal: number;
  openTotal: number;
  p0Total: number;
  timeoutTotal: number;
  onlineCollectors: number;
  offlineCollectors: number;
  byPlatform: { platform: string; count: number }[];
  byPriority: { priority: Priority; count: number }[];
};

export type ImapStatusValue = "OK" | "LIMITED" | "ERROR" | "UNKNOWN";

export type ImapAccountStatus = {
  id: string;
  name: string;
  status: ImapStatusValue;
  label: string;
  message: string;
  lastCheckedAt?: string | null;
};

export type ImapStatus = {
  overall: ImapStatusValue;
  label: string;
  summary: string;
  checkedAt: string;
  accounts: ImapAccountStatus[];
};

export type QualityAlert = {
  id: string;
  fingerprint: string;
  observationId?: string | null;
  platformId?: string | null;
  shopAccountId?: string | null;
  platformName: string;
  shopName: string;
  conversationId: string;
  customerName?: string | null;
  alertType: QualityAlertType;
  severity: RiskLevel;
  title: string;
  detail: string;
  status: QualityAlertStatus;
  sourceUrl?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
};

export type QualitySummary = {
  openAlerts: number;
  criticalAlerts: number;
  observedToday: number;
  byType: { alertType: QualityAlertType; _count: number }[];
  latestAlerts: QualityAlert[];
};

export type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error?: string;
};
