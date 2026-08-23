import assert from "node:assert/strict";
import test from "node:test";
import { completeGeneratedText, completeStoredText } from "../js/text.js";

/* A fortnight of watched play surfaced dialogue reaching the screen as
   "it feltwrong" and "seemedunconcerned". The model had written ordinary
   sentences; the text filter was deleting the Unicode spaces between the
   words rather than converting them, welding the words together. */

test("unicode spacing between words is preserved as an ordinary space", () => {
  const cases = [
    ["It felt\u2009wrong, somehow.", "It felt wrong, somehow."],
    ["Reeve Rookmoor seemed\u202funconcerned.", "Reeve Rookmoor seemed unconcerned."],
    ["He said\u00a0nothing at all.", "He said nothing at all."],
    ["A line\u2028broken oddly.", "A line broken oddly."],
    ["Wide\u3000spacing here.", "Wide spacing here."]
  ];
  for (const [input, expected] of cases) {
    assert.equal(completeGeneratedText(input, 600), expected);
  }
});

test("zero-width marks are removed without inventing a space", () => {
  assert.equal(completeGeneratedText("A zero\u200bwidth mark.", 600), "A zerowidth mark.");
  assert.equal(completeGeneratedText("\ufeffLeading mark.", 600), "Leading mark.");
});

test("characters outside the allowed range never weld two words together", () => {
  assert.equal(completeGeneratedText("coin \u{1F4B0} purse", 600), "coin purse");
  assert.doesNotMatch(completeGeneratedText("bread\u{1F35E}butter", 600), /breadbutter/);
});

test("ordinary prose is left exactly as written", () => {
  const plain = "I will speak with the reeve tomorrow, Father, if he will hear me.";
  assert.equal(completeGeneratedText(plain, 600), plain);
  assert.equal(completeStoredText(plain, 600), plain);
});

test("clipping still ends on a sentence boundary", () => {
  const text = "First sentence here. Second sentence runs on much longer than the limit allows.";
  const clipped = completeGeneratedText(text, 30);
  assert.match(clipped, /\.$|\.\.\.$/);
  assert.ok(clipped.length <= 33);
});
