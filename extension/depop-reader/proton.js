// MCC Depop Reader — Proton Mail content script (mail.proton.me).
//
// For shops whose Depop emails go to a FREE Proton Mail inbox (no IMAP
// Bridge): reads the inbox list the user keeps open and passes the
// Depop emails to MCC. Strictly read-only:
//   - never clicks, opens, scrolls, or types — so nothing is marked read;
//   - ONLY rows that mention Depop are sent; every other email in the inbox
//     is skipped here, in the browser, and never leaves it;
//   - no cookies, storage, keys, or passwords are read.
//
// Sends, per Depop email row: Proton's row id, sender address, subject,
// unread flag, thread size, and time. MCC turns them into alerts using the
// same rules as Depop emails read over IMAP.

(() => {
  const prev = window.__mccProtonReader;
  if (prev && prev.alive()) return;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  window.__mccProtonReader = { alive };

  const CAPTURE_DELAY_MS = 3_000;
  const MIN_SEND_GAP_MS = 15_000;
  const HEARTBEAT_MS = 60_000;
  const MAX_ROWS = 60;
  const DEPOP = /depop/i;

  let timer = null;
  let lastSentAt = 0;
  let lastHash = "";

  const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // CSS-module-ish classes → readable part only.
  const classHints = (el) =>
    Array.from(el.classList || [])
      .filter((c) => /[a-z]{3}/i.test(c) && c.length < 40)
      .slice(0, 6);

  // The signed-in Proton address (the user's own), from header/account
  // controls only — attributes containing an address.
  function mailbox() {
    for (const el of document.querySelectorAll("header [title], header [aria-label], [data-testid*='heading'] [title], button[title*='@'], [title*='@'][class*='user' i]")) {
      const m = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (m) return m[0].toLowerCase();
    }
    return null;
  }

  // Message rows: row-like list items. Proton's exact markup isn't known
  // yet, so take the usual row containers and keep only the outermost.
  function rows() {
    const sel = "[role='row'], [role='option'], [role='listitem'], li, [data-shortcut-target='item-container'], [data-element-id], [data-testid*='message-item' i], [data-testid*='item-container' i]";
    const all = Array.from(document.querySelectorAll(sel)).filter((el) => visible(el) && (el.innerText || "").trim().length > 0);
    const outer = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    return { total: outer.length, depop: outer.filter((el) => DEPOP.test(`${el.innerText} ${el.getAttribute("aria-label") || ""} ${titlesIn(el)}`)) };
  }
  const titlesIn = (el) =>
    [el, ...el.querySelectorAll("[title], [aria-label], [datetime]")]
      .map((e) => `${e.getAttribute("title") || ""} ${e.getAttribute("aria-label") || ""}`)
      .join(" ");

  function describe(row) {
    const attrs = [];
    for (const e of [row, ...row.querySelectorAll("*")]) {
      if (attrs.length >= 40) break;
      const parts = [];
      for (const name of ["data-testid", "data-element-id", "data-shortcut-target", "role", "aria-label", "title", "datetime"]) {
        const v = e.getAttribute(name);
        if (v) parts.push(`${name}=${clip(v, 120)}`);
      }
      const hints = classHints(e).filter((c) => /unread|read|star|sender|subject|time|date|label|item|attach/i.test(c));
      if (hints.length) parts.push(`class~${hints.join(".")}`);
      if (parts.length) attrs.push(`${e.tagName.toLowerCase()} ${parts.join(" ")}`);
    }
    return {
      lines: (row.innerText || "").split("\n").map((s) => clip(s, 200)).filter(Boolean).slice(0, 8),
      ariaLabel: clip(row.getAttribute("aria-label"), 300),
      fontWeight: getComputedStyle(row.querySelector("span, div, p") || row).fontWeight,
      attrs,
    };
  }

  // Layout clue for the parser: for the (deepest) elements whose own text
  // mentions Depop, the STRUCTURE around them — tags, roles, test ids,
  // attribute names, class hints. No text from anything else.
  function depopAnchors() {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (out.length >= 10) break;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && DEPOP.test(n.textContent));
      if (!own || !visible(el)) continue;
      const chain = [];
      for (let p = el; p && p !== document.body && chain.length < 10; p = p.parentElement) {
        const attrs = Array.from(p.attributes)
          .map((a) => a.name)
          .filter((n) => n !== "class" && n !== "style")
          .slice(0, 8);
        const tid = p.getAttribute("data-testid") || p.getAttribute("data-shortcut-target") || p.getAttribute("role");
        const r = p.getBoundingClientRect();
        chain.push(`${p.tagName.toLowerCase()}${tid ? `[${tid}]` : ""} {${attrs.join(",")}} .${classHints(p).slice(0, 3).join(".")} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      out.push({ text: clip(el.textContent, 120), chain });
    }
    return out;
  }

  // VERIFIED layout (2026-10-24): each email row is
  // [data-shortcut-target="item-container"] with the sender's address in the
  // title of [data-testid="message-column:sender-address"] and the subject in
  // the title of [data-testid="message-row:subject"].
  const isDepopSender = (a) => /@([\w-]+\.)*depop\.com$/i.test(a) && !/@auth\.depop\.com$/i.test(a);
  const LONG_DATE = /^[A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)?,\s*\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M$/i;
  function protonRows() {
    const items = Array.from(document.querySelectorAll("[data-shortcut-target='item-container']")).filter((el) => el.hasAttribute("data-element-id"));
    const out = [];
    for (const row of items) {
      const senderEl = row.querySelector("[data-testid='message-column:sender-address']");
      const sender = (senderEl?.getAttribute("title") || "").trim();
      if (!isDepopSender(sender)) continue; // every non-Depop email stays in the browser
      const subjectEl = row.querySelector("[data-testid='message-row:subject']");
      const text = row.innerText || "";
      const lineList = text.split("\n").map((s) => s.trim());
      out.push({
        id: row.getAttribute("data-element-id"),
        sender,
        subject: clip(subjectEl?.getAttribute("title") || subjectEl?.textContent, 300),
        unread: !!row.querySelector(".item-unread-dot") || /\bUnread email\b/.test(text),
        count: Number(text.match(/(\d+) messages in conversation/)?.[1] || 1),
        when: lineList.find((l) => LONG_DATE.test(l)) || null,
      });
      if (out.length >= MAX_ROWS) break;
    }
    return { items: items.length, rows: out };
  }

  function capture() {
    const { items, rows: found } = protonRows();
    const snapshot = {
      capturedAt: new Date().toISOString(),
      mailbox: mailbox(),
      path: location.pathname,
      totalRows: items, // count only — non-Depop rows are never sent
      rows: found,
    };
    // Layout changed (no email rows recognised)? Send structural clues so
    // the reader can be fixed — Depop-mentioning elements only.
    if (items === 0) {
      snapshot.depopAnchors = depopAnchors();
      snapshot.legacyRows = rows().depop.slice(0, 10).map(describe);
    }
    return snapshot;
  }

  const send = (kind, snapshot) => {
    if (!alive()) return shutDown();
    try {
      chrome.runtime.sendMessage({ type: "mcc-mail", kind, page: { path: location.pathname, visible: document.visibilityState === "visible" }, snapshot });
    } catch {
      shutDown();
    }
  };

  function captureAndSend() {
    timer = null;
    const snapshot = capture();
    const hash = JSON.stringify([snapshot.rows, (snapshot.depopAnchors || []).map((a) => a.text)]);
    if (hash === lastHash) return;
    const wait = lastSentAt + MIN_SEND_GAP_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(captureAndSend, wait);
      return;
    }
    lastHash = hash;
    lastSentAt = Date.now();
    send("snapshot", snapshot);
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(captureAndSend, CAPTURE_DELAY_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const heartbeat = setInterval(() => (alive() ? send("heartbeat") : shutDown()), HEARTBEAT_MS);
  function shutDown() {
    observer.disconnect();
    clearInterval(heartbeat);
    clearTimeout(timer);
  }
  send("heartbeat");
  schedule();
})();
