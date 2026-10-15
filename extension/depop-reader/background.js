// MCC Depop Reader — background worker. Relays what the content script
// read from your open Depop tabs to MCC's local server, and keeps a small
// status record for the settings page. Talks only to MCC (127.0.0.1 /
// localhost) — never to Depop or anywhere else.
//
// Zero-setup: config.local.js (gitignored, next to this file) supplies
// MCC's address and API key, and the Depop shop is identified by the
// account signed in on the page — so loading the extension into another
// Chrome profile (another Depop login) needs no settings at all.

try {
  importScripts("config.local.js");
} catch {
  // not present — the settings page values are used instead
}

const DEFAULTS = { serverUrl: "http://127.0.0.1:4000", apiKey: "", accountId: "" };

async function settings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const local = self.MCC_CONFIG || {};
  return {
    serverUrl: (stored.serverUrl || local.serverUrl || DEFAULTS.serverUrl).replace(/\/$/, ""),
    apiKey: stored.apiKey || local.apiKey || "",
    // Only used when the page doesn't reveal which Depop account is signed in.
    accountId: stored.accountId || "",
  };
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Chrome only injects content scripts into pages loaded AFTER the extension
// is (re)loaded — so reconnect Depop tabs that are already open.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.depop.com/*" });
  for (const tab of tabs) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
  }
});

// One "lead" tab per signed-in shop does the clicking (Refresh / Offers);
// other tabs of the same shop only read. The lead is the lowest tab id
// that checked in during the last 2 minutes. (Lost on a worker restart —
// then the first tab to ask becomes lead again.)
const tabsByShop = new Map(); // shop → Map(tabId → lastSeen)
const LEAD_STALE_MS = 2 * 60_000;

function noteTab(shop, tabId) {
  if (!shop || tabId === undefined) return;
  if (!tabsByShop.has(shop)) tabsByShop.set(shop, new Map());
  tabsByShop.get(shop).set(tabId, Date.now());
}

function isLead(shop, tabId) {
  const tabs = tabsByShop.get(shop);
  if (!tabs) return true;
  const live = [...tabs].filter(([, seen]) => Date.now() - seen < LEAD_STALE_MS).map(([id]) => id);
  return live.length === 0 || Math.min(...live) === tabId;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const tabs of tabsByShop.values()) tabs.delete(tabId);
  void updateKeepAwake();
});
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url) void updateKeepAwake();
});

// Keep the computer awake while a Depop messages tab is being watched, so
// monitoring continues when the PC/Mac would otherwise go to sleep. The
// screen may still turn off ("system" level). Closing every Depop messages
// tab (or turning the setting off) lets the computer sleep normally again.
// Note: closing a laptop lid or choosing Sleep yourself still sleeps it.
let keepingAwake = false;
async function updateKeepAwake() {
  const { keepAwake } = await chrome.storage.local.get("keepAwake");
  const tabs = await chrome.tabs.query({ url: "https://www.depop.com/messages*" });
  const want = keepAwake !== false && tabs.length > 0;
  if (want) chrome.power.requestKeepAwake("system");
  else chrome.power.releaseKeepAwake();
  if (want !== keepingAwake) {
    keepingAwake = want;
    await chrome.storage.local.set({ keepingAwake: want });
  }
  return want;
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.keepAwake) void updateKeepAwake();
});
chrome.runtime.onStartup.addListener(() => void updateKeepAwake());

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  const shop = msg.page?.signedInAs || msg.signedInAs || "unknown";
  noteTab(shop, sender.tab?.id);
  if (msg.type === "mcc-depop-lead?") {
    reply({ lead: isLead(shop, sender.tab?.id) });
    return;
  }
  if (msg.type === "mcc-depop") void relay(msg);
});

async function relay(msg) {
  const s = await settings();
  const signedInAs = msg.page?.signedInAs;
  // Every check-in re-asserts keep-awake (the worker may have restarted).
  msg.page = { ...msg.page, keepingAwake: await updateKeepAwake() };
  if (!s.apiKey || (!signedInAs && !s.accountId)) {
    return setStatus({
      ok: false,
      error: s.apiKey ? "Couldn't tell which Depop account is signed in — pick the shop in settings" : "Not set up — open the extension's settings",
      kind: msg.kind,
    });
  }
  try {
    const res = await fetch(`${s.serverUrl}/api/extension/depop/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": s.apiKey },
      body: JSON.stringify({ accountId: s.accountId || undefined, kind: msg.kind, page: msg.page, snapshot: msg.snapshot }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setStatus({ ok: false, error: body.error || `MCC answered ${res.status}`, kind: msg.kind, signedInAs });
    }
    await setStatus({ ok: true, kind: msg.kind, signedInAs });
  } catch {
    await setStatus({ ok: false, error: "Couldn't reach MCC — is it running?", kind: msg.kind, signedInAs });
  }
}

function setStatus(s) {
  return chrome.storage.local.set({ lastStatus: { ...s, at: new Date().toISOString() } });
}
