// MCC Depop Reader — background worker. Relays what the content script
// read from your open Depop messages tab to MCC's local server, and keeps
// a small status record for the settings page. Talks only to MCC
// (127.0.0.1 / localhost) — never to Depop or anywhere else.

const DEFAULTS = { serverUrl: "http://127.0.0.1:4000", apiKey: "", accountId: "" };

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Chrome only injects content scripts into pages loaded AFTER the extension
// is (re)loaded — so reconnect Depop tabs that are already open.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.depop.com/*" });
  for (const tab of tabs) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "mcc-depop") void relay(msg);
});

async function relay(msg) {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  if (!settings.apiKey || !settings.accountId) {
    return setStatus({ ok: false, error: "Not set up — open the extension's settings", kind: msg.kind });
  }
  try {
    const res = await fetch(`${settings.serverUrl}/api/extension/depop/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": settings.apiKey },
      body: JSON.stringify({ accountId: settings.accountId, kind: msg.kind, page: msg.page, snapshot: msg.snapshot }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setStatus({ ok: false, error: body.error || `MCC answered ${res.status}`, kind: msg.kind });
    }
    await setStatus({ ok: true, kind: msg.kind });
  } catch {
    await setStatus({ ok: false, error: "Couldn't reach MCC — is it running?", kind: msg.kind });
  }
}

function setStatus(s) {
  return chrome.storage.local.set({ lastStatus: { ...s, at: new Date().toISOString() } });
}
