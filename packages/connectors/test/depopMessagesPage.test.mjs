import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateLabelToDay,
  parseConversationList,
  parseConversationView,
  parseDayLine,
  parseOffersPage,
  previewMessageId,
  titleFromSlug,
  viewMessageId,
} from "../dist/extension/depopMessagesPage.js";

// Shapes match what the extension reads from the real page (2026-10-05);
// names and text are made up.
const ID1 = "a".repeat(64);
const ID2 = "b".repeat(64);
const ID3 = "c".repeat(64);
const row = (id, lines, extra = {}) => ({ path: `/messages/${id}/`, lines, testIds: ["avatar", "buttonLink"], classHints: [], ...extra });

test("unread row with a profile photo", () => {
  const { rows } = parseConversationList({
    conversations: [row(ID1, ["Unread", "buyer_one", "Is this still available?", "Today", "Conversation Menu"])],
  });
  assert.deepEqual(rows, [
    { conversationId: ID1, username: "buyer_one", preview: "Is this still available?", dateLabel: "Today", unread: true, fromDepop: false },
  ]);
});

test("avatar initials are not mistaken for the username", () => {
  const { rows } = parseConversationList({
    conversations: [
      row(ID1, ["DH", "buyer_two", "22", "22/04/2026", "Conversation Menu"], { testIds: ["avatar", "avatar__initials", "buttonLink"] }),
    ],
  });
  assert.equal(rows[0].username, "buyer_two");
  assert.equal(rows[0].preview, "22");
  assert.equal(rows[0].unread, false);
});

test("Depop's own notices come from the verified Depop account", () => {
  const { rows } = parseConversationList({
    conversations: [
      row(ID1, ["Unread", "Depop", "We've had to remove your listing.", "15/04/2026", "Conversation Menu"], {
        classHints: ["_verifiedBadge_1yjst_93"],
      }),
      row(ID2, ["Depop", "a buyer named Depop", "15/04/2026", "Conversation Menu"]),
    ],
  });
  assert.equal(rows[0].fromDepop, true);
  assert.equal(rows[1].fromDepop, false, "no verified badge = not Depop itself");
});

test("non-conversation links and duplicates are skipped", () => {
  const { rows } = parseConversationList({
    conversations: [
      { path: `/messages/${ID1}/`, lines: ["Filter by unread"], testIds: ["buttonLink"] },
      row(ID1, ["buyer_one", "hi", "01/10/2026", "Conversation Menu"]),
      row(ID1, ["buyer_one", "hi", "01/10/2026", "Conversation Menu"]),
      { path: "/messages/not-hex/", lines: ["x", "y", "Today", "Conversation Menu"] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "buyer_one");
});

test("Offers tab unread marker", () => {
  const offers = (lines) => parseConversationList({ conversations: [{ path: "/messages/offers/", lines }] }).unreadOffers;
  assert.equal(offers(["unread offers", "Offers"]), true);
  assert.equal(offers(["Offers"]), false);
  assert.equal(parseConversationList({ conversations: [] }).unreadOffers, null);
});

test("a row with no preview text is a photo or attachment", () => {
  const { rows } = parseConversationList({ conversations: [row(ID3, ["buyer_three", "Today", "Conversation Menu"])] });
  assert.equal(rows[0].preview, "(photo or attachment)");
});

test("garbage input never throws", () => {
  for (const input of [null, undefined, {}, { conversations: "x" }, { conversations: [null, 1, {}] }]) {
    assert.deepEqual(parseConversationList(input).rows, []);
  }
});

test("date labels resolve to a calendar day", () => {
  const now = new Date(2026, 9, 5, 15, 0); // 5 Oct 2026, local
  assert.equal(dateLabelToDay("Today", now), "2026-10-05");
  assert.equal(dateLabelToDay("Yesterday", now), "2026-10-04");
  assert.equal(dateLabelToDay("22/04/2026", now), "2026-04-22", "Depop shows dd/mm/yyyy");
  assert.equal(dateLabelToDay("01/10/2026", now), "2026-10-01");
  assert.equal(dateLabelToDay("31/02/2026", now), null, "not a real date");
  assert.equal(dateLabelToDay("last week", now), null);
});

test("preview ids are deterministic and change with text or day", () => {
  const a = previewMessageId(ID1, "hello", "2026-10-05");
  assert.equal(a, previewMessageId(ID1, "hello", "2026-10-05"));
  assert.notEqual(a, previewMessageId(ID1, "hello!", "2026-10-05"));
  assert.notEqual(a, previewMessageId(ID1, "hello", "2026-10-06"));
  assert.match(a, /^depop-preview:a{64}:2026-10-05:[0-9a-f]{16}$/);
});

// ---- open conversation (layout as on the real page; text made up) ----------
const NOW = new Date(2026, 9, 5, 16, 0);
const PATH = `/messages/${ID1}/`;
const WHITE = "rgb(255, 255, 255)";
const GREY = "rgb(243, 243, 243)";
const BLUE = "rgb(41, 96, 175)";
const viewSnapshot = (blocks, links = []) => ({ blocks, links });
const header = [
  { text: "Messages", tag: "h1", x: 32, y: 81, w: 140, bg: WHITE },
  { text: "Refresh", tag: "p", x: 220, y: 83, w: 68, bg: WHITE },
];
const sidePanel = [
  { text: "seller_x", tag: "p", x: 1565, y: 273, w: 188, bg: WHITE },
  { text: "To report or block this user, head to their profile", tag: "p", x: 1429, y: 936, w: 460, bg: GREY },
];
const dayLine = (text, y) => ({ text, tag: "p", x: 416, y, w: 980, bg: WHITE });
const theirs = (text, y) => ({ text, tag: "p", x: 432, y, w: 365, bg: GREY });
const mine = (text, y) => ({ text, tag: "p", x: 896, y, w: 484, bg: BLUE });
const timeL = (text, y) => ({ text, tag: "p", x: 416, y, w: 397, bg: WHITE });
const timeR = (text, y) => ({ text, tag: "p", x: 880, y, w: 516, bg: WHITE });

test("open conversation: sides, times, banner, side panel", () => {
  const v = parseConversationView(
    viewSnapshot(
      [
        ...header,
        dayLine("Today 2:46 PM", 201),
        { text: "Keep it on Depop. Never share personal info", tag: "p", x: 539, y: 270, w: 735, bg: WHITE },
        mine("Hey, can you ship soon?", 340),
        timeR("2:46 PM", 380),
        theirs("Ships tomorrow. Thanks", 429),
        timeL("2:48 PM", 469),
        ...sidePanel,
      ],
      [
        { path: "/seller_x/", lines: ["seller_x"] },
        { path: "/products/seller_x-blue-jersey-fcdf/", lines: ["View item"] },
      ],
    ),
    PATH,
    NOW,
  );
  assert.equal(v.conversationId, ID1);
  assert.equal(v.otherUser, "seller_x");
  assert.equal(v.itemSlug, "seller_x-blue-jersey-fcdf");
  assert.deepEqual(
    v.messages.map((m) => [m.direction, m.body, m.sentAt && m.sentAt.getHours() * 60 + m.sentAt.getMinutes()]),
    [
      ["OUTBOUND", "Hey, can you ship soon?", 14 * 60 + 46],
      ["INBOUND", "Ships tomorrow. Thanks", 14 * 60 + 48],
    ],
  );
});

test("open conversation: day lines set each message's day", () => {
  const v = parseConversationView(
    viewSnapshot([
      dayLine("Yesterday 9:00 AM", 200),
      theirs("Is this available?", 250),
      timeL("9:00 AM", 290),
      dayLine("Today 1:05 PM", 330),
      mine("Yes it is", 380),
      timeR("1:05 PM", 420),
    ]),
    PATH,
    NOW,
  );
  assert.equal(v.messages[0].sentAt.getDate(), 4);
  assert.equal(v.messages[1].sentAt.getDate(), 5);
  assert.equal(v.messages[1].sentAt.getHours(), 13);
});

test("open conversation: nothing recognisable gives null, not a guess", () => {
  assert.equal(parseConversationView(viewSnapshot([theirs("hi", 250)]), PATH, NOW), null, "no day line = unknown layout");
  assert.equal(parseConversationView(viewSnapshot([]), "/messages/", NOW), null);
  assert.equal(parseConversationView(null, PATH, NOW), null);
});

test("day lines", () => {
  assert.equal(parseDayLine("Today 2:48 PM", NOW).day.getDate(), 5);
  assert.equal(parseDayLine("Monday 9:00 AM", NOW).day.getDate(), 28, "5 Oct 2026 is a Monday — 'Monday' means a week ago");
  assert.equal(parseDayLine("3 October 2:00 PM", NOW).day.getMonth(), 9);
  assert.equal(parseDayLine("20 December 2:00 PM", NOW).day.getFullYear(), 2025, "no year + future date = last year");
  assert.equal(parseDayLine("Ships tomorrow. Thanks", NOW), null);
});

test("view message ids: deterministic, #n for same-minute repeats", () => {
  const at = new Date(2026, 9, 5, 14, 46);
  const a = viewMessageId(ID1, at, "INBOUND", "ok", 1);
  assert.equal(a, viewMessageId(ID1, at, "INBOUND", "ok", 1));
  assert.equal(viewMessageId(ID1, at, "INBOUND", "ok", 2), `${a}#2`);
  assert.notEqual(a, viewMessageId(ID1, at, "OUTBOUND", "ok", 1));
});

// ---- Offers tab (layout as on the real page; items made up) -----------------
const card = (y, status, deadline, was, offerLine) => [
  { text: status, tag: "h3", x: 601, y },
  ...(deadline ? [{ text: deadline, tag: "p", x: 601, y: y + 23 }] : []),
  ...(was ? [{ text: was, tag: "p", x: 601, y: y + 76 }] : []),
  ...(offerLine ? [{ text: offerLine, tag: "h3", x: 601, y: y + 97 }] : []),
  { text: "Buy", tag: "span", x: 1283, y: y + 87 },
];
const offersSnapshot = {
  blocks: [
    { text: "Active offers", tag: "h3", x: 441, y: 209 },
    ...card(268, "It’s a deal", "Buy before 6 October at 3pm", "US$63.70", "Your offer: US$43.02"),
    ...card(444, "Special offer from seller", "Buy before 5 October at 6pm", "US$68.95", "Seller’s offer: US$53.20"),
    { text: "Past offers", tag: "h3", x: 441, y: 640 },
    ...card(700, "Offer expired", "Expires 2 October at 4pm", "US$55.30", "Your offer: US$42.70"),
    ...card(876, "Item sold"),
  ],
  links: [
    { path: "/products/seller1-blue-team-jersey-4cb8/", y: 268 },
    { path: "/products/seller2-red-hoodie-1487/", y: 444 },
    { path: "/products/seller3-navy-cap-3451/", y: 700 },
    { path: "/products/seller4-white-tee-6957/", y: 876 },
  ],
};

test("offers tab: every card with its item, amount, sides and section", () => {
  const cards = parseOffersPage(offersSnapshot);
  assert.deepEqual(
    cards.map((c) => [c.section, c.statusLabel, c.amount, c.offeredBy, c.originalPrice, c.itemSlug]),
    [
      ["ACTIVE", "It’s a deal", 43.02, "YOU", 63.7, "seller1-blue-team-jersey-4cb8"],
      ["ACTIVE", "Special offer from seller", 53.2, "SELLER", 68.95, "seller2-red-hoodie-1487"],
      ["PAST", "Offer expired", 42.7, "YOU", 55.3, "seller3-navy-cap-3451"],
      ["PAST", "Item sold", null, null, null, "seller4-white-tee-6957"],
    ],
  );
  assert.equal(cards[0].deadlineLabel, "Buy before 6 October at 3pm");
  assert.equal(cards[0].currency, "USD");
});

test("offers tab: garbage gives no cards", () => {
  for (const input of [null, {}, { blocks: "x" }, { blocks: [null, 1] }]) assert.deepEqual(parseOffersPage(input), []);
});

test("item titles from Depop slugs", () => {
  assert.equal(titleFromSlug("seller1-blue-team-jersey-4cb8"), "Blue team jersey");
  assert.equal(titleFromSlug("single"), "Single");
});
