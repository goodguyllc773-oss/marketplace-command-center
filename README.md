# Marketplace Command Center

Personal, local-first command center for monitoring and managing marketplace
selling activity (messages, offers, listings, inventory, sales, revenue,
expenses, fees, profit, orders, shipping, account health) across multiple
marketplaces and multiple accounts per marketplace.

Not a SaaS product — runs on your own machine, talks to a local SQLite
database, and requires no cloud infrastructure for core functionality.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for architecture and phased build
status.

## Running locally (Windows or macOS)

Needs Node.js 20+ and git.

```bash
git clone https://github.com/goodguyllc773-oss/marketplace-command-center.git
cd marketplace-command-center
npm install
npm run setup
```

`npm run setup` prepares this machine: it creates `apps/server/.env` and
`apps/web/.env` (with a fresh local API key), the Depop Reader extension's
`config.local.js`, the database, and Playwright's Chromium. None of those
are in git, and it never overwrites one that exists.

Start it with `start-dev.cmd` (Windows), `start-dev.command` (macOS,
double-click), or `npm run dev`. That runs the API (`http://127.0.0.1:4000`)
and the dashboard (`http://127.0.0.1:5173`).

**Run it on one machine at a time.** Each machine has its own database,
accounts and logins (see CLAUDE.md, "Two machines").

### Connecting accounts (per machine, in the app)

- **Facebook (Live):** add the account, click "Log in", and sign in
  yourself in the window that opens.
- **Depop (Live):** add the account with the shop's **username**. The
  public shop page is watched with no login.
  - **Email:** connect the shop's email inbox (Gmail App Password) for
    Depop's offer, purchase and notice emails.
  - **Messages and offers:** come from the **MCC Depop Reader** Chrome
    extension. In `chrome://extensions`, turn on Developer mode, choose
    "Load unpacked", and pick `extension/depop-reader`. Then keep
    `depop.com/messages` open, signed into that shop.
  - **One Chrome profile per Depop shop:** the extension works out which
    shop is signed in by itself.
- **Discord:** add webhooks under Settings → Discord notifications.
