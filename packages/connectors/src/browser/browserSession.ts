import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserContext, Page } from "playwright";

/**
 * Persistent Playwright profile per account — this is the whole trust
 * boundary for real connectors that need login (spec section 4/26: "use
 * persistent browser profiles... rather than storing passwords"). The app
 * never sees, stores, or types a password: `openLoginWindow` opens a real,
 * visible browser pointed at the platform's own login page, the user types
 * their own credentials into it, and Chromium's normal cookie/session
 * storage — written to this profile directory as the user interacts, not
 * just on close — is all that persists. Every later connector call reuses
 * those cookies headlessly. Profiles live outside the repo (gitignored,
 * see PROFILE_ROOT) and outside the SQLite DB entirely.
 */

const PROFILE_ROOT = process.env.MCC_BROWSER_PROFILES_DIR ?? path.join(process.cwd(), ".browser-profiles");

function profileDir(accountId: string): string {
  const dir = path.join(PROFILE_ROOT, accountId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Heuristic only — a non-empty profile dir means a browser has been
 * launched against it at least once, which happens on window *open*, not
 * on successful login. Good enough to distinguish "never tried" from
 * "tried at some point"; never trust it for real login validity — that's
 * what `healthCheck()` actually checks, against the live site. */
export function hasSavedSession(accountId: string): boolean {
  try {
    const dir = profileDir(accountId);
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Opens a real, visible browser window on the user's own machine for them
 * to log in themselves. Returns as soon as the page starts loading — it
 * does not (and cannot) wait for the user to finish typing.
 *
 * Deliberately does NOT track "is a window still open" in memory —
 * Playwright's context `close` event doesn't reliably fire promptly when a
 * user closes a persistent-context window via Windows' own title-bar
 * controls, and a stuck-true flag from a missed event previously left the
 * UI stuck on "waiting" forever and the login button permanently disabled.
 * Chromium's own profile lock is the real source of truth: launching a
 * second window on a profile that's still open throws, which the caller
 * (the API route) surfaces as a normal error instead of silently no-oping.
 */
export async function openLoginWindow(accountId: string, startUrl: string): Promise<void> {
  // Release our own cached headless context on this profile first — two
  // Chromium processes (ours headless, the new one visible) can't hold the
  // same profile directory at once any more than two windows can.
  await closeHeadlessSession(accountId);

  const { chromium } = await import("playwright");
  const dir = profileDir(accountId);
  console.info(`[login-window] launching for ${accountId}, profile: ${path.resolve(dir)}`);
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(dir, { headless: false, viewport: null });
  } catch (err) {
    console.error(`[login-window] launch failed for ${accountId}:`, err instanceof Error ? err.message : err);
    throw err;
  }
  // Diagnostic only, not state: if this fires, it shows what was actually saved.
  context.on("close", () => {
    const entries = fs.readdirSync(dir).length;
    console.info(`[login-window] closed for ${accountId}, profile now has ${entries} entries`);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  console.info(`[login-window] opened ${startUrl} for ${accountId}, profile has ${fs.readdirSync(dir).length} entries`);
}

/** Removes an account's saved browser session (its login cookies) for
 * good — used when the account itself is removed from the app. */
export async function deleteBrowserProfile(accountId: string): Promise<void> {
  await closeHeadlessSession(accountId);
  fs.rmSync(path.join(PROFILE_ROOT, accountId), { recursive: true, force: true });
}

const headlessContexts = new Map<string, BrowserContext>();
// A profile can't be reopened until its previous browser has fully exited.
const closing = new Map<string, Promise<void>>();

/** Reuses the same saved profile headlessly for actual scraping/reads —
 * cookies only, same as any returning visitor's browser. Throws (doesn't
 * silently hang) if a visible login window is still open on the same
 * profile — callers should surface that as "close the login window and
 * try again" rather than a generic failure. */
export async function getHeadlessSession(accountId: string): Promise<{ context: BrowserContext; page: Page }> {
  await closing.get(accountId);
  let context = headlessContexts.get(accountId);
  if (!context) {
    const { chromium } = await import("playwright");
    const launched = await chromium.launchPersistentContext(profileDir(accountId), { headless: true });
    launched.on("close", () => {
      if (headlessContexts.get(accountId) === launched) headlessContexts.delete(accountId);
    });
    headlessContexts.set(accountId, launched);
    context = launched;
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

export async function closeHeadlessSession(accountId: string): Promise<void> {
  const context = headlessContexts.get(accountId);
  if (!context) return closing.get(accountId);
  headlessContexts.delete(accountId);
  const done = context
    .close()
    .catch(() => undefined)
    .finally(() => closing.delete(accountId));
  closing.set(accountId, done);
  await done;
}
