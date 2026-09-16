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
9. Sales / revenue / profit, expenses (manual expense entry) — not started
10. Discord notifications — not started
11. Watchdog manager UI + health center — partially done (start/stop/restart/sync
    + status from Phase 3-6 work; no dedicated health page / staleness UI yet)
12. Real connector #1 — not started
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

Phases 7+ are substantial features in their own right and will be built in
follow-up sessions, reviewed incrementally rather than dumped in one pass.

## Open items to revisit (not blocking Phase 1–6)

- Which real platforms to integrate first, and via official API vs. isolated
  browser automation — decide when we get to Phase 12.
- Desktop notification mechanism on Windows (native toast vs. Electron) —
  decide when we get to Phase 10/11.
- Whether a packaged desktop shell (`apps/desktop`) is wanted at all, or the
  local web app is sufficient — revisit after the MVP is in daily use.
