import { createHash } from "node:crypto";

/**
 * Parses what the "MCC Depop Reader" Chrome extension reads from the
 * depop.com/messages page the user keeps open in their own Chrome.
 *
 * Layout VERIFIED against the user's real page (2026-10-05). Each
 * conversation is a link to `/messages/<64-hex id>/` whose visible lines are:
 *
 *   ["Unread"]            screen-reader-only marker, unread conversations only
 *   ["R" / "DH"]          avatar initials, when the user has no photo
 *   username
 *   preview…              latest message (who sent it is NOT shown)
 *   "Today" | "dd/mm/yyyy"
 *   "Conversation Menu"   screen-reader label of the ⋯ button
 *
 * Depop's own notices come from a verified "Depop" account. The Offers
 * tab is a link to `/messages/offers/` reading "unread offers" when there
 * are any.
 */

export interface DepopListRow {
  /** Depop's conversation id (the hex in the conversation's URL). */
  conversationId: string;
  username: string;
  preview: string;
  /** "Today", "Yesterday", or "dd/mm/yyyy" as shown. */
  dateLabel: string;
  unread: boolean;
  /** Sent by Depop itself (verified "Depop" account), not a buyer. */
  fromDepop: boolean;
}

export interface DepopListPage {
  rows: DepopListRow[];
  /** The Offers tab's unread marker; null when the tab wasn't on the page. */
  unreadOffers: boolean | null;
}

interface RawLink {
  path?: unknown;
  lines?: unknown;
  testIds?: unknown;
  classHints?: unknown;
}

const CONVERSATION_PATH = /^\/messages\/([0-9a-f]{32,})\/?$/;
const MENU_LABEL = /^conversation menu$/i;
const DATE_LABEL = /^(today|yesterday|\d{2}\/\d{2}\/\d{4})$/i;
const INITIALS = /^[A-Z0-9]{1,3}$/;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export function parseConversationList(snapshot: unknown): DepopListPage {
  const links = (snapshot as { conversations?: unknown })?.conversations;
  const rows: DepopListRow[] = [];
  const seen = new Set<string>();
  let unreadOffers: boolean | null = null;

  for (const link of Array.isArray(links) ? (links as RawLink[]) : []) {
    if (!link || typeof link !== "object") continue;
    const path = typeof link.path === "string" ? link.path : "";
    const lines = strings(link.lines).map((s) => s.trim()).filter(Boolean);

    if (/^\/messages\/offers\/?$/.test(path)) {
      unreadOffers = lines.some((l) => /unread offers/i.test(l));
      continue;
    }
    const id = path.match(CONVERSATION_PATH)?.[1];
    // Real conversation rows end with the ⋯ menu label; anything else
    // linking to a conversation (e.g. "Filter by unread") is skipped.
    if (!id || seen.has(id) || !MENU_LABEL.test(lines.at(-1) ?? "")) continue;

    const ls = lines.slice(0, -1);
    const unread = ls[0] === "Unread";
    if (unread) ls.shift();
    if (strings(link.testIds).includes("avatar__initials") && INITIALS.test(ls[0] ?? "")) ls.shift();
    const dateLabel = DATE_LABEL.test(ls.at(-1) ?? "") ? ls.pop()! : "";
    const username = ls.shift();
    if (!username) continue;

    seen.add(id);
    rows.push({
      conversationId: id,
      username,
      preview: ls.join(" ").replace(/\s+/g, " ").trim() || "(photo or attachment)",
      dateLabel,
      unread,
      fromDepop: username === "Depop" && strings(link.classHints).some((c) => /verifiedBadge/i.test(c)),
    });
  }
  return { rows, unreadOffers };
}

/**
 * The calendar day a list date label refers to, as local "YYYY-MM-DD".
 * "Today"/"Yesterday" resolve against `now`. Depop shows dd/mm/yyyy
 * (verified: "22/04/2026"). Returns null for anything unrecognised.
 */
export function dateLabelToDay(label: string, now: Date): string | null {
  const day = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (/^today$/i.test(label)) return day(now);
  if (/^yesterday$/i.test(label)) return day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const m = label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 && date.getDate() === d ? day(date) : null;
}

// ---- open conversation ---------------------------------------------------

/**
 * An open conversation, VERIFIED against the real page (2026-10-05). The
 * page shows the list, the conversation pane and an "About the user" side
 * panel side by side. In the pane:
 *
 *   - a day line spanning the pane: "Today 2:48 PM"
 *   - each message is a bubble: the other person's GREY on the LEFT, yours
 *     BLUE on the RIGHT, with its time ("2:46 PM") just below
 *   - Depop's safety banner ("Keep it on Depop…") has no bubble
 *
 * The side panel holds the item (a "View item" link to /products/<slug>/).
 */

export interface DepopViewMessage {
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  /** Local day + time; null when the day or time couldn't be read. */
  sentAt: Date | null;
}

export interface DepopConversationView {
  conversationId: string;
  /** The other person's username, from their profile link in the panel. */
  otherUser: string | null;
  itemSlug: string | null;
  messages: DepopViewMessage[];
}

interface RawBlock {
  text?: unknown;
  tag?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  bg?: unknown;
}

interface Block {
  text: string;
  tag: string;
  x: number;
  y: number;
  w: number;
  bg: string | null;
}

const TIME = /^(\d{1,2}):(\d{2})\s?([AP]M)$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "Today", "Yesterday", "Monday", "5 October", "5 October 2025",
 * "October 5", "dd/mm/yyyy" — each optionally followed by a time. */
export function parseDayLine(text: string, now: Date): { day: Date; time: string | null } | null {
  const m = text.trim().match(/^(.+?)(?:,?\s+(\d{1,2}:\d{2}\s?[AP]M))?$/i);
  if (!m) return null;
  const label = m[1].trim().toLowerCase();
  const time = m[2] ?? null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

  if (label === "today") return { day: today, time };
  if (label === "yesterday") return { day: daysAgo(1), time };
  const wd = WEEKDAYS.indexOf(label);
  if (wd >= 0) return { day: daysAgo((today.getDay() - wd + 7) % 7 || 7), time };

  const dmy = label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const dMonth = label.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/);
  const monthD = label.match(/^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/);
  let y: number, mo: number, d: number;
  if (dmy) [d, mo, y] = [Number(dmy[1]), Number(dmy[2]) - 1, Number(dmy[3])];
  else if (dMonth && MONTHS.includes(dMonth[2])) [d, mo, y] = [Number(dMonth[1]), MONTHS.indexOf(dMonth[2]), Number(dMonth[3] ?? NaN)];
  else if (monthD && MONTHS.includes(monthD[1])) [d, mo, y] = [Number(monthD[2]), MONTHS.indexOf(monthD[1]), Number(monthD[3] ?? NaN)];
  else return null;
  // No year shown = the most recent such date not in the future.
  if (Number.isNaN(y)) y = new Date(now.getFullYear(), mo, d) > now ? now.getFullYear() - 1 : now.getFullYear();
  const day = new Date(y, mo, d);
  return day.getMonth() === mo && day.getDate() === d ? { day, time } : null;
}

function atTime(day: Date, time: string): Date | null {
  const t = time.match(TIME);
  if (!t) return null;
  const h = Number(t[1]);
  const min = Number(t[2]);
  if (h < 1 || h > 12 || min > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), (h % 12) + (/pm/i.test(t[3]) ? 12 : 0), min);
}

/** White or transparent = no bubble. */
function isBubble(bg: string | null): boolean {
  const c = bg?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!c || (c[4] !== undefined && Number(c[4]) === 0)) return false;
  return !(Number(c[1]) >= 250 && Number(c[2]) >= 250 && Number(c[3]) >= 250);
}

/** Grey (r≈g≈b) bubbles are the other person's; coloured ones are yours. */
function isColoured(bg: string | null): boolean {
  const c = bg?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!c) return false;
  const [r, g, b] = [Number(c[1]), Number(c[2]), Number(c[3])];
  return Math.max(r, g, b) - Math.min(r, g, b) > 40;
}

export function parseConversationView(snapshot: unknown, pagePath: string, now: Date): DepopConversationView | null {
  const conversationId = pagePath.match(CONVERSATION_PATH)?.[1];
  const s = snapshot as { blocks?: unknown; links?: unknown } | null;
  if (!conversationId || !s || !Array.isArray(s.blocks)) return null;

  const blocks: Block[] = (s.blocks as RawBlock[])
    .filter((b) => b && typeof b === "object" && typeof b.text === "string" && typeof b.x === "number" && typeof b.y === "number")
    .map((b) => ({
      text: (b.text as string).replace(/\s+/g, " ").trim(),
      tag: typeof b.tag === "string" ? b.tag : "",
      x: b.x as number,
      y: b.y as number,
      w: typeof b.w === "number" ? b.w : 0,
      bg: typeof b.bg === "string" ? b.bg : null,
    }));

  // The pane is bounded by its widest day line (it spans the pane).
  const dayLines = blocks
    .map((b) => ({ b, parsed: parseDayLine(b.text, now) }))
    .filter((d): d is { b: Block; parsed: NonNullable<ReturnType<typeof parseDayLine>> } => d.parsed !== null && d.parsed.time !== null);
  if (dayLines.length === 0) return null;
  const widest = dayLines.reduce((a, c) => (c.b.w > a.b.w ? c : a)).b;
  const paneLeft = widest.x - 8;
  const paneRight = widest.x + widest.w + 8;
  const inPane = (b: Block) => b.x >= paneLeft && b.x + b.w <= paneRight;

  const pane = blocks.filter(inPane).sort((a, b) => a.y - b.y);
  const messages: DepopViewMessage[] = [];
  let day: Date | null = null;
  for (let i = 0; i < pane.length; i++) {
    const b = pane[i];
    const dl = parseDayLine(b.text, now);
    if (dl && dl.time !== null && b.w >= widest.w * 0.8) {
      day = dl.day;
      continue;
    }
    if (!isBubble(b.bg) || TIME.test(b.text) || !b.text) continue;
    const leftGap = b.x - widest.x;
    const rightGap = widest.x + widest.w - (b.x + b.w);
    const direction =
      Math.abs(leftGap - rightGap) > 40 ? (rightGap < leftGap ? "OUTBOUND" : "INBOUND") : isColoured(b.bg) ? "OUTBOUND" : "INBOUND";
    // Its time is the next time label below it on the same side.
    const timeBlock = pane.slice(i + 1).find((t) => TIME.test(t.text) && (direction === "OUTBOUND" ? t.x > b.x - 40 : t.x < b.x + 40));
    messages.push({ direction, body: b.text, sentAt: day && timeBlock ? atTime(day, timeBlock.text) : null });
  }

  const links = Array.isArray(s.links) ? (s.links as { path?: unknown; lines?: unknown }[]) : [];
  const itemSlug =
    links.map((l) => (typeof l.path === "string" ? l.path.match(/^\/products\/([^/]+)\/?$/)?.[1] : undefined)).find(Boolean) ?? null;
  // The profile link is a bare "/<username>/" whose text is the username.
  const otherUser =
    links
      .map((l) => (typeof l.path === "string" ? l.path.match(/^\/([\w.-]+)\/$/)?.[1] : undefined))
      .find((u) => u && u !== "messages" && u !== "products") ?? null;

  return { conversationId, otherUser, itemSlug, messages };
}

// ---- Offers tab -----------------------------------------------------------

/**
 * The Offers tab (/messages/offers/), VERIFIED against the real page
 * (2026-10-05). Under "Active offers" / "Past offers" headings, each card
 * has, top to bottom:
 *
 *   status heading   "It’s a deal" | "Offer sent" | "Special offer from seller"
 *                    | "Offer expired" | "Item sold" | …
 *   deadline         "Buy before 6 October at 3pm" | "Expires 6 October at 1pm"
 *   original price   "US$63.70" (struck through)
 *   offer            "Your offer: US$43.02" | "Seller’s offer: US$53.20"
 *   buttons          "Buy" / "Counter" / "Make new offer"
 *
 * and the item's image links to /products/<slug>/ at the card's top. The
 * cards don't name the other person. Every card seen so far was one where
 * the user is the BUYER; "Buyer’s offer" (selling) is handled by wording
 * but not yet seen.
 */

export interface DepopOfferCard {
  itemSlug: string | null;
  section: "ACTIVE" | "PAST";
  statusLabel: string;
  deadlineLabel: string | null;
  originalPrice: number | null;
  amount: number | null;
  currency: string;
  /** Whose amount it is: you as buyer ("Your offer"), the seller, or a buyer. */
  offeredBy: "YOU" | "SELLER" | "BUYER" | null;
}

const OFFER_LINE = /^(your|seller[’']s|buyer[’']s) offer:\s*([A-Z]{0,3})\$\s?([\d,]+(?:\.\d{2})?)$/i;
const MONEY = /^([A-Z]{0,3})\$\s?([\d,]+(?:\.\d{2})?)$/;
const DEADLINE = /^(buy before|expires|respond by|ends)\b/i;

export function parseOffersPage(snapshot: unknown): DepopOfferCard[] {
  const s = snapshot as { blocks?: unknown; links?: unknown } | null;
  if (!s || !Array.isArray(s.blocks)) return [];
  const blocks = (s.blocks as RawBlock[])
    .filter((b) => b && typeof b === "object" && typeof b.text === "string" && typeof b.y === "number" && typeof b.x === "number")
    .map((b) => ({ text: (b.text as string).replace(/\s+/g, " ").trim(), tag: typeof b.tag === "string" ? b.tag : "", x: b.x as number, y: b.y as number }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const productLinks = (Array.isArray(s.links) ? (s.links as { path?: unknown; y?: unknown }[]) : [])
    .map((l) => ({ slug: typeof l.path === "string" ? l.path.match(/^\/products\/([^/]+)\/?$/)?.[1] : undefined, y: typeof l.y === "number" ? l.y : NaN }))
    .filter((l): l is { slug: string; y: number } => !!l.slug && !Number.isNaN(l.y));

  const pastAt = blocks.find((b) => /^past offers$/i.test(b.text))?.y ?? Infinity;
  // A card starts at each status heading: an h3 that isn't a section title
  // or an offer line.
  const starts = blocks.filter(
    (b) => b.tag === "h3" && !/^(active|past) offers$/i.test(b.text) && !OFFER_LINE.test(b.text) && b.text.length <= 60,
  );
  return starts.map((start, i) => {
    const end = starts[i + 1]?.y ?? Infinity;
    const inCard = blocks.filter((b) => b.y > start.y && b.y < end);
    const offer = inCard.map((b) => b.text.match(OFFER_LINE)).find(Boolean);
    const original = inCard.map((b) => (b.tag !== "h3" ? b.text.match(MONEY) : null)).find(Boolean);
    const link = productLinks.reduce<{ slug: string; y: number } | null>(
      (best, l) => (Math.abs(l.y - start.y) <= 40 && (!best || Math.abs(l.y - start.y) < Math.abs(best.y - start.y)) ? l : best),
      null,
    );
    const who = offer?.[1].toLowerCase();
    return {
      itemSlug: link?.slug ?? null,
      section: start.y > pastAt ? "PAST" : "ACTIVE",
      statusLabel: start.text,
      deadlineLabel: inCard.find((b) => DEADLINE.test(b.text))?.text ?? null,
      originalPrice: original ? Number(original[2].replace(/,/g, "")) : null,
      amount: offer ? Number(offer[3].replace(/,/g, "")) : null,
      currency: ({ US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD" } as Record<string, string>)[offer?.[2] || original?.[1] || "US"] ?? "USD",
      offeredBy: who === "your" ? "YOU" : who?.startsWith("seller") ? "SELLER" : who?.startsWith("buyer") ? "BUYER" : null,
    };
  });
}

/** "ballakamara7e0-baltimore-ravens-lamar-jackson-purple-4cb8" →
 * "Baltimore ravens lamar jackson purple": Depop slugs are
 * <username>-<title words>-<short hash>. */
export function titleFromSlug(slug: string): string {
  const parts = slug.split("-");
  const words = parts.slice(1, /^[0-9a-f]{3,6}$/.test(parts.at(-1) ?? "") ? -1 : undefined);
  const title = (words.length ? words : parts).join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * SYNTHETIC id for a message read from an open conversation — Depop shows
 * no message ids. Minute + direction + text, with `#n` for identical
 * repeats in the same minute (they're interchangeable).
 */
export function viewMessageId(conversationId: string, sentAt: Date | null, direction: string, body: string, occurrence: number): string {
  const when = sentAt ? sentAt.toISOString().slice(0, 16) : "undated";
  const hash = createHash("sha1").update(body).digest("hex").slice(0, 16);
  return `depop:${conversationId}:${when}:${direction}:${hash}${occurrence > 1 ? `#${occurrence}` : ""}`;
}

/**
 * SYNTHETIC id for a list preview — Depop's page shows no message ids.
 * Same conversation + same text + same day = the same message (a buyer
 * repeating identical text the same day is stored once).
 */
export function previewMessageId(conversationId: string, preview: string, day: string): string {
  const hash = createHash("sha1").update(preview).digest("hex").slice(0, 16);
  return `depop-preview:${conversationId}:${day}:${hash}`;
}
