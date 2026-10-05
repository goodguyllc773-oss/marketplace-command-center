# Handoff

Read this first, every time, before touching anything else. Update it
before you stop and immediately before any context compaction (see
CLAUDE.md for the exact rule).

_Last updated 2026-10-05 (Windows box), mid-session. Today:_
- _**The Facebook watchdog now works for real.** It reads the user's own
  listings, taken-down listings, and Marketplace messages every 2 min,
  and sends Discord alerts._
- _Also solved the empty-profile mystery (Claude's sandbox has a private
  `AppData`)._
- _Removed all sample data and made mock platforms opt-in._
- _Added CLAUDE.md + this file._

## Current state

- **Branch:** main. Last commit `7af5dd5`. Today's work is not committed
  yet; check `git status`. **No git remote**, so commit only.
- **Dev servers:** started with `explorer.exe
  "C:\Users\xalex\marketplace-command-center\start-dev.cmd"`, which opens
  a console window in the user's session. API on 127.0.0.1:4000, web on
  127.0.0.1:5173. They must run outside Claude's sandbox; see CLAUDE.md.
- **Playwright Chromium (v1243) is installed in the user's real
  AppData** (done via an `explorer.exe`-launched script).
- **DB contents:**
  - Only real data. Account: Facebook (Live) / Personal
    (`cmu56nxuz0016nz4s5m325iy1`). The user is logged in; the session is in
    `apps/server/.browser-profiles/cmu56nxuz…/`.
  - Its watchdog is RUNNING, every 120 s, stale after 480 s.
  - The 24 NotificationSetting rows are the user's Discord preferences.
    `LISTING_REMOVED` was switched ON today, at the user's request for
    takedown alerts.
  - Don't re-add sample data. Mocks only appear with `MCC_ENABLE_MOCKS=true`.
- **DB backup from before the sample wipe:**
  `apps/server/prisma/dev.db.backup-2026-10-05-before-sample-wipe`
  (gitignored).
- **Discord webhook is set in the app: Settings → Discord notifications →
  Webhook URL** (added 2026-10-05).
  - Stored in the new `AppSetting` table (migration
    `add_app_settings`, key `discordWebhookUrl`). It overrides
    `DISCORD_WEBHOOK_URL` in `.env`, which is now only a fallback.
  - The API only ever returns a masked hint (webhook id + last 4 chars),
    never the full URL. URLs are validated as Discord webhooks.
  - The user saved a new webhook there on 2026-10-05 (id
    `1556722663605538940`); a test message sent OK. The older test
    webhook in `.env` (id `1552453358491668621`) is now unused while the
    app one is set.
  - Never commit either URL.
- **Per-category Discord channels** (added 2026-10-05):
  - Categories live in `@mcc/shared` (`NOTIFICATION_CATEGORIES`,
    `categoryForEvent`); every event type maps to exactly one (verified):
    Messages, Offers, Listings (new / updated / taken down), Sales &
    orders (sold, orders, payments, refunds, shipping), Account health.
  - Each category can have its own webhook (AppSetting key
    `discordWebhookUrl:<category>`). Lookup order: category → default →
    `.env`.
  - On Settings, each category is its own block: webhook field, Test,
    "use default", and its alert on/off toggles.
  - Verified live: gave Listings the older test webhook and its Test
    landed there while the other categories stayed on default. Then
    reverted to default. **All categories currently use the default
    channel**; the user will add per-channel webhooks.
- **Gotcha #1:** the server loads `@mcc/connectors` from its compiled
  `packages/connectors/dist/`, not `src/`. After editing connector source,
  run `npm run build --workspace=packages/connectors` (and `shared` first
  if it changed). The server's `tsx watch` then restarts on its own.
- **Gotcha #2:** Claude's tool sandbox can't open visible windows and
  doesn't share `AppData` with the user's session (see CLAUDE.md). To run
  something "as the user", write a `.cmd`, launch it with `explorer.exe`,
  and have it write output to a file in the repo.
- **Gotcha #3:** after editing `apps/web/tailwind.config.js`, restart Vite.

## How the Facebook watcher works

- **Data source.** `FacebookBrowserConnector` (`packages/connectors/src/
  browser/`) opens two pages headlessly with the saved session:
  `/marketplace/you/selling/` and `/marketplace/inbox/`.
- **What it reads.** Facebook's own structured data (embedded
  `<script type="application/json">` blocks plus `/api/graphql`
  responses), not the visual layout. The layout has no IDs, and several
  listings share a title. The field names are in the class doc comment.
- **Status mapping.** Facebook's `renderable_listing_status`:
  `AVAILABLE` → ACTIVE, `SOLD` → SOLD, `REVIEW_REJECTED` (or
  `listing_is_rejected`) → REMOVED. The reason text (e.g. "This listing
  may go against our rules for selling.") goes into
  `Listing.metadataJson.statusNote`. The Listings page shows these as
  "TAKEN DOWN" plus the reason.
- **Messages.** Seller-tab threads only. Facebook exposes just the latest
  message's preview and ID, not its sender. So a message is INBOUND
  (buyer) only when the thread is unread, otherwise UNKNOWN. Full thread
  history is end-to-end encrypted and not readable.
- **Request budget.** One scan is cached for 60 s, so a watchdog tick plus
  the Accounts page's status polling never hit facebook.com more than
  once a minute.
- **Events are derived by the server** (`coreDiffsState`), in
  `syncService.ts`, by diffing each scan against the DB:
  - new listing, sold, taken down, back up, price change;
  - a listing missing from the page → REMOVED ("deleted or taken down").
    This is skipped if a scan returns zero listings.
  - a new INBOUND message → `MESSAGE_RECEIVED`.

  Dedupe keys are stable or tied to the transition, so restarts never
  re-send alerts (verified: two restarts, still the same 5 events). An
  account's first sync is a baseline: existing listings aren't announced
  as new, but already-taken-down listings and unread messages are.
- **Inventory follows listings automatically** (real connectors only):
  - A listing seen for the first time gets its own InventoryItem, created
    and linked ("Auto-added from facebook-live listing"). Only at first
    sight, so a link the user removes or changes is never re-created.
  - After each sync, every touched item's status is recomputed from all
    its listings: any SOLD → SOLD, else any ACTIVE → LISTED, else
    INVENTORY (taken down / deleted puts it back in inventory).
  - Items the user moved to RESERVED / PAID / SHIPPED / DELIVERED /
    RETURNED / REFUNDED are never overwritten.
  - The user's 7 existing listings were backfilled by a one-off script on
    2026-10-05: 5 INVENTORY, 1 LISTED, 1 SOLD. Verified a sync afterward
    keeps them as-is with no duplicates.
  - Not yet seen live: the create-on-new-listing path, which waits for the
    user's next new Facebook listing.
- **Depop (Live)** was moved onto the same core diffing; its old
  in-memory diff re-fired every alert after each restart.

## Last verified working (2026-10-05)

- **First real Facebook scan** (watchdog sync, user's account):
  - 7 listings: 5 DESIGNER CARDHOLDERS $30 flagged REVIEW_REJECTED, 1
    active DESIGNER CARDHOLDERS $30, 1 sold ROLLING LOUD VIP $450. Click
    counts went into `views`.
  - 21 seller conversations, linked to their listings by Facebook listing
    ID.
  - 5 `LISTING_REMOVED` events. **All 5 delivered to Discord** (the
    Notification log shows SENT), plus a manual test embed.
- **UI, checked in the browser pane:**
  - Listings shows TAKEN DOWN + reason for the 5.
  - Inbox lists the conversations with buyer, listing, and latest preview.
  - Watchdogs: 🟢 ONLINE. Dashboard: 1 active listing, 1 watchdog running.
- **Watchdog restart bug fixed.** Changing the interval restarted the
  watchdog, which reused a headless browser that was still closing
  ("Target page, context or browser has been closed").
  `browserSession.ts` now tracks closing contexts and waits for them.
  Verified with two back-to-back restarts → RUNNING, no error.
- **Facebook login window** works from a server started via
  `start-dev.cmd`. The user logged in; the session is saved.
- **Login errors** report the real cause (missing browser / profile lock /
  raw error).
- `npm run typecheck`: clean across all 4 workspaces.

## Facebook conversation hydration (2026-10-05)

Reads a conversation's full history, with real sender and direction,
from Facebook's **normal conversation view**:
`/messages/t/{thread_fbid}/`. Each message is a `role="article"` with an
aria-label like `Enter, Message sent September 28, 2026, 3:33 PM by You:
text`. The inbox data itself has no sender. Marketplace threads are not
E2EE and render behind the "Enter your PIN to restore your chats" dialog
(which is for the user's other chats); **never interact with it.**

- **Parser:** `packages/connectors/src/browser/facebookConversationParser.ts`.
  - Sender "You" → OUTBOUND. Notices ("started this chat", "Beware of…",
    "is waiting for your response", "sent you a message about your
    listing") → SYSTEM, sender "Facebook". Everyone else → INBOUND.
  - A label with an empty sender is rejected: Facebook briefly renders
    `…by : text` before names load (this bit us on the first live run).
  - Fingerprint: `facebook:{thread}:{minuteISO}:{direction}:{sha1(body)[:16]}[#n]`,
    stored in `Message.externalMessageId`.
  - Same-minute messages are stored a few ms apart in on-screen order;
    the fingerprint keeps the plain minute.
- **Connector:** `FacebookBrowserConnector.hydrateConversation(threadId,
  {manual})`.
  - Read-only: navigate, wait for articles, wait for labels to settle
    (names loaded, count stable), read labels, DOM-scroll the message list
    upward. No clicks, typing, or key presses.
  - Stops at "started this chat", at the top, after 2 stale passes, or at
    the scroll limit.
  - Statuses: SUCCESS / NO_HISTORY_FOUND / AUTH_REQUIRED (login,
    checkpoint, security check) / PIN_DIALOG_PRESENT (only the PIN
    rendered) / PAGE_ERROR / TIMEOUT / RATE_LIMITED (429, "temporarily
    blocked") / UNKNOWN_ERROR.
  - A page lock (`withPage`) serializes the routine scan and
    conversation reads on the one shared page.
- **Config** (`.env`, defaults): `FB_HYDRATIONS_PER_CYCLE=3`,
  `FB_HYDRATION_PAUSE_MS=5000`, `FB_HYDRATION_MAX_SCROLLS=6`,
  `FB_HYDRATION_MANUAL_MAX_SCROLLS=25`, `FB_HYDRATION_SCROLL_WAIT_MS=1500`,
  `FB_HYDRATION_PAGE_TIMEOUT_MS=45000`.
- **Watchdog cycle** (`syncService` → `services/conversationHydration.ts`):
  - Hydrates only conversations whose inbox latest-message id differs
    from `Conversation.hydratedMessageId`, up to the cap per cycle.
  - **Unread conversations are never opened automatically**, because
    opening a thread can mark it read on Facebook and the buyer may see
    "Seen". Their preview stays INBOUND (your own message can't be unread
    to you) and alerts immediately; they're hydrated after the user reads
    them.
  - AUTH_REQUIRED / RATE_LIMITED stop hydration for the cycle and surface
    as the watchdog's error.
- **Reconciliation:** inbox-preview placeholder rows are matched by body
  and converted in place to the real message (or deleted if it's already
  stored) before inserting, so nothing is duplicated or double-alerted.
- **Alerts:** `MESSAGE_RECEIVED` only for genuinely new INBOUND rows (or
  rows converted from an UNKNOWN placeholder), dated at or after the last
  read of that conversation. A never-read conversation only alerts for
  messages within 10 minutes before it was first seen. Dedupe key
  `msg:<fingerprint>`. Never alerts for OUTBOUND, SYSTEM, or UNKNOWN.
- **Preview fix:** `GenericAdminTextMessage` previews → SYSTEM; read
  `UserMessage` previews → UNKNOWN until hydrated.
- **DB:** migration `add_conversation_hydration` adds
  `Conversation.hydratedMessageId` and `hydratedAt` (nullable). The
  `Message.direction` comment now documents INBOUND | OUTBOUND | SYSTEM |
  UNKNOWN.
- **API/UI:**
  - `POST /api/conversations/:id/history` (manual, deeper scroll limit).
  - The conversation detail returns `platformUrl` and `canLoadHistory`.
  - Inbox header: "Open in Facebook ↗" and "Load conversation history"
    (asks for confirmation if the conversation was unread).
  - Bubbles: You on the right, the buyer's name on the left, SYSTEM as a
    centered muted line, UNKNOWN labeled "sender not known yet".
- **Verified live with the real session:**
  - A/B/C: buyer INBOUND, You OUTBOUND, mixed order correct.
  - D: SYSTEM rows, 0 `MESSAGE_RECEIVED`.
  - E: second load → added 0, updated 0.
  - F: after a full server restart → added 0, updated 0.
  - G: 8-message thread, full history in 8 s.
  - H: link is `https://www.facebook.com/messages/t/948795698294796/`
    with `target=_blank`; the UI button works.
  - Background backfill reached 9/21 conversations, 0 false alerts.
- **Hardening pass (2026-10-05, second round):**
  - **Unread guard at the boundary.** `hydrateConversation` itself
    returns `SKIPPED_UNREAD` (without navigating) when Facebook's own
    unread count, from the ≤60 s inbox scan, is > 0, unless
    `allowUnread`.
    - `hydrateAndStore` also refuses when `platformUnread`.
    - **Bug fixed:** the manual route used to trust MCC's `unread` flag,
      which MCC clears when you open a conversation in MCC. That could
      have opened a Facebook-unread thread without confirmation.
    - The manual route takes `{confirmUnread}`. The UI confirms first if
      it knows the conversation is unread (cancel = no Facebook
      activity), and otherwise confirms when the server answers
      `SKIPPED_UNREAD`.
  - **Atomic writes.** All message writes and the checkpoint run in one
    `prisma.$transaction`, so a failure never advances
    `hydratedMessageId`/`hydratedAt`.
  - **Placeholder matching:** text first; otherwise the latest unclaimed
    message at or before the preview time. SYSTEM placeholders only match
    by text.
  - **Notices:** inbox previews matching notice text → SYSTEM
    (`isSystemNotice`). Existing UNKNOWN placeholders are corrected on the
    next scan.
  - **Alert payloads:** `source` (`FACEBOOK_MARKETPLACE_INBOX` for
    previews, with `unreadCount` + `sentAt`; `FACEBOOK_CONVERSATION` for
    reads).
  - **Logs:** `[fb-hydration] conversation <id> started / skipped:
    unread / found N / completed added N updated N / failed STATUS`. No
    message text; database errors are logged by code only.
  - **Parser:** timestamp range validation. Documented that the
    fingerprint is synthetic, not Facebook's id. 10 unit tests in
    `packages/connectors/test/` (`npm test`; node:test, no deps). The
    server's `vitest run` got `--passWithNoTests`.
  - **UI:** Hydrated / Hydrating… / Skipped — unread / Needs attention /
    Failed badges in plain words. SYSTEM rows render as a "FACEBOOK"
    notice box; UNKNOWN as "Unknown sender".
  - **Live re-verification:** the background read finished all 21
    conversations (98 rows, 0 duplicate (conversation, id) pairs,
    **0 MESSAGE_RECEIVED**); placeholders reconciled live; repeat loads
    and a post-restart load → 0 added / 0 updated.
- **Not yet exercised live (needs the user):**
  1. A new **unread** buyer message: alert from the preview, not opened,
     no "Seen"; hydrated after the user reads it, with no second alert.
  2. A new **outbound** message sent by the user from Facebook → stored
     as OUTBOUND, no alert.
  3. Scrolling on a conversation longer than one screen (none exist).
  4. The RATE_LIMITED / AUTH_REQUIRED paths, and the `SKIPPED_UNREAD`
     guard itself (no unread conversation existed during testing).
- A first live run stored 14 rows with sender ":" (the name-loading race
  above). They were deleted, those conversations were reset, and the
  fixed code re-read them correctly. No alerts were ever sent from them.

## Depop: listings only, signed out (2026-10-05)

- **Depop blocks automated sign-in.** The user tried the "Log in" window
  for their Depop account and Depop answered **403 "not authorized"**.
  - Same moment, same IP: a fresh headless browser and a plain request
    both got 200 on `/login/`. So it's the automation-controlled window
    being refused, not an IP block.
  - Getting past that would mean evading Depop's bot protection. **Don't
    build that** (no stealth flags or patched browsers).
  - `depop-live` was taken back out of `LOGIN_START_URLS`, so no Log in
    button shows for Depop.
- **Depop connector (signed out).** It reads the public shop page only;
  capabilities `["listings"]`. Each check uses a fresh, short-lived
  headless browser: one shop-page load, then at most 5 product-title
  lookups, 2.5 s apart, then it closes.
  - Why: Depop 403s one browser that loads several pages back to back,
    while fresh browsers got 200 (seen live).
  - A 403 is reported and retried at the next check.
  - Scan cached 60 s; `authenticated` is always true (no login needed).
  - Verified standalone against public `depop.com/vintage/`: 42 listings.
- **The user's Depop account:** `dsgnr_ex` "Reselling"
  (`cmuvm9dgt006bed7chlyhlcpw`).
  - Watchdog started 2026-10-05: RUNNING, every **2 min** (the user
    asked to match Facebook), stale after 8 min.
  - First sync found 1 active listing ("red cardholder with pearl",
    $37.45), and its inventory item was auto-created.
  - Its title is still slug-derived; the lookup didn't get a title on the
    first pass, so watch whether later checks fill it in.
  - A leftover browser profile from the failed login attempt sits in
    `.browser-profiles/cmuvm9dgt…/` (gitignored, unused now).
- **Depop native conversations via an MCC browser: not possible
  (2026-10-05).** First investigation: no signed-in session (the earlier
  login window got 403). Then a controlled experiment: a fresh, dedicated,
  visible MCC profile (`depop-<accountId>`), with Playwright's own browser
  identity and the shop watcher paused. Depop answered **403 on the home
  page**, before the user could sign in. That prototype was removed, along
  with its profile and saved status. Don't retry it or work around it.
- **Depop messages via the user's own Chrome: "MCC Depop Reader"
  extension (`extension/depop-reader/`, MV3, no build), stage 1 of 2.**
  - **How it works:** the user keeps `depop.com/messages` open in their
    own Chrome. The content script only reads what that page renders: it
    never navigates, clicks, scrolls, reloads or types, and never reads
    cookies. On DOM changes (3 s settle, 10 s minimum gap) it sends a
    generic structure snapshot: conversation links (path, text lines,
    labels, class hints), `<time>` elements, data-testid counts, and the
    open thread's text blocks with left/right position. It also checks in
    every 60 s.
  - **Settings:** the background worker posts to
    `POST /api/extension/depop/report`, using the `x-api-key` and MCC
    account entered on the options page (which lists the depop-live
    accounts). One Chrome profile maps to one Depop shop; a second shop
    means a second Chrome profile with its own extension settings.
  - **Server** (`routes/extension.ts` + `services/depopExtensionSync.ts`):
    - Check-ins and page updates go through one per-shop queue, into
      AppSetting `depopExtension:<id>`: lastSeen, baselineAt,
      unreadOffers.
    - Accounts shows "● Chrome extension: Depop messages tab open".
  - **Conversation list → Inbox + alerts (stage 2, built 2026-10-05).**
    - Parser: `packages/connectors/src/extension/depopMessagesPage.ts`,
      verified on the real page, 9 node:test tests.
    - Row lines: [Unread] [initials] username, preview, "Today" or
      dd/mm/yyyy, "Conversation Menu". The conversation id is the 64-hex
      id in `/messages/<id>/`, also used for "Open in Depop".
    - Direction: unread → INBOUND; the verified "Depop" account → SYSTEM;
      otherwise UNKNOWN (the list never says who sent the latest message).
    - Synthetic message id: `depop-preview:<conv>:<day>:<sha1>`. The same
      text on the same day is stored once.
    - "Today" previews are dated when first seen; dated ones at noon.
    - Alerts: MESSAGE_RECEIVED (new unread buyer preview);
      PLATFORM_NOTIFICATION (new Depop notice); OFFER_RECEIVED with a
      summary (when the Offers tab flips to "unread offers").
    - The first list ever seen for a shop is the baseline: stored, never
      alerted.
    - An empty or unrecognised page is ignored, never read as "everything
      gone".
    - **Offline alert:** every 2 min, a shop whose tab hasn't checked in
      for 10 min gets one WATCHDOG_ERROR (health channel) per outage.
      After reloading the extension, the already-open tab goes silent
      until it's reloaded too.
  - **Open conversations → full messages (extension 0.3.1+, server
    parser, 2026-10-05).**
    - Extension capture: off the list page, every visible own-text block
      with its box and bubble background, plus all links and image alts.
      It skips header/nav and the INNERMOST scrollable area holding
      conversation links (an outer wrapper also scrolls).
    - Layout, verified on the real page:
      - a full-width day line, "Today 2:48 PM", bounds the pane;
      - the other person's bubbles are grey rgb(243,243,243) on the
        left, yours blue rgb(41,96,175) on the right;
      - a time label ("2:46 PM") sits below its bubble;
      - Depop's safety banner has a white background (not a bubble);
      - an "About the user" side panel holds the profile link
        `/<user>/` and a "View item" link `/products/<slug>/`.
    - Direction comes from the left/right gap inside the pane; when
      that's ambiguous, coloured means you.
    - `parseConversationView` returns null (never guesses) without a day
      line.
    - `ingestView` stores the messages with ids
      `depop:<conv>:<minute>:<dir>:<sha1>[#n]` and ms offsets for
      same-minute order. It converts matching `depop-preview:` rows in
      place, in one transaction. It sets `listingId` when the item slug
      is one of this shop's MCC listings.
    - **Never alerts:** the user is reading it. List ingest skips a
      preview whose text already matches one of the conversation's last
      5 messages.
    - Verified by replaying the real snapshot: 2 messages correct (You /
      @pertythingsandbling, 2:46 / 2:48 PM), preview converted, no events.
    - The extension only sees a conversation when the user opens it; it
      never opens one.
  - **Offers tab → MCC Offers + alerts (extension 0.4.0, the user asked
    for it, 2026-10-05).**
    - **Extension:** from the list, when idle for 60 s, it clicks the
      "Offers" tab when it reads "unread offers" (at most every 2 min)
      and otherwise every N min (default 15, 5–120). It sends that page
      straight away (bypassing the update gap) and clicks "Chat" to go
      back, unless the user touched the page meanwhile.
    - Tab links are found by href plus label, because other links also
      point at `/messages/`.
    - **Verified live:** the first check read the tab at 23:31:05Z and
      was back on Chat by 23:31:16Z.
    - Viewing the tab does NOT clear Depop's "unread offers" marker
      (seen live). So since 0.4.1 the marker only brings a visit forward
      once each time it appears (`unreadOffersSince`); otherwise the
      interval applies. 0.4.0 would have revisited every 2 min.
    - **Parser** (`parseOffersPage`, verified on the real tab, 11
      cards). A card starts at each status h3 ("It's a deal", "Offer
      sent", "Special offer from seller", "Offer expired", "Item sold").
      Then a deadline ("Buy before…/Expires…"), the struck-through
      original price, and "Your/Seller's/Buyer's offer: US$X". The item is
      the `/products/<slug>/` link at the card's y (±40). "Past offers"
      splits the sections.
    - Cards never name the other person.
    - `titleFromSlug` drops the username prefix and hash suffix.
    - **Schema** (migration `20261005231639_offer_details`):
      `Offer.listingId` is now optional. Added `role` (SELLING/BUYING),
      `offeredBy`, `itemTitle`, `itemUrl`, `originalPrice`,
      `statusLabel`, `deadlineLabel`. Status gains SENT and ITEM_SOLD.
    - **Ingest** (`ingestOffers`): an offer is keyed by
      `depop-offer:<slug>:<offeredBy>:<amount>`, so status changes
      update one row.
    - Role is SELLING when the slug is one of this shop's MCC listings
      or the card says "Buyer's offer", else BUYING.
    - "Item sold" cards close the known active offers on that slug.
    - The first Offers tab per shop is the baseline (`offersBaselineAt`).
      After that, one alert per offer per status:
      - PENDING → OFFER_RECEIVED ("Seller's special offer: US$53.20
        (was US$68.95) on <title> — buy before…");
      - ACCEPTED → OFFER_ACCEPTED ("It's a deal — …");
      - EXPIRED/ITEM_SOLD after being seen active → OFFER_EXPIRED;
      - DECLINED → OFFER_DECLINED;
      - an unknown label → PLATFORM_NOTIFICATION.
      Every summary ends with the item URL. SENT never alerts.
    - With `offersCheck` on, the list's vague "unread offers" alert is
      off.
    - **UI:** a new **Offers** page (`/offers`, `GET /api/offers?role=`)
      with All / On my listings / I'm buying tabs.
    - Verified: replaying the real tab stored 9 offers with 0 events.
    - **Overlap:** Depop emails also alert buying-side counter offers
      and acceptances, so the same offer can alert twice (no shared id
      to dedupe on).
    - **Selling side** ("Buyer's offer") is handled by wording but
      hasn't been seen live yet.
  - Snapshots of non-list pages still go to `.inspect/depop-ext/`
    (gitignored, last 40) for diagnosing layout changes.
  - **Verified:** opening a conversation marks it read on Depop. Loading
    the messages page doesn't open anything by itself.
  - **Auto-refresh (extension 0.2.x, the user chose it explicitly,
    2026-10-05).**
    - The page has its own "Refresh" control and may not update live.
    - With auto-refresh on (settings page; default on, every 3 min,
      2–30), the content script clicks that control.
    - Only on the list (`/messages/`), only after 60 s without a trusted
      pointer/key/wheel event, and nothing else is ever clicked.
    - The control is matched by its label, "Refresh", on a button, link
      or role=button (Depop draws header actions as styled links). If
      it's not found, `refreshProblem` describes what was there and
      shows on Accounts.
    - The last refresh time persists in chrome.storage, so reloads never
      shorten the interval.
    - Verified live: first click at 22:52Z, no problem reported.
  - **Reconnecting after updates:** the background worker re-injects
    content.js into open depop.com tabs on install/update (`scripting`
    plus a depop.com host permission). A cut-off old copy detects
    `chrome.runtime.id` is gone and shuts itself down, and the
    `window.__mccDepopReader` guard prevents two live copies.
  - **Still untested:** a new message arriving end to end (refresh, then
    snapshot, alert and Inbox).
- **Depop messages/offers/sales via email: plumbing built, parser
  pending (2026-10-05).** The user asked for it.
  - **Settings → "Email (Depop alerts)":** email + Gmail App Password +
    IMAP host. `PUT /api/settings/email` verifies the login against the
    server before saving. The password is AES-256-GCM encrypted in
    `AppSetting` (key `emailAccount`; key derived from `LOCAL_API_KEY`,
    see `services/secrets.ts`) and is never returned. Wrong login →
    "use an App Password" message (verified with a fake account).
  - **Reading:** `packages/connectors/src/email/emailSource.ts` opens
    Gmail "All Mail" (or INBOX) **read-only**, takes only `from:
    depop.com`, last 14 days, max 200.
  - **Wiring:** with email connected, the Depop connector's capabilities
    become listings + messages + offers + orders + sales.
    `connectorManager` passes the email config (`EMAIL_PLATFORM_IDS`);
    saving/removing email drops the Depop connectors so they rebuild.
  - **Alerts in `syncService`:** new offer → `OFFER_RECEIVED`; sale →
    `LISTING_SOLD`, sharing the dedupe key `sold:<slug>` with the
    shop-page transition. `historical` items (dated before
    `connectedAt`) are stored but never alerted.
  - **Parser built 2026-10-05** from the user's real mailbox (connected
    the same day; Gmail; `connectedAt` 2026-10-05T19:18Z).
    - **Mailbox contents:** 90 days held 19 depop.com emails, all
      **buyer-side** (the user buying) or marketing. **Zero seller-side
      emails** (message received / offer on your item / item sold).
    - **Format:** Depop's content is only in the HTML part; links are
      tracking redirects with no product ids, so email events can't be
      tied to a listing.
    - **Verified rules** (`*@alerts.depop.com` only; `ohhey.depop.com`
      marketing is ignored):
      - "has sent you a counter offer" → `OFFER_RECEIVED`
      - "counter offer from @x" reminder → `PLATFORM_NOTIFICATION`
      - "has accepted your offer" → `OFFER_ACCEPTED`
      - "Your Depop order is confirmed" → `ORDER_CREATED` (item + total
        only; **the shipping address is deliberately not taken**)
      - "Your order from @x has been shipped" → `SHIPMENT_UPDATED`

      All labeled "(you're buying)", with a plain `summary` used by
      Activity + Discord.
    - **Unverified:** a subject containing "message" + @user goes to the
      Inbox as conversation `email:<user>`. Any other alerts.depop.com
      email → `PLATFORM_NOTIFICATION` (new event type, new Discord
      category "Other notifications", on by default), so seller-side
      emails still alert even before they have a dedicated rule.
    - **Offline test** against all 19 real emails: 11 classified
      correctly, no address in the output. With the real `connectedAt`,
      0 of them alert (all historical). The temporary email dump was
      deleted.
    - **Live:** Depop sync with email → ok, 0 new events, watchdog
      RUNNING. Discord turned on for `OFFER_ACCEPTED`, `ORDER_CREATED`,
      and `SHIPMENT_UPDATED` (the user asked for offers + purchases).
    - **Next:** when the first seller-side Depop email arrives (it'll
      show as a 📬 notification), write a dedicated rule for it from the
      real email.
- **Sales from sold listings (both platforms):** a listing seen changing
  to SOLD now also creates an Order (`listing-sold:<ext>`, buyer
  "Unknown") + Sale at the listing price, with cost from its inventory
  item and fees 0 (editable on Sales). `soldAt` = when the watchdog saw
  it. **Verified live 2026-10-05:** the user marked their Depop wallet
  ($37.45) sold. On the next sync: listing SOLD, inventory SOLD, 1 Sale,
  Dashboard today/week/month revenue $37.45 and 1 item sold,
  `LISTING_SOLD` sent to Discord. Already-sold listings at first sight (e.g. FB ROLLING LOUD) get no
  Sale, because the sold date is unknown.
- **Multiple accounts per platform (2026-10-05).** The user may run
  several Depop shops, mailboxes, and Facebook accounts.
  - **Facebook:** already per-account (own browser profile, login,
    watchdog, connector; account label on every alert).
  - **Email is now per account, not global.** Each Depop account
    connects its own mailbox on the **Accounts page** (the Settings card
    was removed).
    - Routes: `GET/PUT/DELETE /api/accounts/:id/email`.
    - Storage: AppSetting key `emailAccount:<accountId>`. The old global
      `emailAccount` row was moved onto "Reselling".
  - **Shared inbox** (e.g. Gmail +aliases): each account sets "Depop
    sign-up email" (`matchTo`) and only reads mail addressed to it.
    - The server refuses a second account on the same inbox unless
      every account sharing it has a distinct `matchTo`.
    - Verified with a temporary account: 409 without `matchTo`, and
      another 409 while "Reselling" has none.
  - **Removing an account** now also deletes its email connection and
    its browser profile (login cookies). Verified: the temporary
    account's profile folder and settings were gone after delete.
- **Inbox tabs:** `/api/inbox/summary` now returns every platform, even
  with 0 unread. The Inbox rail shows ALL / DEPOP / FACEBOOK ("(Live)"
  stripped from the label). Verified: clicking each tab filters
  correctly.

## Open items / known limits

1. **Not yet seen live: a brand-new message or a fresh takedown.** Only
   the baseline was observed. The code paths exist, but nothing has come
   in yet to trigger them. Watch the Activity page / Discord for the
   first real `MESSAGE_RECEIVED`.
2. **Sales/revenue from Facebook aren't tracked.** Facebook doesn't expose
   sale price or fees for Marketplace local sales, so the sold ROLLING
   LOUD listing shows as SOLD but adds $0 revenue. That would need manual
   entry, or a decision from the user.
3. **Activity feed rows don't show the listing title** (just "listing
   removed"). Discord embeds do show title, price, reason, and link.
   Small UI improvement if wanted.
4. Inbox reads the first ~2 pages of seller threads (~20 most recent).
   New activity always bubbles to the top, so that's enough for alerts.

## What's next

Nothing queued. Pick up wherever the user directs; item 1 will confirm
itself the next time a buyer messages.
