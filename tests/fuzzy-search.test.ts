import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "../src/lib/fuzzy-search.ts";

test("every word must be found, in any field; Arabic and Latin are folded", () => {
  assert.equal(matchesSearch("شهابي طبيب", ["الدكتور شهابي", "طبيب أسنان"]), true);
  assert.equal(matchesSearch("إبراهيم", ["ابراهيم"]), true);
  assert.equal(matchesSearch("shehabi ali", ["Al Shehabi"]), false);
  assert.equal(matchesSearch("Ömer", ["omer riyadoglu"]), true);
});

test("a word typed with _ . or - is searched as separate words", () => {
  assert.equal(matchesSearch("dr_shehabi", ["Dr. Mohammed Al Shehabi"]), true);
  assert.equal(matchesSearch("al-shehabi", ["Mohammed Al Shehabi"]), true);
  assert.equal(matchesSearch("dr.shehabi", ["dr_shehabi"]), true);
  assert.equal(matchesSearch("dr_other", ["Dr. Mohammed Al Shehabi"]), false);
});

test("phone numbers still match as one run of digits, with or without signs and a leading zero", () => {
  assert.equal(matchesSearch("+90 532-123-45-67", ["905321234567"]), true);
  assert.equal(matchesSearch("0532 123", ["905321234567"]), true);
  assert.equal(matchesSearch("532-999", ["905321234567"]), false);
});

test("text typed into a ticket's note is found when the note text is one of the fields", () => {
  const fields = ["Nova Sales Manager", "", "يحتاج متابعة حساب dr_shehabi على انستغرام"];
  assert.equal(matchesSearch("dr_shehabi", fields), true);
  assert.equal(matchesSearch("متابعة", fields), true);
});

test("alef with a hamza or madda matches the plain alef, both ways", () => {
  assert.equal(matchesSearch("احمد", ["أحمد"]), true);
  assert.equal(matchesSearch("أحمد", ["احمد"]), true);
  assert.equal(matchesSearch("ابراهيم", ["إبراهيم"]), true);
  assert.equal(matchesSearch("ال عبد", ["آل عبد الله"]), true);
});
