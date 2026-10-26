// A reviewer's queue. Blind by design: reviewers see the application number and the answers,
// never the applicant's name, email, phone or organisation.
// GET ?slug=: my assigned applications and my scores. POST { slug, applicationId, scores, note }
// saves a review; POST { slug, applicationId, conflict: true } hands it to someone else.
import { migrate } from "../lib/db.js";
import { json, readJson, route, fail } from "../lib/http.js";
import { scoreInput } from "../lib/core.js";
import { asReviewer, runAssignment } from "../lib/data.js";

export const GET = route(async (request) => {
  await migrate();
  const { sql, p, reviewer } = await asReviewer(request, new URL(request.url).searchParams.get("slug"));
  const rows = await sql`
    select x.id, x.ref, x.answers, s.scores, s.note
    from apply_desk.assignments a
    join apply_desk.applications x on x.id = a.application_id
    left join apply_desk.scores s on s.application_id = a.application_id and s.reviewer_id = a.reviewer_id
    where a.reviewer_id = ${reviewer.id} and not a.conflict
    order by x.id`;
  return json({
    ok: true,
    reviewer: { name: reviewer.name },
    programme: { name: p.name, questions: p.questions.map((q) => q.label), criteria: p.criteria, demo: p.is_demo },
    queue: rows.map((r) => ({ id: Number(r.id), ref: r.ref, answers: r.answers, scores: r.scores || null, note: r.note || "" })),
  });
});

export const POST = route(async (request) => {
  await migrate();
  const body = await readJson(request, 8192);
  const { sql, p, reviewer } = await asReviewer(request, body.slug);
  const appId = Number(body.applicationId);
  const [a] = await sql`select conflict from apply_desk.assignments where application_id = ${appId} and reviewer_id = ${reviewer.id}`;
  if (!a || a.conflict) throw fail(404, "That application is not in your queue.");
  if (body.conflict === true) {
    await sql.transaction((q) => [
      q`update apply_desk.assignments set conflict = true where application_id = ${appId} and reviewer_id = ${reviewer.id}`,
      q`delete from apply_desk.scores where application_id = ${appId} and reviewer_id = ${reviewer.id}`,
    ]);
    const added = await runAssignment(sql, p);
    return json({ ok: true, reassigned: added > 0 });
  }
  const s = scoreInput(body, p.criteria);
  await sql`
    insert into apply_desk.scores (application_id, reviewer_id, scores, note)
    values (${appId}, ${reviewer.id}, ${JSON.stringify(s.scores)}::jsonb, ${s.note})
    on conflict (application_id, reviewer_id) do update set scores = excluded.scores, note = excluded.note, updated_at = now()`;
  return json({ ok: true });
});
