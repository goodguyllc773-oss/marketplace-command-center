# Working in this repo

Before doing anything else, read, in this order:

1. **HANDOFF.md**: current state, last verified commit, what's confirmed
   working, what's pending or deferred, what's next. This file changes
   every session. Check it first, always.
2. **README.md**: setup commands.
3. **PROJECT_PLAN.md**: architecture, the phased spec, and per-phase notes
   on what was built and how it was verified.

## Two machines: Windows PC + MacBook

The code lives on GitHub (**private** repo
`goodguyllc773-oss/marketplace-command-center`) and is worked on from both
machines:

1. `git pull` before starting work, on whichever machine.
2. Commit, then `git push` when done (only when the user asks to commit).
3. **Run MCC (the watchdogs) on only ONE machine at a time.** Two running
   at once would send every Discord alert twice and double the page loads
   on Depop, which 403s busy clients. Before starting the dev servers,
   ask the user if MCC is running on the other machine.

Git carries only the code. **Per machine, never in git:** `apps/server/.env`,
`apps/web/.env`, the SQLite database (accounts, messages, offers, Discord
webhooks and connected emails all live in it), `.browser-profiles/`
(Facebook logins), and `extension/depop-reader/config.local.js`. A new
machine starts empty:

- `npm install`, then `npm run setup` (`scripts/setup-local.mjs`). It
  creates the `.env` files with a fresh `LOCAL_API_KEY` and the
  extension's `config.local.js`, migrates the database, and installs
  Playwright's Chromium. It never overwrites an existing file.
- Then, in the app: re-add the accounts, log into Facebook again (its
  login window), reconnect Depop emails (App Passwords), re-enter the
  Discord webhooks (Settings), and load the Depop Reader extension in
  that machine's Chrome.

## Getting up and running

When the user says "let's get up and running" / "let's get to work" /
"start the dev servers", start them yourself. Don't hand the user a
command. Launch them **outside Claude's tool sandbox**.

**Windows:**

    explorer.exe "C:\Users\xalex\marketplace-command-center\start-dev.cmd"

**macOS:** `open <repo>/start-dev.command` (opens a Terminal window; it's
executable in git).

Either one runs `npm run dev` in a normal window in the user's session
(API on 127.0.0.1:4000, web on 127.0.0.1:5173). Then verify both ports
respond.

Don't start them with a plain background Bash/PowerShell `npm run dev`.
Processes started that way run inside the sandbox, which can't open a
visible window (the Facebook "Log in" flow fails) and, on Windows, sees a
private copy of `AppData` (see the next section).

## Sandbox gotcha (Windows): AppData is not shared

Claude's tool sandbox has its own private view of `C:\Users\xalex\AppData`.
Anything installed there from a tool call (e.g. `npx playwright install
chromium`, which goes to `AppData\Local\ms-playwright`) is invisible to the
user's real session, and vice versa. Run per-machine installs that land in
AppData through `explorer.exe <script>.cmd` too, so they land in the real
one. The repo itself (`C:\Users\xalex\marketplace-command-center`) is
shared normally.

## Keep HANDOFF.md current

Update HANDOFF.md at BOTH of these points (they're different events):

- **Before ending a work session**: the user says they're done or closing
  out.
- **Immediately before any context compaction**: the user says "compact",
  or any other signal that one is about to happen. Whatever isn't written
  to HANDOFF.md yet doesn't survive it.

Each update should capture:

- Current commit.
- What you tested/verified and how. Be specific: account, page, what you
  actually saw.
- Anything left broken, half-done, or explicitly deferred.
- A concrete "what's next", not a vague one.

Prune stale entries as they're resolved. HANDOFF.md describes the current
state; history belongs in `git log` and PROJECT_PLAN.md. Commit it along
with everything else, then push, so the other machine gets it.

## Rules that stay in force

- Never touch, type, or store the user's real platform passwords. Real
  connectors use persistent browser sessions (cookies) only. The user logs
  in themselves in a visible window.
- Keep mock and real connectors clearly separated. Mock (sample-data)
  platforms are off unless `MCC_ENABLE_MOCKS=true` in `apps/server/.env`.
- A connector declares only the capabilities that were verified live
  (`supportedCapabilities`). Never ship guessed scrapers.
- Verify features live in the browser, not just by typechecking.
- Secrets (`.env`, webhook URLs, `.browser-profiles/`, `*.db`) are never
  committed.
- Only commit when the user asks.
