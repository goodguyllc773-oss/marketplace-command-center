// Parser tests. Inputs are the accessibility-label strings Facebook's
// conversation view actually renders (captured 2026-10-05; names changed).
// Facebook puts U+202F (narrow no-break space) before AM/PM.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionFor,
  labelsToMessages,
  messageFingerprint,
  parseMessageLabel,
} from "../dist/browser/facebookConversationParser.js";

const NNBSP = " ";
const label = (date, time, sender, body) =>
  `Enter, Message sent ${date}, ${time}${NNBSP}PM by ${sender}${body === undefined ? "" : `: ${body}`}`;

test("1. 'You' is OUTBOUND", () => {
  const [m] = labelsToMessages("t1", [label("September 28, 2026", "3:33", "You", "Yes, are you interested?")]);
  assert.equal(m.direction, "OUTBOUND");
  assert.equal(m.senderName, "You");
  assert.equal(m.body, "Yes, are you interested?");
});

test("2. the buyer is INBOUND with their name", () => {
  const [m] = labelsToMessages("t1", [label("September 26, 2026", "1:55", "Lindsey", "Good afternoon, is this still available?")]);
  assert.equal(m.direction, "INBOUND");
  assert.equal(m.senderName, "Lindsey");
});

test("3. Facebook notices are SYSTEM, never buyer messages", () => {
  for (const body of [
    "Lindsey started this chat.",
    "Jamie is waiting for your response.",
    "Beware of common scams using payment apps",
    "Chris Hernandez sent you a message about your listing: ROLLING LOUD VIP",
  ]) {
    const [m] = labelsToMessages("t1", [label("September 26, 2026", "1:55", "Lindsey", body)]);
    assert.equal(m.direction, "SYSTEM", body);
    assert.equal(m.senderName, "Facebook");
  }
  assert.equal(directionFor("Facebook", "anything"), "SYSTEM");
});

test("4. attachment-only message (no text) keeps its sender", () => {
  const [m] = labelsToMessages("t1", [label("September 27, 2026", "10:58", "Ivy", undefined)]);
  assert.equal(m.direction, "INBOUND");
  assert.equal(m.senderName, "Ivy");
  assert.equal(m.body, "(attachment)");
});

test("5. a label with an empty sender (names not loaded yet) is rejected", () => {
  assert.equal(parseMessageLabel(label("September 27, 2026", "10:58", "", "Hi, is this still available?").replace("by  :", "by :")), null);
  assert.equal(parseMessageLabel(`Enter, Message sent September 27, 2026, 10:58${NNBSP}PM by : Hi there`), null);
  assert.deepEqual(labelsToMessages("t1", [`Enter, Message sent September 27, 2026, 10:58${NNBSP}PM by : Hi there`]), []);
});

test("6. narrow / ordinary no-break spaces around the time parse the same", () => {
  const a = parseMessageLabel(`Enter, Message sent September 28, 2026, 3:33${NNBSP}PM by You: ok`);
  const b = parseMessageLabel(`Enter, Message sent September 28, 2026, 3:33 PM by You: ok`);
  const c = parseMessageLabel(`Message sent September 28, 2026, 3:33 PM by You: ok`);
  assert.ok(a && b && c);
  assert.equal(a.sentAt.getTime(), b.sentAt.getTime());
  assert.equal(a.sentAt.getTime(), c.sentAt.getTime());
  assert.equal(a.sentAt.getHours(), 15);
  assert.equal(a.sentAt.getMinutes(), 33);
});

test("7. identical messages in the same minute get distinct, deterministic ids", () => {
  const labels = [label("September 28, 2026", "3:32", "Ivy", "?"), label("September 28, 2026", "3:32", "Ivy", "?")];
  const first = labelsToMessages("t1", labels).map((m) => m.externalMessageId);
  const again = labelsToMessages("t1", labels).map((m) => m.externalMessageId);
  assert.equal(new Set(first).size, 2);
  assert.ok(first[1].endsWith("#2"));
  assert.deepEqual(first, again);
  // Synthetic id, not a Facebook id: thread + minute + direction + body hash.
  const d = new Date(2026, 8, 28, 15, 32);
  assert.equal(messageFingerprint("t1", d, "INBOUND", "?", 1), first[0]);
});

test("8. same-minute messages keep on-screen order when sorted by time", () => {
  const msgs = labelsToMessages("t1", [
    label("September 27, 2026", "10:58", "Ivy", "Ivy started this chat."),
    label("September 27, 2026", "10:58", "Ivy", "Hi, is this still available?"),
    label("September 27, 2026", "10:58", "Ivy", undefined),
  ]);
  const sorted = [...msgs].sort((x, y) => Date.parse(x.sentAt) - Date.parse(y.sentAt));
  assert.deepEqual(sorted.map((m) => m.body), ["Ivy started this chat.", "Hi, is this still available?", "(attachment)"]);
  // The id uses the minute itself, so it doesn't depend on the ms offset.
  assert.ok(msgs.every((m) => m.externalMessageId.includes(new Date(2026, 8, 27, 22, 58).toISOString())));
});

test("9. empty, unrelated, or malformed labels yield nothing (no guessing)", () => {
  for (const bad of [
    "",
    "Message actions",
    `At September 27, 2026, 10:58${NNBSP}PM, Ivy: Hi`,
    `Enter, Message sent Septober 27, 2026, 10:58${NNBSP}PM by Ivy: Hi`,
    `Enter, Message sent September 27, 2026, 25:99${NNBSP}PM by Ivy: Hi`,
    `Enter, Message sent yesterday by Ivy: Hi`,
  ]) {
    assert.equal(parseMessageLabel(bad), null, JSON.stringify(bad));
  }
});

test("10. a mixed conversation keeps order, senders, and directions", () => {
  const msgs = labelsToMessages("t1", [
    label("September 26, 2026", "1:55", "Lindsey", "Lindsey started this chat."),
    label("September 26, 2026", "1:55", "Lindsey", "Good afternoon, is this still available?"),
    label("September 26, 2026", "1:55", "Lindsey", undefined),
    label("September 26, 2026", "6:27", "You", "Yes, are you interested?"),
    label("September 26, 2026", "7:04", "Lindsey", "Yes!"),
    label("September 28, 2026", "3:33", "You", "sounds good where are you"),
  ]);
  assert.deepEqual(
    msgs.map((m) => `${m.direction}:${m.senderName}`),
    ["SYSTEM:Facebook", "INBOUND:Lindsey", "INBOUND:Lindsey", "OUTBOUND:You", "INBOUND:Lindsey", "OUTBOUND:You"],
  );
  const times = msgs.map((m) => Date.parse(m.sentAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});
