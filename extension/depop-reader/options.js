const $ = (id) => document.getElementById(id);
const LOCAL = self.MCC_CONFIG || {}; // config.local.js, when present
const DEFAULT_SERVER = LOCAL.serverUrl || "http://127.0.0.1:4000";
const AUTO = ""; // shop choice: follow the Depop account signed in on the page

async function init() {
  const s = await chrome.storage.local.get([
    "serverUrl",
    "apiKey",
    "accountId",
    "accountLabel",
    "lastStatus",
    "autoRefresh",
    "refreshMinutes",
    "offersCheck",
    "offersMinutes",
  ]);
  $("serverUrl").value = s.serverUrl || DEFAULT_SERVER;
  $("apiKey").value = s.apiKey || "";
  $("apiKey").placeholder = LOCAL.apiKey ? "set by config.local.js — leave empty" : "";
  $("autoRefresh").checked = s.autoRefresh !== false;
  $("refreshMinutes").value = s.refreshMinutes || 3;
  $("offersCheck").checked = s.offersCheck !== false;
  $("offersMinutes").value = s.offersMinutes || 15;
  $("accountId").innerHTML = "";
  $("accountId").append(new Option("Automatic — whichever Depop account is signed in", AUTO, !s.accountId, !s.accountId));
  if (s.accountId) $("accountId").append(new Option(s.accountLabel || s.accountId, s.accountId, true, true));
  renderStatus(s.lastStatus);
}

function renderStatus(st) {
  if (!st) return;
  const when = new Date(st.at).toLocaleTimeString();
  $("status").className = st.ok ? "ok" : "bad";
  $("status").textContent = st.ok
    ? `Connected${st.signedInAs ? ` as @${st.signedInAs}` : ""} — last ${st.kind === "snapshot" ? "page update" : "check-in"} sent at ${when}`
    : `${st.error} (${when})`;
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastStatus) renderStatus(changes.lastStatus.newValue);
});

$("load").addEventListener("click", async () => {
  const server = $("serverUrl").value.trim().replace(/\/$/, "") || DEFAULT_SERVER;
  $("msg").className = "";
  $("msg").textContent = "Loading…";
  try {
    const res = await fetch(`${server}/api/accounts`, { headers: { "x-api-key": $("apiKey").value.trim() || LOCAL.apiKey || "" } });
    if (res.status === 401) throw new Error("MCC rejected the API key");
    if (!res.ok) throw new Error(`MCC answered ${res.status}`);
    const shops = (await res.json()).filter((a) => a.platform && a.platform.key === "depop-live");
    $("accountId").innerHTML = "";
    $("accountId").append(new Option("Automatic — whichever Depop account is signed in", AUTO, true, true));
    for (const a of shops) $("accountId").append(new Option(`${a.label} (@${a.externalAccountId})`, a.id));
    $("msg").textContent = shops.length ? `Found ${shops.length} Depop shop(s).` : "No Depop shops in MCC yet — add one on the Accounts page.";
  } catch (err) {
    $("msg").className = "bad";
    $("msg").textContent = err instanceof TypeError ? "Couldn't reach MCC — is it running?" : err.message;
  }
});

$("save").addEventListener("click", async () => {
  const sel = $("accountId");
  await chrome.storage.local.set({
    serverUrl: $("serverUrl").value.trim().replace(/\/$/, "") || DEFAULT_SERVER,
    apiKey: $("apiKey").value.trim(),
    accountId: sel.value,
    accountLabel: sel.value ? sel.options[sel.selectedIndex].text : "",
    autoRefresh: $("autoRefresh").checked,
    refreshMinutes: Math.min(30, Math.max(2, Number($("refreshMinutes").value) || 3)),
    offersCheck: $("offersCheck").checked,
    offersMinutes: Math.min(120, Math.max(5, Number($("offersMinutes").value) || 15)),
  });
  $("msg").className = "ok";
  $("msg").textContent = "Saved. Open depop.com/messages in a tab and leave it open.";
});

void init();
