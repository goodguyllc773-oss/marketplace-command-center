# Marketplace Command Center

Personal, local-first command center for monitoring and managing marketplace
selling activity (messages, offers, listings, inventory, sales, revenue,
expenses, fees, profit, orders, shipping, account health) across multiple
marketplaces and multiple accounts per marketplace.

Not a SaaS product — runs on your own machine, talks to a local SQLite
database, and requires no cloud infrastructure for core functionality.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for architecture and phased build
status.

## Running locally

```bash
npm install
npm run db:migrate --workspace=apps/server
npm run dev
```

This starts the API server (`apps/server`, default `http://127.0.0.1:4000`)
and the web dashboard (`apps/web`, default `http://127.0.0.1:5173`) together.

Copy `.env.example` to `.env` in `apps/server` and fill in any secrets
(Discord webhook URL, etc.) before enabling notifications — never commit
`.env`.

### Real (non-mock) connectors

The "Depop (Live)" platform reads a seller's public Depop shop page — no
login, no password. It uses a real headless Chromium via Playwright, which
needs a one-time browser download per machine:

```bash
npx playwright install chromium
```

Add an account under that platform with your Depop **username** (not
password) as the external account id. It only supports the `listings`
capability for now — messages/offers/orders need a real login session,
which wasn't built here since it needs live validation against your own
authenticated account; see PROJECT_PLAN.md.
