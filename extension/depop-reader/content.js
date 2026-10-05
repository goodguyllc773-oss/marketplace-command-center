// MCC Depop Reader — content script.
//
// Runs inside the depop.com tab YOU opened. It reads what the messages
// page shows and hands it to the extension's background worker, which
// posts it to MCC on this PC. No cookies, storage, or tokens are read.
//
// The only clicks it ever makes (each the user's choice, settings page),
// only from the conversation LIST and only when nobody has touched the
// page for a minute:
//   - Depop's own "Refresh" control, every few minutes;
//   - the "Offers" tab (when it shows "unread offers", and every N
//     minutes), then the "Chat" tab to go back.
// It never opens conversations (that would mark them read), types, or
// sends anything.
//
// The page is captured generically (link paths, text lines, labels,
// layout position); MCC parses it server-side, so parsing can improve
// without reinstalling the extension.

(() => {
  // After an extension reload/update, a previous copy of this script can
  // linger in the tab, cut off from the extension. Run only if no live
  // copy exists; a cut-off copy shuts itself down (see `alive`).
  const prev = window.__mccDepopReader;
  if (prev && prev.alive()) return;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  window.__mccDepopReader = { alive };

  const CAPTURE_DELAY_MS = 3_000; // let a burst of DOM changes settle
  const MIN_SEND_GAP_MS = 10_000;
  const HEARTBEAT_MS = 60_000;
  const TICK_MS = 30_000;
  const IDLE_BEFORE_REFRESH_MS = 60_000; // don't refresh while you're using the page

  let timer = null;
  let lastSentAt = 0;
  let lastHash = "";
  let lastRefreshAt = 0;
  let lastInteractionAt = Date.now();
  let refreshProblem = null;
  let lastOffersVisitAt = 0;
  let offersVisit = null; // { startedAt } while the extension has the Offers tab open
  let unreadOffersSince = 0; // when "unread offers" last appeared on the Offers tab
  let settings = { autoRefresh: true, refreshMinutes: 3, offersCheck: true, offersMinutes: 15 };

  const loadSettings = () =>
    chrome.storage.local.get(["autoRefresh", "refreshMinutes", "lastRefreshAt", "offersCheck", "offersMinutes", "lastOffersVisitAt"]).then((s) => {
      settings = {
        autoRefresh: s.autoRefresh !== false,
        refreshMinutes: Math.min(30, Math.max(2, Number(s.refreshMinutes) || 3)),
        offersCheck: s.offersCheck !== false,
        offersMinutes: Math.min(120, Math.max(5, Number(s.offersMinutes) || 15)),
      };
      // Kept across page loads, so a reload never shortens the intervals.
      lastRefreshAt = Math.max(lastRefreshAt, Number(s.lastRefreshAt) || 0);
      lastOffersVisitAt = Math.max(lastOffersVisitAt, Number(s.lastOffersVisitAt) || 0);
    });
  void loadSettings();
  chrome.storage.onChanged.addListener(() => alive() && void loadSettings());

  const onMessagesPage = () => location.pathname.startsWith("/messages");
  const onListPage = () => /^\/messages\/?$/.test(location.pathname);

  const send = (kind, snapshot) => {
    if (!alive()) return shutDown();
    try {
      chrome.runtime.sendMessage({
        type: "mcc-depop",
        kind,
        page: {
          path: location.pathname,
          title: document.title,
          visible: document.visibilityState === "visible",
          autoRefresh: settings.autoRefresh,
          refreshMinutes: settings.refreshMinutes,
          lastRefreshAt: lastRefreshAt ? new Date(lastRefreshAt).toISOString() : undefined,
          refreshProblem: refreshProblem || undefined,
          offersCheck: settings.offersCheck,
          offersMinutes: settings.offersMinutes,
        },
        snapshot,
      });
    } catch {
      shutDown();
    }
  };

  const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const lines = (el, max, len) =>
    (el.innerText || "")
      .split("\n")
      .map((s) => clip(s, len))
      .filter(Boolean)
      .slice(0, max);
  // CSS-module classes look like "styles_unreadDot__x7Yz1" — keep the
  // readable middle ("unreadDot"), drop the hash.
  const classHints = (el) =>
    Array.from(el.classList || [])
      .map((c) => c.replace(/^[A-Za-z0-9]+_/, "").replace(/__[A-Za-z0-9_-]+$/, ""))
      .filter((c) => /[a-z]{3}/i.test(c))
      .slice(0, 4);
  const testIds = (el) =>
    [el, ...el.querySelectorAll("[data-testid]")]
      .map((e) => e.getAttribute && e.getAttribute("data-testid"))
      .filter(Boolean)
      .slice(0, 10);
  const pathOf = (href) => {
    try {
      return new URL(href, location.origin).pathname;
    } catch {
      return href;
    }
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  function capture() {
    const conversations = Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => /^\/messages\/.+/.test(pathOf(a.getAttribute("href"))))
      .slice(0, 100)
      .map((a) => {
        const first = a.querySelector("p, span, div") || a;
        return {
          path: pathOf(a.getAttribute("href")),
          ariaLabel: clip(a.getAttribute("aria-label"), 200),
          ariaCurrent: a.getAttribute("aria-current"),
          lines: lines(a, 8, 1000),
          testIds: testIds(a),
          classHints: [a, ...a.querySelectorAll("*")].flatMap(classHints).filter((c, i, all) => all.indexOf(c) === i).slice(0, 20),
          firstWeight: getComputedStyle(first).fontWeight,
        };
      });

    const times = Array.from(document.querySelectorAll("time"))
      .slice(0, 200)
      .map((t) => ({ datetime: t.getAttribute("datetime"), text: clip(t.innerText, 60) }));

    const testIdCounts = {};
    document.querySelectorAll("[data-testid]").forEach((e) => {
      const id = e.getAttribute("data-testid");
      testIdCounts[id] = (testIdCounts[id] || 0) + 1;
    });

    // The open conversation (if any). Depop shows the conversation list and
    // the open conversation side by side, so: the scrollable area holding
    // the most text that is NOT the list (contains no conversation links).
    // Each text block's horizontal position tells left vs right.
    let thread = null;
    let scrollAreas = [];
    if (/^\/messages\/.+/.test(location.pathname)) {
      const isConversationLink = (a) => /^\/messages\/[0-9a-f]{16,}/.test(pathOf(a.getAttribute("href")));
      const scrollers = Array.from(document.querySelectorAll("body *")).filter((e) => {
        const s = getComputedStyle(e);
        return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20;
      });
      scrollAreas = scrollers.slice(0, 20).map((e) => ({
        hint: classHints(e)[0] || e.tagName.toLowerCase(),
        width: Math.round(e.getBoundingClientRect().width),
        textLength: (e.innerText || "").length,
        hasConversationLinks: Array.from(e.querySelectorAll("a[href]")).some(isConversationLink),
      }));
      const box = scrollers
        .filter((e) => !Array.from(e.querySelectorAll("a[href]")).some(isConversationLink))
        .sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0];
      if (box) {
        const r = box.getBoundingClientRect();
        const blocks = [];
        box.querySelectorAll("*").forEach((e) => {
          if (blocks.length >= 300) return;
          const ownText = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!ownText) return;
          const er = e.getBoundingClientRect();
          if (er.width === 0 || er.height === 0) return;
          const anc = [];
          for (let p = e; p && p !== box && anc.length < 5; p = p.parentElement) {
            const id = p.getAttribute("data-testid");
            anc.push(id ? `#${id}` : classHints(p)[0] || p.tagName.toLowerCase());
          }
          blocks.push({
            text: clip(e.innerText, 1000),
            tag: e.tagName.toLowerCase(),
            ariaLabel: clip(e.getAttribute("aria-label"), 200),
            left: Math.round(er.left - r.left),
            right: Math.round(r.right - er.right),
            ancestors: anc,
          });
        });
        thread = { width: Math.round(r.width), scrollTop: Math.round(box.scrollTop), scrollHeight: box.scrollHeight, blocks };
      }
    }

    // Off the conversation list (an open conversation, the Offers tab):
    // every visible text block with its on-screen box and bubble colour,
    // every link (item slugs, profiles) and image label — the open
    // conversation isn't always a scrollable area, so capture broadly and
    // let MCC work out the layout.
    let blocks = [];
    let links = [];
    let images = [];
    if (!/^\/messages\/?$/.test(location.pathname)) {
      // The conversation list's own scroll area — the INNERMOST scrollable
      // element holding conversation links (an outer page wrapper can be
      // scrollable too, and holds the open conversation as well).
      const holdsList = (e) =>
        /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
        Array.from(e.querySelectorAll("a[href]")).some((a) => /^\/messages\/[0-9a-f]{16,}/.test(pathOf(a.getAttribute("href"))));
      const candidates = Array.from(document.querySelectorAll("body *")).filter(holdsList);
      const listAreas = candidates.filter((c) => !candidates.some((o) => o !== c && c.contains(o)));
      const skip = (e) => e.closest("header, nav, [role=banner], [role=navigation]") || listAreas.some((l) => l.contains(e));
      const bubbleColour = (e) => {
        for (let p = e, i = 0; p && i < 6; p = p.parentElement, i++) {
          const bg = getComputedStyle(p).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        }
        return null;
      };
      document.querySelectorAll("body *").forEach((e) => {
        if (blocks.length >= 500 || skip(e)) return;
        if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const anc = [];
        for (let p = e; p && anc.length < 5; p = p.parentElement) {
          const id = p.getAttribute("data-testid");
          anc.push(id ? `#${id}` : classHints(p)[0] || p.tagName.toLowerCase());
        }
        blocks.push({
          text: clip(e.innerText, 1000),
          tag: e.tagName.toLowerCase(),
          ariaLabel: clip(e.getAttribute("aria-label"), 200),
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          bg: bubbleColour(e),
          ancestors: anc,
        });
      });
      links = Array.from(document.querySelectorAll("a[href]"))
        .filter((a) => !skip(a))
        .slice(0, 150)
        .map((a) => {
          const r = a.getBoundingClientRect();
          return {
            path: pathOf(a.getAttribute("href")),
            lines: lines(a, 6, 300),
            ariaLabel: clip(a.getAttribute("aria-label"), 200),
            imgAlt: clip(a.querySelector("img")?.getAttribute("alt"), 200),
            x: Math.round(r.left),
            y: Math.round(r.top),
          };
        });
      images = Array.from(document.querySelectorAll("img[alt]"))
        .filter((i) => !skip(i) && i.getAttribute("alt").trim())
        .slice(0, 100)
        .map((i) => {
          const r = i.getBoundingClientRect();
          return { alt: clip(i.getAttribute("alt"), 200), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
        });
    }

    return {
      capturedAt: new Date().toISOString(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      conversations,
      times,
      testIdCounts,
      thread,
      scrollAreas,
      blocks,
      links,
      images,
      headings: Array.from(document.querySelectorAll("h1, h2, h3")).map((h) => clip(h.innerText, 120)).slice(0, 20),
    };
  }

  function captureAndSend() {
    timer = null;
    if (!onMessagesPage()) return;
    const snapshot = capture();
    const hash = JSON.stringify({ c: snapshot.conversations, b: snapshot.blocks.map((b) => b.text) });
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

  // Auto-refresh: click Depop's own "Refresh" button on the list, only when
  // the list is showing and nobody has touched the page for a minute.
  function maybeRefresh() {
    if (!settings.autoRefresh || !onListPage()) return;
    if (Date.now() - lastRefreshAt < settings.refreshMinutes * 60_000) return;
    if (Date.now() - lastInteractionAt < IDLE_BEFORE_REFRESH_MS) return;
    // Depop draws its header actions as styled links as well as buttons
    // ("Filter by unread" is a link) — match the control labelled Refresh.
    const isRefresh = (el) =>
      /^refresh$/i.test((el.innerText || "").trim()) || /^refresh$/i.test((el.getAttribute("aria-label") || "").trim());
    const control = Array.from(document.querySelectorAll("button, a, [role=button]")).find(
      (el) => isRefresh(el) && visible(el) && !el.disabled,
    );
    if (!control) {
      // Say what WAS there, so the match can be fixed.
      const near = Array.from(document.querySelectorAll("body *"))
        .filter((el) => /^\s*refresh\s*$/i.test(el.innerText || "") && el.children.length <= 3)
        .slice(0, 3)
        .map((el) => `<${el.tagName.toLowerCase()}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}${el.getAttribute("data-testid") ? ` testid=${el.getAttribute("data-testid")}` : ""}>`);
      refreshProblem = `Depop's Refresh control wasn't found${near.length ? ` (saw ${near.join(", ")})` : ""}`;
      return;
    }
    refreshProblem = null;
    lastRefreshAt = Date.now();
    void chrome.storage.local.set({ lastRefreshAt });
    control.click();
  }

  // Offers check: open Depop's Offers tab (when it shows "unread offers",
  // and every few minutes anyway), read it, then go back to Chat. Same
  // rules as refresh: only from the list, only when the page is idle.
  // Viewing the tab clears Depop's own "unread offers" marker — MCC alerts
  // instead.
  // The Chat/Offers tabs are links (other links also point at /messages/,
  // e.g. the header's mail icon — prefer the one labelled as the tab).
  const tabLink = (path, label) => {
    const links = Array.from(document.querySelectorAll(`a[href="${path}"], a[href="https://www.depop.com${path}"]`)).filter(visible);
    return links.find((a) => new RegExp(`\\b${label}\\b`, "i").test(a.innerText || "")) ?? null;
  };
  const unreadOffersShown = () => /unread offers/i.test(tabLink("/messages/offers/", "Offers")?.innerText || "");

  function maybeVisitOffers() {
    if (!settings.offersCheck || offersVisit || !onListPage()) return false;
    if (Date.now() - lastInteractionAt < IDLE_BEFORE_REFRESH_MS) return false;
    // "unread offers" can stay on after viewing (seen live), so it only
    // brings a visit forward once each time it appears.
    const unread = unreadOffersShown();
    if (!unread) unreadOffersSince = 0;
    else if (!unreadOffersSince) unreadOffersSince = Date.now();
    const since = Date.now() - lastOffersVisitAt;
    const due = (unread && lastOffersVisitAt < unreadOffersSince) || since >= settings.offersMinutes * 60_000;
    const link = due && tabLink("/messages/offers/", "Offers");
    if (!link) return false;
    offersVisit = { startedAt: Date.now() };
    lastOffersVisitAt = Date.now();
    void chrome.storage.local.set({ lastOffersVisitAt });
    link.click();
    setTimeout(finishOffersVisit, 8_000);
    return true;
  }

  function finishOffersVisit(retries = 2) {
    if (!offersVisit || !alive()) return;
    if (!/^\/messages\/offers\/?$/.test(location.pathname)) {
      offersVisit = null; // something else navigated — leave it alone
      return;
    }
    const loaded = document.querySelector('a[href^="/products/"]') || /no offers|past offers|active offers/i.test(document.body.innerText);
    if (!loaded && retries > 0) {
      setTimeout(() => finishOffersVisit(retries - 1), 8_000);
      return;
    }
    // Send the Offers tab now (not subject to the update gap), then go back
    // to Chat — unless you started using the page meanwhile.
    clearTimeout(timer);
    timer = null;
    const snapshot = capture();
    lastHash = JSON.stringify({ c: snapshot.conversations, b: snapshot.blocks.map((b) => b.text) });
    lastSentAt = Date.now();
    send("snapshot", snapshot);
    const touched = lastInteractionAt > offersVisit.startedAt;
    offersVisit = null;
    if (!touched) tabLink("/messages/", "Chat")?.click();
  }

  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, (e) => e.isTrusted && (lastInteractionAt = Date.now()), { capture: true, passive: true });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const heartbeat = setInterval(() => onMessagesPage() && send("heartbeat"), HEARTBEAT_MS);
  const ticker = setInterval(() => {
    if (!alive()) return shutDown();
    if (!maybeVisitOffers()) maybeRefresh();
  }, TICK_MS);

  function shutDown() {
    observer.disconnect();
    clearInterval(heartbeat);
    clearInterval(ticker);
    clearTimeout(timer);
  }

  if (onMessagesPage()) {
    send("heartbeat");
    schedule();
  }
})();
