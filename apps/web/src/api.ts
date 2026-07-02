import type {
  ApiResponse,
  Bootstrap,
  ChatSpeaker,
  Dashboard,
  ImapStatus,
  Message,
  MessageStatus,
  QualityAlert,
  QualitySummary
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    ...options
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? "请求失败");
  }

  return payload.data;
}

export function fetchBootstrap() {
  return request<Bootstrap>("/api/bootstrap");
}

export function fetchDashboard() {
  return request<Dashboard>("/api/dashboard");
}

export function fetchImapStatus() {
  return request<ImapStatus>("/api/imap-status");
}

export function fetchMessages(params: Record<string, string>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<Message[]>(`/api/messages${suffix}`);
}

export function changeMessageStatus(id: string, status: MessageStatus, note?: string) {
  return request<Message>(`/api/messages/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, note })
  });
}

export function markMessageViewed(id: string) {
  return request<Message>(`/api/messages/${id}/viewed`, {
    method: "PATCH"
  });
}

export function assignMessage(id: string, assignedToId: string | null, note?: string) {
  return request<Message>(`/api/messages/${id}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assignedToId, note })
  });
}

export function ingestManualMessage(body: {
  platform: string;
  shopName: string;
  site?: string;
  customerName?: string;
  content: string;
  sourceUrl?: string;
}) {
  return request<{ duplicated: boolean; message: Message }>("/api/messages/ingest", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      sourceType: "MANUAL",
      sourceExternalId: `manual-${Date.now()}`
    })
  });
}

export function markTimeouts() {
  return request<{ count: number }>("/api/timers/mark-timeouts", {
    method: "POST"
  });
}

export function fetchQualitySummary() {
  return request<QualitySummary>("/api/chat-monitor/summary");
}

export function fetchQualityAlerts() {
  return request<QualityAlert[]>("/api/chat-monitor/alerts?status=OPEN");
}

export function observeChatMessage(body: {
  platform: string;
  shopName: string;
  site?: string;
  conversationId: string;
  customerName?: string;
  speaker: ChatSpeaker;
  content: string;
  sourceUrl?: string;
}) {
  return request<{ duplicated: boolean; alerts: QualityAlert[] }>("/api/chat-monitor/observe", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      sourceExternalId: `manual-chat-${Date.now()}`
    })
  });
}

export function checkChatSla() {
  return request<{ count: number; alerts: QualityAlert[] }>("/api/chat-monitor/check-sla", {
    method: "POST"
  });
}
