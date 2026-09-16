const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-api-key": API_KEY,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Platform {
  id: string;
  key: string;
  name: string;
  kind: string;
  _count: { accounts: number };
}

export interface Watchdog {
  id: string;
  platformAccountId: string;
  state: "RUNNING" | "STOPPED" | "ERROR" | "AUTH_REQUIRED" | "STALE";
  lastSuccessAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  intervalMs: number;
}

export interface PlatformAccount {
  id: string;
  platformId: string;
  externalAccountId: string;
  label: string;
  status: "CONNECTED" | "DISCONNECTED" | "AUTH_REQUIRED";
  platform: Platform;
  watchdog: Watchdog | null;
}

export interface RangeSummary {
  revenue: number;
  profit: number;
  itemsSold: number;
}

export interface DashboardSummary {
  today: RangeSummary;
  week: RangeSummary;
  month: RangeSummary;
  allTime: RangeSummary;
  unreadMessages: number;
  pendingOffers: number;
  activeListings: number;
  inventoryValue: number;
  watchdogHealth: {
    running: number;
    stopped: number;
    error: number;
    authRequired: number;
    stale: number;
  };
}

export interface PlatformBreakdown {
  platformAccountId: string;
  platform: string;
  account: string;
  revenue: number;
  profit: number;
  itemsSold: number;
}

export interface ActivityEvent {
  id: string;
  type: string;
  entityId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  platformAccount: PlatformAccount;
}

export interface ConversationListing {
  id: string;
  title: string;
  price?: number;
  currency?: string;
  url?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  externalMessageId: string;
  senderName: string;
  body: string;
  direction: "INBOUND" | "OUTBOUND";
  sentAt: string;
}

export interface ConversationListItem {
  id: string;
  buyerName: string;
  lastMessageAt: string;
  unread: boolean;
  archived: boolean;
  listing: ConversationListing | null;
  platformAccount: PlatformAccount;
  lastMessage: Message | null;
}

export interface ConversationDetail {
  id: string;
  buyerName: string;
  lastMessageAt: string;
  unread: boolean;
  archived: boolean;
  listing: ConversationListing | null;
  platformAccount: PlatformAccount;
  messages: Message[];
  capabilities: string[];
}

export interface InboxSummary {
  totalUnread: number;
  byPlatform: { platformId: string; platformKey: string; platformName: string; unread: number }[];
}

export interface ConversationFilters {
  platformId?: string;
  accountId?: string;
  unread?: boolean;
  q?: string;
}

export interface InventoryListingRef {
  id: string;
  title: string;
  status: string;
  price: number;
  needsDelisting: boolean;
  platformAccount: PlatformAccount;
}

export interface InventoryItem {
  id: string;
  sku: string | null;
  title: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  purchaseCost: number | null;
  purchaseDate: string | null;
  condition: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  listings: InventoryListingRef[];
}

export interface InventoryFilters {
  status?: string;
  q?: string;
}

export interface ListingInventoryRef {
  id: string;
  title: string;
  sku: string | null;
  status: string;
}

export interface ListingItem {
  id: string;
  externalListingId: string;
  title: string;
  price: number;
  currency: string;
  status: string;
  needsDelisting: boolean;
  url: string | null;
  views: number | null;
  likes: number | null;
  watchers: number | null;
  offerCount: number | null;
  messageCount: number | null;
  createdAt: string;
  updatedAt: string;
  platformAccount: PlatformAccount;
  inventoryItem: ListingInventoryRef | null;
}

export interface ListingFilters {
  platformId?: string;
  accountId?: string;
  status?: string;
  needsDelisting?: boolean;
  unlinkedOnly?: boolean;
  q?: string;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),

  platforms: {
    list: () => request<Platform[]>("/api/platforms"),
    seed: () => request<Platform[]>("/api/platforms/seed", { method: "POST" }),
  },

  accounts: {
    list: () => request<PlatformAccount[]>("/api/accounts"),
    create: (data: { platformKey: string; externalAccountId: string; label: string }) =>
      request<PlatformAccount>("/api/accounts", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/api/accounts/${id}`, { method: "DELETE" }),
    sync: (id: string) => request<{ ok: boolean; newEvents: number; error?: string }>(`/api/accounts/${id}/sync`, { method: "POST" }),
  },

  watchdogs: {
    list: () => request<(Watchdog & { platformAccount: PlatformAccount })[]>("/api/watchdogs"),
    start: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/start`, { method: "POST" }),
    stop: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/stop`, { method: "POST" }),
    restart: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/restart`, { method: "POST" }),
  },

  dashboard: {
    summary: () => request<DashboardSummary>("/api/dashboard/summary"),
    byPlatform: () => request<PlatformBreakdown[]>("/api/dashboard/by-platform"),
  },

  events: {
    list: (limit = 50) => request<ActivityEvent[]>(`/api/events?limit=${limit}`),
  },

  inbox: {
    summary: () => request<InboxSummary>("/api/inbox/summary"),
  },

  conversations: {
    list: (filters: ConversationFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.unread !== undefined) params.set("unread", String(filters.unread));
      if (filters.q) params.set("q", filters.q);
      const qs = params.toString();
      return request<ConversationListItem[]>(`/api/conversations${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
    reply: (id: string, message: string) =>
      request<Message>(`/api/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ message }) }),
    patch: (id: string, data: { unread?: boolean; archived?: boolean }) =>
      request<ConversationDetail>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },

  inventory: {
    list: (filters: InventoryFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.q) params.set("q", filters.q);
      const qs = params.toString();
      return request<InventoryItem[]>(`/api/inventory${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<InventoryItem & { expenses: unknown[] }>(`/api/inventory/${id}`),
    create: (data: Partial<InventoryItem> & { title: string }) =>
      request<InventoryItem>("/api/inventory", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<InventoryItem>) =>
      request<InventoryItem>(`/api/inventory/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/api/inventory/${id}`, { method: "DELETE" }),
  },

  listings: {
    list: (filters: ListingFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.status) params.set("status", filters.status);
      if (filters.needsDelisting !== undefined) params.set("needsDelisting", String(filters.needsDelisting));
      if (filters.unlinkedOnly !== undefined) params.set("unlinkedOnly", String(filters.unlinkedOnly));
      if (filters.q) params.set("q", filters.q);
      const qs = params.toString();
      return request<ListingItem[]>(`/api/listings${qs ? `?${qs}` : ""}`);
    },
    link: (id: string, inventoryItemId: string | null) =>
      request<ListingItem>(`/api/listings/${id}/link`, { method: "PATCH", body: JSON.stringify({ inventoryItemId }) }),
    update: (id: string, data: { status?: string; needsDelisting?: boolean }) =>
      request<ListingItem>(`/api/listings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
};
