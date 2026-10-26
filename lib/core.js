// Pure rules for programmes, applications, reviewer assignment and fair scores.
// No database here, so every rule is tested offline.
import { randomBytes } from "node:crypto";

export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export const newSlug = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
export const newKey = () => randomBytes(24).toString("base64url");
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const need = (v, label) => { if (!v) throw new InputError(`Add ${label}.`); return v; };

export function programmeInput(body) {
  const name = need(clean(body.name, 90), "the programme name");
  const about = clean(body.about, 400);
  const questions = (Array.isArray(body.questions) ? body.questions : [])
    .map((q) => ({ label: clean(q?.label, 160), long: q?.long === true }))
    .filter((q) => q.label).slice(0, 6);
  if (!questions.length) throw new InputError("Add at least one question for applicants.");
  const criteria = (Array.isArray(body.criteria) ? body.criteria : [])
    .map((c) => ({ name: clean(c?.name, 40), weight: Number(c?.weight) }))
    .filter((c) => c.name).slice(0, 5);
  if (!criteria.length) throw new InputError("Add at least one scoring criterion.");
  for (const c of criteria) if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 5) throw new InputError(`Give "${c.name}" a weight from 1 to 5.`);
  const perApp = Number(body.perApp ?? 2);
  if (![1, 2, 3].includes(perApp)) throw new InputError("Each application gets 1, 2 or 3 reviewers.");
  return { name, about, questions, criteria, perApp };
}

export function applicationInput(body, questions) {
  const name = need(clean(body.name, 80), "your name");
  const email = clean(body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new InputError("Add a valid email address.");
  const phone = clean(body.phone, 20);
  if (phone && !/^\+?[\d\s()-]{9,16}$/.test(phone)) throw new InputError("Check the phone number.");
  const org = clean(body.org, 100);
  const raw = Array.isArray(body.answers) ? body.answers : [];
  const answers = questions.map((q, i) => {
    const a = String(raw[i] ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    const max = q.long ? 2000 : 200;
    if (!a) throw new InputError(`Answer: "${q.label}"`);
    if (a.length > max) throw new InputError(`Keep the answer to "${q.label}" under ${max} characters.`);
    return a;
  });
  return { name, email, phone, org, answers };
}

export function scoreInput(body, criteria) {
  const s = Array.isArray(body.scores) ? body.scores.map(Number) : [];
  if (s.length !== criteria.length || s.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) throw new InputError("Score every criterion from 1 to 5.");
  return { scores: s, note: clean(body.note, 1000) };
}

// Gives every application `perApp` reviewers, spreading the work evenly.
// existing: [{ app, reviewer, conflict }]. A reviewer is never given an application twice,
// and never one they declared a conflict on. Applications with the fewest reviewers go first,
// and each slot goes to the least loaded reviewer (ties: fewer total, then list order).
export function assign(apps, reviewers, existing, perApp) {
  const active = new Map(apps.map((a) => [a, 0]));
  const load = new Map(reviewers.map((r) => [r, 0]));
  const taken = new Set();
  for (const e of existing) {
    taken.add(`${e.app}:${e.reviewer}`);
    if (e.conflict) continue;
    if (active.has(e.app)) active.set(e.app, active.get(e.app) + 1);
    if (load.has(e.reviewer)) load.set(e.reviewer, load.get(e.reviewer) + 1);
  }
  const order = [...apps].sort((a, b) => active.get(a) - active.get(b));
  const out = [];
  for (const app of order) {
    for (let k = active.get(app); k < perApp; k++) {
      const pick = reviewers
        .filter((r) => !taken.has(`${app}:${r}`))
        .sort((a, b) => load.get(a) - load.get(b) || reviewers.indexOf(a) - reviewers.indexOf(b))[0];
      if (pick === undefined) break; // not enough reviewers without a conflict
      taken.add(`${app}:${pick}`);
      load.set(pick, load.get(pick) + 1);
      out.push({ app, reviewer: pick });
    }
  }
  return out;
}

// One review to 0-100: each criterion's 1-5 mapped to 0-100, weighted.
export function total(scores, criteria) {
  const w = criteria.reduce((s, c) => s + c.weight, 0);
  return Math.round((criteria.reduce((s, c, i) => s + c.weight * ((scores[i] - 1) / 4) * 100, 0) / w) * 10) / 10;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

// Ranks applications. A harsh reviewer's 50 and a lenient reviewer's 80 can mean the same thing,
// so each reviewer with 3 or more reviews (and some spread) is rescaled to the panel's average and
// spread before averaging. Reviewers with fewer reviews are used as scored and the ranking says so.
export function rank(apps, reviews, criteria, perApp) {
  const totals = reviews.map((r) => ({ ...r, total: total(r.scores, criteria) }));
  const all = totals.map((r) => r.total);
  const panelMean = all.length ? mean(all) : 0;
  const panelSd = all.length > 1 ? sd(all) : 0;
  const byReviewer = new Map();
  for (const r of totals) byReviewer.set(r.reviewer, [...(byReviewer.get(r.reviewer) || []), r.total]);
  const scale = new Map();
  for (const [rev, xs] of byReviewer) {
    const s = sd(xs);
    if (xs.length >= 3 && s >= 2 && panelSd > 0) scale.set(rev, { m: mean(xs), s });
  }
  const adjusted = (r) => {
    const k = scale.get(r.reviewer);
    return k ? Math.max(0, Math.min(100, panelMean + ((r.total - k.m) / k.s) * panelSd)) : r.total;
  };
  const rows = apps.map((app) => {
    const mine = totals.filter((r) => r.app === app.id);
    const adj = mine.map(adjusted);
    const flags = [];
    if (mine.length < perApp) flags.push(mine.length ? "needs another review" : "not reviewed");
    if (mine.length >= 2 && Math.max(...mine.map((r) => r.total)) - Math.min(...mine.map((r) => r.total)) >= 35) flags.push("reviewers disagree");
    if (mine.some((r) => !scale.has(r.reviewer))) flags.push("unadjusted reviewer");
    return {
      ...app,
      reviews: mine.length,
      raw: mine.length ? Math.round(mean(mine.map((r) => r.total)) * 10) / 10 : null,
      score: mine.length ? Math.round(mean(adj) * 10) / 10 : null,
      flags,
      detail: mine.map((r) => ({ reviewer: r.reviewer, total: r.total, adjusted: Math.round(adjusted(r) * 10) / 10, scores: r.scores, note: r.note })),
    };
  });
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.ref < b.ref ? -1 : 1));
  rows.forEach((r, i) => { r.rank = r.score == null ? null : i + 1; });
  return rows;
}

export const DEMO = {
  name: "Demo Hub Accelerator, cohort 5",
  about: "Twelve weeks for early-stage Kenyan startups: mentors, a KES 500,000 grant and a demo day. (Demo data, resets daily.)",
  questions: [
    { label: "What does your startup do, in one sentence?", long: false },
    { label: "Who pays you today, and how much have they paid?", long: true },
    { label: "Why is your team the one to build this?", long: true },
  ],
  criteria: [{ name: "Problem", weight: 2 }, { name: "Traction", weight: 3 }, { name: "Team", weight: 2 }],
  perApp: 2,
  reviewers: ["Reviewer A (lenient)", "Reviewer B", "Reviewer C (harsh)"],
  // [org, one-liner, traction, team]
  apps: [
    ["Maji Point", "Pay-as-you-go water ATMs for estates in Nakuru.", "14 estates pay a monthly fee; KES 410,000 billed in September.", "Two founders who ran water kiosks for six years."],
    ["ShambaPay", "Input credit for smallholder farmers repaid at harvest through M-Pesa.", "1,200 farmers, 96% repayment last season.", "Agronomist and an ex-bank credit officer."],
    ["Darasa Live", "Live revision classes for KCSE students over low data.", "3,000 sign-ups, 240 paying KES 300 a month.", "Two teachers and a developer."],
    ["Boda Care", "Health cover for boda boda riders paid daily.", "Pilot with one SACCO, 180 riders paying KES 20 a day.", "Founder is an insurance agent; CTO left last month."],
    ["Kazi Kit", "Shift scheduling for restaurants.", "Four cafes on a free trial.", "Solo founder, product designer."],
    ["Soko Fresh", "Next-day vegetables for Nairobi restaurants.", "KES 1.2M monthly sales, 60 restaurant clients.", "Founders grew up in the Wakulima market trade."],
    ["ChamaBooks", "Bookkeeping and loans tracking for chamas.", "800 chamas, KES 150 a month each, 30% pay.", "Ex-SACCO accountant and two engineers."],
    ["Hewa Sense", "Air quality sensors for factories.", "Two paid pilots, KES 600,000 total.", "PhD in environmental engineering, hardware lead from a phone OEM."],
    ["Mtaa Ads", "Screen ads in matatus.", "Ten matatus fitted, no paying advertiser yet.", "Two founders from a matatu SACCO family."],
    ["Pesa Kids", "Savings app for children, parents top up by M-Pesa.", "Waitlist of 1,100 parents.", "First-time founders, one ex-fintech PM."],
    ["Taka Smart", "Waste collection routing for county contractors.", "One county contract signed, KES 2.4M a year.", "Logistics founder and a data scientist."],
    ["Fundi Hub", "Verified plumbers and electricians on call.", "350 jobs a month at 12% commission.", "Two founders who ran a hardware shop."],
    ["Pika Box", "Cloud kitchen software for home cooks selling on WhatsApp.", "90 cooks, KES 85,000 monthly subscriptions.", "Chef founder and a backend engineer from a delivery startup."],
    ["Safari Seat", "Shared rides between towns booked by SMS.", "2,300 trips sold in three months, 8% margin.", "Founder ran a shuttle company for five years."],
  ],
  // Per app: scores by A (lenient), B, C (harsh) as [problem, traction, team]. null = not reviewed by them.
  scores: [
    [[5, 4, 5], [4, 4, 4], null], [[5, 5, 5], null, [4, 4, 3]], [null, [4, 3, 4], [3, 2, 3]],
    [[4, 3, 3], [3, 2, 2], null], [[4, 3, 4], null, [2, 1, 2]], [null, [4, 5, 4], [3, 4, 3]],
    [[5, 4, 4], [4, 3, 4], null], [[4, 3, 5], null, [3, 2, 4]], [null, [2, 1, 3], null],
    [[4, 2, 3], null, null], [null, [5, 5, 4], [4, 4, 3]], [[5, 4, 4], null, [3, 3, 2]],
    null, null,
  ],
};
