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
    let message = body || res.statusText;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === "string") message = parsed.error;
      else if (parsed?.error) message = JSON.stringify(parsed.error);
    } catch {
      // body wasn't JSON — use it as-is
    }
    throw new ApiError(res.status, message);
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
  staleAfterMs: number;
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
  profitMargin: number;
  avgSalePrice: number;
  avgProfitPerItem: number;
  costOfGoods: number;
  platformFees: number;
  paymentFees: number;
  shippingNet: number;
  discounts: number;
  refunds: number;
  expenses: number;
}

export interface DashboardSummary {
  today: RangeSummary;
  week: RangeSummary;
  month: RangeSummary;
  allTime: RangeSummary;
  custom: RangeSummary | null;
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

export interface NotificationSettingRow {
  eventType: string;
  discordEnabled: boolean;
}

export interface NotificationSettingsResponse {
  discordConfigured: boolean;
  settings: NotificationSettingRow[];
}

export interface NotificationLogEntry {
  id: string;
  channel: string;
  status: "PENDING" | "SENT" | "FAILED";
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  event: ActivityEvent;
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

export interface SaleOrderRef {
  id: string;
  externalOrderId: string;
  buyerName: string;
  status: string;
  listing: { id: string; title: string; inventoryItemId: string | null };
  platformAccount: PlatformAccount;
}

export interface Sale {
  id: string;
  orderId: string;
  salePrice: number;
  purchaseCost: number;
  platformFees: number;
  paymentFees: number;
  shippingCost: number;
  shippingRevenue: number;
  discount: number;
  refundAmount: number;
  otherCosts: number;
  netProfit: number;
  profitMargin: number;
  currency: string;
  soldAt: string;
  order: SaleOrderRef;
}

export interface SaleFilters {
  platformId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface SaleEditableFields {
  purchaseCost?: number;
  shippingCost?: number;
  shippingRevenue?: number;
  discount?: number;
  refundAmount?: number;
  otherCosts?: number;
}

export const EXPENSE_CATEGORIES = [
  "Inventory",
  "Shipping",
  "Packaging",
  "Platform Fees",
  "Equipment",
  "Gas",
  "Advertising",
  "Supplies",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  amount: number;
  date: string;
  category: string;
  description: string | null;
  platformId: string | null;
  platformAccountId: string | null;
  inventoryItemId: string | null;
  receiptPath: string | null;
  createdAt: string;
  platform: Platform | null;
  platformAccount: PlatformAccount | null;
  inventoryItem: { id: string; title: string } | null;
}

export interface ExpenseFilters {
  category?: string;
  platformId?: string;
  accountId?: string;
  inventoryItemId?: string;
  from?: string;
  to?: string;
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
    openLoginWindow: (id: string) => request<{ ok: boolean }>(`/api/accounts/${id}/login-window`, { method: "POST" }),
    loginStatus: (id: string) =>
      request<{ requiresLogin: boolean; everAttempted: boolean; authenticated: boolean; message?: string }>(
        `/api/accounts/${id}/login-status`,
      ),
  },

  watchdogs: {
    list: () => request<(Watchdog & { platformAccount: PlatformAccount })[]>("/api/watchdogs"),
    start: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/start`, { method: "POST" }),
    stop: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/stop`, { method: "POST" }),
    restart: (accountId: string) => request<{ ok: boolean }>(`/api/watchdogs/${accountId}/restart`, { method: "POST" }),
    healthCheck: (accountId: string) =>
      request<{ ok: boolean; error?: string }>(`/api/watchdogs/${accountId}/health-check`, { method: "POST" }),
    updateConfig: (accountId: string, data: { intervalMs?: number; staleAfterMs?: number }) =>
      request<Watchdog>(`/api/watchdogs/${accountId}`, { method: "PATCH", body: JSON.stringify(data) }),
  },

  dashboard: {
    summary: (range?: { from: string; to: string }) => {
      const qs = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : "";
      return request<DashboardSummary>(`/api/dashboard/summary${qs}`);
    },
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

  sales: {
    list: (filters: SaleFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.q) params.set("q", filters.q);
      const qs = params.toString();
      return request<Sale[]>(`/api/sales${qs ? `?${qs}` : ""}`);
    },
    update: (id: string, data: SaleEditableFields) =>
      request<Sale>(`/api/sales/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },

  expenses: {
    list: (filters: ExpenseFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.category) params.set("category", filters.category);
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.inventoryItemId) params.set("inventoryItemId", filters.inventoryItemId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const qs = params.toString();
      return request<Expense[]>(`/api/expenses${qs ? `?${qs}` : ""}`);
    },
    create: (data: {
      amount: number;
      date: string;
      category: string;
      description?: string;
      platformId?: string;
      platformAccountId?: string;
      inventoryItemId?: string;
    }) => request<Expense>("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/api/expenses/${id}`, { method: "DELETE" }),
  },

  notifications: {
    log: (limit = 50) => request<NotificationLogEntry[]>(`/api/notifications?limit=${limit}`),
    settings: () => request<NotificationSettingsResponse>("/api/notification-settings"),
    updateSetting: (eventType: string, discordEnabled: boolean) =>
      request<NotificationSettingRow>(`/api/notification-settings/${eventType}`, {
        method: "PATCH",
        body: JSON.stringify({ discordEnabled }),
      }),
    testDiscord: () => request<{ ok: boolean }>("/api/notifications/test-discord", { method: "POST" }),
  },
};
