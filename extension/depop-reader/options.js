const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = "http://127.0.0.1:4000";

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
  $("autoRefresh").checked = s.autoRefresh !== false;
  $("refreshMinutes").value = s.refreshMinutes || 3;
  $("offersCheck").checked = s.offersCheck !== false;
  $("offersMinutes").value = s.offersMinutes || 15;
  if (s.accountId) {
    $("accountId").innerHTML = "";
    $("accountId").append(new Option(s.accountLabel || s.accountId, s.accountId, true, true));
  }
  renderStatus(s.lastStatus);
}

function renderStatus(st) {
  if (!st) return;
  const when = new Date(st.at).toLocaleTimeString();
  $("status").className = st.ok ? "ok" : "bad";
  $("status").textContent = st.ok
    ? `Connected — last ${st.kind === "snapshot" ? "page update" : "check-in"} sent at ${when}`
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
    const res = await fetch(`${server}/api/accounts`, { headers: { "x-api-key": $("apiKey").value.trim() } });
    if (res.status === 401) throw new Error("MCC rejected the API key");
    if (!res.ok) throw new Error(`MCC answered ${res.status}`);
    const shops = (await res.json()).filter((a) => a.platform && a.platform.key === "depop-live");
    $("accountId").innerHTML = "";
    for (const a of shops) $("accountId").append(new Option(`${a.label} (@${a.externalAccountId})`, a.id));
    $("msg").textContent = shops.length ? `Found ${shops.length} Depop shop(s).` : "No Depop shops in MCC yet — add one on the Accounts page.";
  } catch (err) {
    $("msg").className = "bad";
    $("msg").textContent = err instanceof TypeError ? "Couldn't reach MCC — is it running?" : err.message;
  }
});

$("save").addEventListener("click", async () => {
  const sel = $("accountId");
  if (!sel.value) {
    $("msg").className = "bad";
    $("msg").textContent = "Pick the Depop shop first.";
    return;
  }
  await chrome.storage.local.set({
    serverUrl: $("serverUrl").value.trim().replace(/\/$/, "") || DEFAULT_SERVER,
    apiKey: $("apiKey").value.trim(),
    accountId: sel.value,
    accountLabel: sel.options[sel.selectedIndex].text,
    autoRefresh: $("autoRefresh").checked,
    refreshMinutes: Math.min(30, Math.max(2, Number($("refreshMinutes").value) || 3)),
    offersCheck: $("offersCheck").checked,
    offersMinutes: Math.min(120, Math.max(5, Number($("offersMinutes").value) || 15)),
  });
  $("msg").className = "ok";
  $("msg").textContent = "Saved. Open depop.com/messages in a tab and leave it open.";
});

void init();
