# Marketplace Command Center — Project Plan

Personal-use, local-first command center for monitoring/managing marketplace
selling activity (messages, offers, listings, inventory, sales, revenue,
expenses, fees, profit, orders, shipping, account health) across multiple
platforms and multiple accounts per platform. Not a SaaS product.

## Environment (as inspected 2026-09-15)

- Windows 11, PowerShell primary shell, Bash tool also available.
- Node v24.19.0, npm 11.17.0 installed. No Python.
- Fresh empty directory, fresh git repo — nothing to preserve.
- Sibling repo `C:\Users\xalex\Alfred` is an unrelated project (a personal
  desk-assistant Electron app) — not touched by this project.

## Stack decisions

- **Monorepo** via npm workspaces (no extra tooling needed — avoids overbuild).
- **Backend**: Node + TypeScript + Fastify. Exposes a local HTTP+WebSocket API
  on `127.0.0.1` only (loopback), with a local API key required on every
  request (`SECURITY.md` #22).
- **Database**: SQLite (file-based, local-first) + **Prisma** ORM/migrations.
- **Frontend**: React + TypeScript + Vite + Tailwind + TanStack Query. Runs as
  a normal local web app (`npm run dev` → `http://127.0.0.1:5173`) talking to
  the local API. No Electron wrapper for the MVP — it adds packaging
  complexity the brief doesn't ask for; a desktop shell can be layered on
  later (`apps/desktop`) without changing `apps/server` or `packages/*`.
- **Connectors**: isolated in `packages/connectors`, all implementing a common
  `MarketplaceConnector` interface with explicit `supportedCapabilities`.
  Mock connectors first (Depop/Facebook/eBay), real connectors later, one at
  a time, each behind its own auth/session handling.
- **Notifications**: `packages/shared` event types → `apps/server`
  `NotificationService` with pluggable channels (Discord webhook, desktop
  notifications via a small native helper).
- **Testing**: Vitest for unit/integration tests on server + shared logic.

## Monorepo layout

```
marketplace-command-center/
  apps/
    server/      Fastify API, Prisma schema/migrations, watchdog manager,
                 event engine, notification service
    web/         React/Vite/Tailwind dashboard UI
  packages/
    shared/      Shared TS types (entities, events, DTOs) + zod schemas
    connectors/  MarketplaceConnector interface + mock + real connectors
  PROJECT_PLAN.md
  README.md
  .env.example
```

## Data model (Phase 2)

Core entities, normalized relationally (Prisma/SQLite), platform-specific
extras in a `metadataJson` column where genuinely variable:

`Platform → PlatformAccount → {Listing, Conversation, Order, Event, Watchdog}`
`InventoryItem → Listing (1:N) → Order/Sale`

Entities: Platform, PlatformAccount, InventoryItem, Listing, Conversation,
Message, Offer, Order, Sale, Expense, Shipment, Event, Notification,
Watchdog.

## Phased implementation

1. Project setup + monorepo scaffold — **done**
2. Database schema (Prisma models + migration) — **done**
3. Accounts + platforms (CRUD API + minimal UI) — **done**
4. Mock connectors (Depop/Facebook/eBay, realistic fake data + events) — **done**
5. Event engine + deduplication — **done**
6. Dashboard (today/week/month/all-time revenue, profit, items sold, health) — **done**
7. Unified inbox — **done**
8. Inventory / listings + cross-listing awareness — **done**
9. Sales / revenue / profit, expenses (manual expense entry) — **done**
10. Discord notifications — **done** (desktop notifications also done, ahead of Phase 17 numbering)
11. Watchdog manager UI + health center — **done**
12. Real connector #1 (Depop, listings-only) — **done**
13. Real connector #2+ (Facebook) — **done 2026-10-05**: listings
    (incl. taken-down detection) + seller messages, read from the user's
    own logged-in session, verified live, Discord alerts delivered. See
    HANDOFF.md "How the Facebook watcher works".

Phases 1–6 reached a runnable, demo-able vertical slice: mock data flows
end-to-end from connector → event engine (with working dedup) → DB →
dashboard API → UI, verified live in the browser including a simulated sale
updating revenue/profit and the activity feed. Also added beyond the
original phase list, because testing surfaced the need:
- `POST /api/dev/accounts/:id/simulate` — dev-only endpoint to trigger
  message/offer/sale/refund/disconnect/duplicate/failure on a mock
  connector (spec section 25's test scenarios), used to verify the pipeline.
- Watchdogs resume automatically on server restart (DB state RUNNING/STALE
  → re-armed on boot), since in-memory timers don't survive a restart.

Phase 7 (unified inbox) is live at `/inbox`: platform/account/unread filters
with live unread counts per platform, search across buyer name / listing
title / full message history, conversation detail (buyer, platform,
account, linked listing with price/URL), reply (routed through the correct
account's connector, capability-gated on `sendMessages` — a connector that
doesn't support it shows a disabled state instead of a broken send),
mark read/unread, and archive/unarchive. All verified live: reply lands in
both the thread and the list preview, search narrows correctly, archive
removes a conversation from the default view and un-archiving restores it.

Phase 8 (inventory + listings + cross-listing awareness) is live at
`/inventory` and `/listings`. InventoryItem CRUD (SKU, title, category,
brand, purchase cost, condition, location, notes, status) with linked
listings shown per item; Listings page across every platform/account with
real per-platform metrics (views/likes/watchers/offers/messages — `N/A`
when the platform doesn't expose one, never invented) and a per-row
dropdown to link/unlink a listing to an InventoryItem. Cross-listing
awareness (`applyCrossListingAwareness` in `syncService.ts`) fires on every
sync: when any listing for an item sells, the InventoryItem flips to SOLD
and every *other* still-ACTIVE listing for that item gets a persistent
`needsDelisting` flag (its own column, deliberately not folded into
`status`, so a routine 30s sync tick can't silently clear it) — shown as a
"NEEDS DELISTING" badge with a manual "dismiss" action, matching the spec's
explicit call for a manual (not automatic) delisting workflow. Verified
live end-to-end: linked a Depop and a Facebook listing to one InventoryItem,
simulated a sale on the Depop side, and confirmed the Facebook listing
flagged needsDelisting while staying ACTIVE, then dismissed it.

Phase 9 (sales/revenue/profit + expenses) is live at `/sales` and
`/expenses`, plus an expanded Dashboard. `computeSaleFinancials` in
`apps/server/src/services/financials.ts` is the one place the spec's
formula lives (revenue = sale price + shipping revenue, minus cost of
goods, platform fees, payment fees, shipping cost, discount, refund, other
costs) — used both by `syncService` on every sync and by the Sales page's
manual edits, so they can never disagree. Cost of goods auto-derives from a
sale's linked InventoryItem the first time a sale is created; shipping,
discounts, refunds, and other costs are manual (platforms don't report
them) and — critically — a routine 30s sync tick never overwrites them
back to 0, since the sync path reads the *existing* Sale's manual fields
before recomputing rather than assuming zero. A refund on the connector
side gets a sensible full-refund default the first time, still editable
after. Expense CRUD (category, amount, date, optional platform/account/
inventory links) feeds into the Dashboard's profit figures for every range.
Dashboard now also shows a full financial breakdown (margin, avg sale
price, avg profit/item, cost of goods, fees, net shipping, discounts,
refunds, expenses) and an ad-hoc custom date range. All verified live,
including the specific failure mode this was designed to avoid: edited a
sale's shipping/discount fields, forced a re-sync, and confirmed the edits
survived rather than reverting.

Phase 10 (notifications) is live at `/settings`. `NotificationService`
(`apps/server/src/services/notificationService.ts` +
`discordChannel.ts`) fires after the event engine records new (deduped)
events, per-event-type routing rules stored in a `NotificationSetting`
table (defaults matching spec section 16's example rule set: new message,
new offer, item sold, watchdog error, account disconnected/auth-required —
everything else off by default, one click to enable). Every Discord
attempt is logged to the existing `Notification` model regardless of
outcome, visible on the Settings page. Desktop notifications use the real
browser Notification API (`DesktopNotificationWatcher`, mounted once at
the app root) — genuinely fires OS-level notifications while a tab is
open, with its background-process limitation stated plainly in the UI
rather than pretended away, since this is a plain web app without the
optional Electron-style desktop shell. Verified live end-to-end including
the failure path: pointed `DISCORD_WEBHOOK_URL` at a syntactically-valid
but nonexistent webhook, confirmed Discord's real API rejected it
(404 "Unknown Webhook"), and confirmed that exact error landed in the
Notification log tied to the right event — then found and fixed a real bug
in the same pass (the log endpoint returned raw `payloadJson` instead of
parsed `payload`, which would have broken the Settings page's rendering).
Also toggled a Discord routing rule through the actual UI checkbox and
confirmed it persisted server-side.

Phase 11 (watchdog manager + health center) split the old combined
"Accounts & Watchdogs" page into two, matching the spec's nav: `/accounts`
is now account CRUD only, `/watchdogs` is a dedicated health center — one
card per account with a spec-section-18-shaped status (🟢 ONLINE /
🟡 STALE / 🚨 ERROR / 🔴 AUTH REQUIRED / ⚫ STOPPED), last sync, last event,
last error, Start/Stop/Restart, a standalone **health check** (distinct
from a full sync — just asks the connector "are you there", per spec
section 5) with its own result field, and a per-account editable sync
interval + staleness threshold (new `staleAfterMs` column; previously a
hardcoded global). Verified live including the specific mechanic spec 18
asks for: manually aged a watchdog's `lastSuccessAt` past its configured
threshold with state still RUNNING, confirmed it flipped to STALE, then
confirmed a successful sync self-heals it back to ONLINE — plus a
standalone health-check button and a live interval/staleness config save,
both through actual clicks.

**Phase 12 (real connector #1 — Depop)**: of the app's three platforms,
only eBay has a legitimate public developer API; Depop and Facebook
Marketplace don't offer one to individual sellers. The user explicitly
chose to proceed with Depop anyway via browser automation, for personal
account monitoring on their own machine — the exact scenario the spec's
section 26 anticipates (isolated connector, real login session instead of
stored passwords, no CAPTCHA/rate-limit bypass). `DepopBrowserConnector`
(`packages/connectors/src/browser/`) is real and fully live-tested, not a
mock: it drives a real headless Chromium (Playwright — needed because the
site sits behind Cloudflare's bot-management JS challenge, which a bare
HTTP client would likely fail) to read a seller's **public** shop page —
no login, no password, ever. Scoped honestly to what's actually real:
`supportedCapabilities: ["listings"]` only. Messages/offers/orders live
behind a login this session had no way to inspect or verify a scraper
against, so those throw `UnsupportedCapabilityError` rather than
pretending to work — real follow-up work for whenever the user is ready to
help validate the authenticated DOM live.

Selectors were grounded in the live site rather than guessed: found and
confirmed Depop's CSS module class names are unstable (content-hashed,
rotate on every deploy) and avoided them entirely, instead using the one
genuinely stable signal — product URLs (`a[href*="/products/"]`) — for
identity, each card's own text for price/sold-status, and each product
page's Open Graph meta tags (`og:title`) for a clean title, since those
are an SEO/social-sharing contract unlikely to change. Verified against a
real public shop (`depop.com/vintage/`, 42 real listings, 24 confirmed
sold) end-to-end through the actual app: seeded the new `depop-live`
platform, created an account, ran a real sync (~23s for 42 listings +
title lookups), and confirmed the scraped titles/prices/sold-status landed
correctly in the DB and rendered correctly on the Listings and Watchdogs
pages, coexisting cleanly with the mock accounts. Also confirmed the
Playwright Chromium process is actually closed (not leaked) when the
watchdog stops.

Building this surfaced two real bugs, both fixed: (1) `syncService.ts`
called `getConversations()`/`getOrders()` unconditionally regardless of
`supportedCapabilities` — harmless for mocks (which support everything)
but would have crashed on this connector; now properly capability-gated
like `getOffers()`/`getSales()` already were. (2) the default
`staleAfterMs` (2 min) was shorter than this connector's default sync
interval (5 min, deliberately gentler than the mocks' 30s to avoid
hammering a real site), which would have made every real account flap to
STALE between syncs; the default staleness threshold now scales with the
account's interval (4×) instead of a fixed constant. One-time local setup:
`npx playwright install chromium` (documented in README.md).

**Phase 13 (real connector #2 — Facebook)**: live research first, same as
Depop. Finding: Facebook exposes *no* public seller data at all — a
logged-out item page shows no seller name, no profile link, nothing in the
DOM (confirmed live). Depop's public `/username/` shop page has no
equivalent here; every path to "your own listings" sits behind login. So
unlike Depop, there was no way to build and self-verify a working scraper
in this session — writing one anyway would mean guessing at authenticated
page structure, which the spec explicitly forbids ("do not create fake
integrations and pretend they are functional").

Given that, and the user's explicit choice to proceed with real login
rather than defer or accept unverified code: built the actual
infrastructure this needs — `packages/connectors/src/browser/
browserSession.ts` manages a persistent Playwright profile per account;
`POST /api/accounts/:id/login-window` opens a **real, visible** browser
window at Facebook's own login page for the user to log into themselves
(a `Log in` button on the Accounts page, honest status shown: "Not logged
in" / "Waiting for login…" / "Session saved"). The app never sees or
stores a password — only the session cookies Chromium itself writes to
that profile as the user interacts, reused headlessly afterward.
`FacebookBrowserConnector` is registered and wired end-to-end (platform
seeded, health check genuinely checks a saved session against the live
site) but honestly ships with `supportedCapabilities: []` — no scraper
methods yet, since those need the real logged-in DOM to build against.

**Hit a real environment wall verifying the login window itself**: calling
the endpoint failed with `spawn UNKNOWN`. Diagnosed thoroughly rather than
guessing — confirmed headless Chromium still launches fine (ruling out a
Playwright/Chromium install problem), confirmed a raw `child_process.spawn`
of the same binary fails identically (ruling out a Playwright-specific
bug), and confirmed the failure is identical via both Bash and PowerShell
tool calls. Conclusion: the sandboxed environment this session's tool
calls execute through can spawn *headless* processes but not ones that
open a real GUI window — a restriction on this tool session, not a defect
in the app. The code is very likely correct and should work when the user
runs `npm run dev` themselves from their own terminal, in their own normal
desktop session — that's genuinely untested by me, not verified-working,
and is the concrete next step: run it locally, click "Log in" on the
Facebook (Live) account, and report back either way so this can be
finished (or debugged for real, if it turns out not to be purely a sandbox
issue).

**Update — user tested it**: the sandbox theory was confirmed (a real
window opened from the user's own terminal, and they logged in), but two
real bugs surfaced: (1) the "is a window still open" tracking relied on
Playwright's `close` event, which doesn't reliably fire when a persistent-
context window is closed via Windows' own title bar — when it didn't fire,
the flag stuck `true` forever, which both permanently disabled the "Log
in" button (matches "wasn't always working") and hard-coded the status
display to "waiting" regardless of actual login state (matches "didn't
update"). Fixed by removing that in-memory flag entirely — `openLoginWindow`
no longer tracks open/closed state at all and just lets Chromium's own
profile lock throw naturally if a window is already open on that profile;
`GET /login-status` now calls the connector's real `healthCheck()` against
the live site instead of guessing from the filesystem. (2) The old status
endpoint called the filesystem heuristic unconditionally for every
account regardless of platform, which is how several unrelated accounts —
including mock ones — ended up with harmless empty `.browser-profiles/`
directories as a side effect.

**Empty-profile mystery — solved (2026-10-05)**: every Facebook profile
folder was empty because the login launch never got as far as Chromium
writing anything. Playwright failed with `Executable doesn't exist at
...\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`.
The cause: Claude's tool sandbox gets its own private view of
`AppData\Local`. The `npx playwright install chromium` run from that
sandbox on 2026-09-16 put the browser only in the sandbox's copy. From the
user's real session the whole `ms-playwright` folder didn't exist (checked
with a `dir` run via `explorer.exe`). The profile folder is `mkdir`'d
before the launch, so each failed launch left an empty folder. The route
had also been masking this: every launch failure was reported as "a login
window may already be open". It now reports the real cause: a missing
browser gets an install instruction, a real profile lock gets the
"already open" message, and anything else shows the raw error.
`openLoginWindow` also logs `[login-window]` lines (profile path, launch
result, file count). Fix: install Chromium from the user's session, not
from Claude's tools (see HANDOFF.md). The same applies to the headless
Depop connector: on a server started in the user's session it needs that
install too.

Phases 7+ are substantial features in their own right and will be built in
follow-up sessions, reviewed incrementally rather than dumped in one pass.

## Open items to revisit (not blocking Phase 1–6)

- Which real platforms to integrate first, and via official API vs. isolated
  browser automation — decide when we get to Phase 12.
- Desktop notification mechanism on Windows (native toast vs. Electron) —
  decide when we get to Phase 10/11.
- Whether a packaged desktop shell (`apps/desktop`) is wanted at all, or the
  local web app is sufficient — revisit after the MVP is in daily use.
