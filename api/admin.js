// The programme team's view. GET ?slug=: applications, reviewers, progress and the fair ranking.
// POST { slug, action }: addReviewer { name }, removeReviewer { id }, assign, close, open, delete.
import { randomBytes } from "node:crypto";
import { migrate, hash } from "../lib/db.js";
import { json, readJson, route, fail } from "../lib/http.js";
import { rank } from "../lib/core.js";
import { asAdmin, runAssignment } from "../lib/data.js";

export const GET = route(async (request) => {
  await migrate();
  const { sql, p } = await asAdmin(request, new URL(request.url).searchParams.get("slug"));
  const [apps, reviewers, assignments, scores] = await sql.transaction((q) => [
    q`select id, ref, name, email, phone, org, answers, created_at from apply_desk.applications where programme_id = ${p.id} order by id`,
    q`select id, name from apply_desk.reviewers where programme_id = ${p.id} order by id`,
    q`select a.application_id, a.reviewer_id, a.conflict from apply_desk.assignments a join apply_desk.reviewers r on r.id = a.reviewer_id where r.programme_id = ${p.id}`,
    q`select s.application_id, s.reviewer_id, s.scores, s.note from apply_desk.scores s join apply_desk.reviewers r on r.id = s.reviewer_id where r.programme_id = ${p.id}`,
  ]);
  const names = new Map(reviewers.map((r) => [Number(r.id), r.name]));
  const reviews = scores.map((s) => ({ app: Number(s.application_id), reviewer: Number(s.reviewer_id), scores: s.scores, note: s.note }));
  const ranked = rank(apps.map((a) => ({ id: Number(a.id), ref: a.ref, name: a.name, email: a.email, phone: a.phone, org: a.org, answers: a.answers, at: new Date(a.created_at).toISOString() })), reviews, p.criteria, p.per_app)
    .map((r) => ({ ...r, detail: r.detail.map((d) => ({ ...d, reviewer: names.get(d.reviewer) || "Removed reviewer" })) }));
  const active = assignments.filter((a) => !a.conflict);
  return json({
    ok: true,
    programme: { slug: p.slug, name: p.name, about: p.about, questions: p.questions, criteria: p.criteria, perApp: p.per_app, open: p.open, demo: p.is_demo },
    reviewers: reviewers.map((r) => ({
      id: Number(r.id), name: r.name,
      assigned: active.filter((a) => Number(a.reviewer_id) === Number(r.id)).length,
      done: reviews.filter((s) => s.reviewer === Number(r.id)).length,
      conflicts: assignments.filter((a) => a.conflict && Number(a.reviewer_id) === Number(r.id)).length,
    })),
    openSlots: Math.max(0, apps.length * p.per_app - active.length),
    ranked,
  });
});

export const POST = route(async (request) => {
  await migrate();
  const body = await readJson(request, 2048);
  const { sql, p } = await asAdmin(request, body.slug);
  switch (body.action) {
    case "addReviewer": {
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!name) throw fail(400, "Name the reviewer.");
      const [n] = await sql`select count(*)::int as n from apply_desk.reviewers where programme_id = ${p.id}`;
      if (n.n >= 30) throw fail(409, "A programme holds up to 30 reviewers.");
      const key = randomBytes(24).toString("base64url");
      await sql`insert into apply_desk.reviewers (programme_id, name, key_hash) values (${p.id}, ${name}, ${hash(key)})`;
      return json({ ok: true, key }); // shown once; only the hash is kept
    }
    case "removeReviewer": {
      // Their finished reviews go with them, and their open slots return to the pool.
      const gone = await sql`delete from apply_desk.reviewers where id = ${Number(body.id)} and programme_id = ${p.id} returning id`;
      if (!gone.length) throw fail(404, "That reviewer is already gone.");
      return json({ ok: true });
    }
    case "assign":
      return json({ ok: true, added: await runAssignment(sql, p) });
    case "close":
    case "open":
      await sql`update apply_desk.programmes set open = ${body.action === "open"} where id = ${p.id}`;
      return json({ ok: true });
    case "delete":
      if (p.is_demo) throw fail(409, "The demo cannot be deleted. It resets every day.");
      await sql`delete from apply_desk.programmes where id = ${p.id}`;
      return json({ ok: true });
    default:
      throw fail(400, "Unknown action.");
  }
});
