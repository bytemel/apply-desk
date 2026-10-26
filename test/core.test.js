import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, rank, total, programmeInput, applicationInput, scoreInput, InputError, DEMO } from "../lib/core.js";

test("assignment gives each application its reviewers and spreads the load", () => {
  const apps = Array.from({ length: 10 }, (_, i) => i + 1);
  const out = assign(apps, ["a", "b", "c"], [], 2);
  assert.equal(out.length, 20);
  for (const app of apps) assert.equal(new Set(out.filter((x) => x.app === app).map((x) => x.reviewer)).size, 2, `app ${app} has 2 different reviewers`);
  const loads = ["a", "b", "c"].map((r) => out.filter((x) => x.reviewer === r).length);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1, `loads ${loads}`);
});

test("assignment tops up, respects conflicts and never repeats a pair", () => {
  const existing = [{ app: 1, reviewer: "a", conflict: false }, { app: 1, reviewer: "b", conflict: true }];
  const out = assign([1], ["a", "b", "c"], existing, 2);
  assert.deepEqual(out, [{ app: 1, reviewer: "c" }]);
  assert.deepEqual(assign([1], ["a", "b", "c"], [...existing, { app: 1, reviewer: "c", conflict: false }], 2), []);
  assert.deepEqual(assign([1], ["a"], [{ app: 1, reviewer: "a", conflict: true }], 2), [], "nobody left: no assignment rather than a bad one");
});

test("a review becomes 0 to 100 with weights", () => {
  const c = [{ name: "x", weight: 1 }, { name: "y", weight: 3 }];
  assert.equal(total([5, 5], c), 100);
  assert.equal(total([1, 1], c), 0);
  assert.equal(total([5, 1], c), 25);
});

test("a harsh and a lenient reviewer are evened out before ranking", () => {
  const criteria = [{ name: "q", weight: 1 }];
  const apps = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, ref: `A-${id}` }));
  // A gives everyone high marks, C low marks. App 4 is A's least favourite, app 7 is C's favourite.
  const reviews = [
    ...[1, 2, 3, 4].map((id, i) => ({ app: id, reviewer: "A", scores: [[5, 5, 4, 4][i]], note: "" })),
    ...[3, 5, 6, 7].map((id, i) => ({ app: id, reviewer: "C", scores: [[2, 1, 1, 3][i]], note: "" })),
  ];
  const r = rank(apps, reviews, criteria, 1);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.ok(by[7].raw < by[4].raw, "on raw scores C's favourite loses to A's least favourite");
  assert.ok(by[7].score > by[4].score, "after evening out, C's favourite ranks above A's least favourite");
  assert.equal(r.filter((x) => x.rank).length, 7);
});

test("flags: missing reviews, disagreement, reviewers too new to adjust", () => {
  const criteria = [{ name: "q", weight: 1 }];
  const r = rank([{ id: 1, ref: "A-1" }, { id: 2, ref: "A-2" }], [
    { app: 1, reviewer: "x", scores: [5], note: "" }, { app: 1, reviewer: "y", scores: [1], note: "" },
  ], criteria, 2);
  const one = r.find((x) => x.id === 1);
  assert.ok(one.flags.includes("reviewers disagree"));
  assert.ok(one.flags.includes("unadjusted reviewer"));
  const two = r.find((x) => x.id === 2);
  assert.deepEqual(two.flags, ["not reviewed"]);
  assert.equal(two.rank, null);
});

test("inputs are checked", () => {
  const p = programmeInput({ name: "X", questions: [{ label: "Why?", long: true }], criteria: [{ name: "Team", weight: 3 }] });
  assert.equal(p.perApp, 2);
  assert.throws(() => programmeInput({ name: "X", questions: [], criteria: [{ name: "T", weight: 1 }] }), /question/);
  assert.throws(() => programmeInput({ name: "X", questions: [{ label: "Q" }], criteria: [{ name: "T", weight: 9 }] }), /weight/);
  assert.throws(() => applicationInput({ name: "A", email: "bad", answers: ["x"] }, p.questions), /email/);
  assert.throws(() => applicationInput({ name: "A", email: "a@b.co", answers: [""] }, p.questions), /Answer/);
  assert.equal(applicationInput({ name: "A", email: "A@B.co", answers: ["Because"] }, p.questions).email, "a@b.co");
  assert.throws(() => scoreInput({ scores: [6] }, p.criteria), InputError);
  assert.deepEqual(scoreInput({ scores: ["4"], note: " ok " }, p.criteria), { scores: [4], note: "ok" });
});

test("the demo data is valid", () => {
  const p = programmeInput(DEMO);
  assert.equal(DEMO.apps.length, DEMO.scores.length);
  assert.ok(DEMO.apps.length <= 14, "lib/data.js has 14 founder names for the demo");
  for (const s of DEMO.scores.filter(Boolean).flat().filter(Boolean)) scoreInput({ scores: s }, p.criteria);
});
