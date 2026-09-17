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
13. Real connector #2+ — not started

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

Phases 7+ are substantial features in their own right and will be built in
follow-up sessions, reviewed incrementally rather than dumped in one pass.

## Open items to revisit (not blocking Phase 1–6)

- Which real platforms to integrate first, and via official API vs. isolated
  browser automation — decide when we get to Phase 12.
- Desktop notification mechanism on Windows (native toast vs. Electron) —
  decide when we get to Phase 10/11.
- Whether a packaged desktop shell (`apps/desktop`) is wanted at all, or the
  local web app is sufficient — revisit after the MVP is in daily use.
