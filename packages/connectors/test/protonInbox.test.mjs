import { test } from "node:test";
import assert from "node:assert/strict";
import { isDepopSender, parseProtonDate, parseProtonRows, protonRowToEmail } from "../dist/extension/protonInbox.js";
import { parseDepopEmails } from "../dist/email/depopEmailParser.js";

// Row shapes as the extension sends them from the real Proton inbox
// (2026-10-24); names and subjects made up.
const row = (o) => ({ id: "abc==", sender: "account@alerts.depop.com", subject: "x", unread: false, count: 1, when: "Saturday, October 24th, 2026 at 10:03 AM", ...o });

test("Proton long dates", () => {
  const d = parseProtonDate("Saturday, October 24th, 2026 at 10:03 AM");
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 9, 24, 10, 3]);
  assert.equal(parseProtonDate("Friday, October 23rd, 2026 at 9:04 PM").getHours(), 21);
  assert.equal(parseProtonDate("Monday, September 1st, 2026 at 12:00 AM").getHours(), 0);
  assert.equal(parseProtonDate("Yesterday"), null);
  assert.equal(parseProtonDate("Friday, February 31st, 2026 at 9:04 PM"), null, "not a real date");
});

test("only Depop senders, never sign-in emails", () => {
  assert.equal(isDepopSender("account@alerts.depop.com"), true);
  assert.equal(isDepopSender("news@ohhey.depop.com"), true);
  assert.equal(isDepopSender("login@auth.depop.com"), false, "magic-link sign-in emails are never read");
  assert.equal(isDepopSender("someone@gmail.com"), false);
  assert.equal(isDepopSender("depop.com@phish.example"), false);
});

test("rows parse; anything not from Depop is dropped", () => {
  const rows = parseProtonRows({
    rows: [
      row({ id: "1", subject: "@buyer_one made you an offer", unread: true }),
      row({ id: "2", sender: "login@auth.depop.com", subject: "Log in to Depop with your magic link" }),
      row({ id: "3", sender: "friend@example.com", subject: "hi" }),
      row({ id: "4", subject: "Don’t miss this offer, @myshop", count: 37 }),
      null,
      { id: "", sender: "account@alerts.depop.com", subject: "no id" },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.id, r.unread, r.count]), [["1", true, 1], ["4", false, 37]]);
});

test("a thread's new email gets a new id (count/time change)", () => {
  const [a] = parseProtonRows({ rows: [row({ count: 2 })] });
  const [b] = parseProtonRows({ rows: [row({ count: 3, when: "Saturday, October 24th, 2026 at 11:00 AM" })] });
  assert.notEqual(protonRowToEmail(a).messageId, protonRowToEmail(b).messageId);
  assert.equal(protonRowToEmail(a).messageId, protonRowToEmail(parseProtonRows({ rows: [row({ count: 2 })] })[0]).messageId);
});

test("'made you an offer' becomes a selling-side offer alert; older rows are history", () => {
  const emails = parseProtonRows({
    rows: [
      row({ id: "new", subject: "@buyer_one made you an offer", when: "Saturday, October 24th, 2026 at 6:00 PM" }),
      row({ id: "old", subject: "@buyer_two made you an offer", when: "Friday, October 23rd, 2026 at 9:04 PM" }),
    ],
  }).map(protonRowToEmail);
  const { notices } = parseDepopEmails(emails, new Date(2026, 9, 24, 12, 0).toISOString());
  assert.equal(notices.length, 2);
  const [fresh, old] = notices;
  assert.equal(fresh.type, "OFFER_RECEIVED");
  assert.equal(fresh.historical, false);
  assert.equal(fresh.payload.role, "selling");
  assert.equal(fresh.payload.buyerName, "@buyer_one");
  assert.equal(old.historical, true, "emails from before the inbox was first seen never alert");
});
