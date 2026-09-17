import { EVENT_TYPES, type EventType } from "@mcc/shared";

const PREFS_KEY = "mcc:desktopNotifPrefs";
const LAST_SEEN_KEY = "mcc:lastSeenEventId";

/** Same starter set as the Discord defaults (see server
 * notificationService.ts) — kept in sync deliberately, since both are
 * answering the same "what's worth interrupting me for" question. */
const DEFAULT_ENABLED: ReadonlySet<EventType> = new Set([
  "MESSAGE_RECEIVED",
  "OFFER_RECEIVED",
  "LISTING_SOLD",
  "WATCHDOG_ERROR",
  "ACCOUNT_DISCONNECTED",
  "AUTHENTICATION_REQUIRED",
]);

export interface DesktopPrefs {
  enabled: boolean;
  types: Record<string, boolean>;
}

function defaultPrefs(): DesktopPrefs {
  const types: Record<string, boolean> = {};
  for (const t of EVENT_TYPES) types[t] = DEFAULT_ENABLED.has(t);
  return { enabled: false, types };
}

export function loadPrefs(): DesktopPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    return { ...defaultPrefs(), ...parsed, types: { ...defaultPrefs().types, ...parsed.types } };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs: DesktopPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private mode etc) — preference just won't persist
  }
}

export function getLastSeenId(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenId(id: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, id);
  } catch {
    // ignore
  }
}

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission {
  return notificationSupported() ? Notification.permission : "denied";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationSupported()) return "denied";
  return Notification.requestPermission();
}

export function fireDesktopNotification(title: string, body: string): void {
  if (!notificationSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // some platforms (e.g. no OS notification service) throw even when "granted"
  }
}
