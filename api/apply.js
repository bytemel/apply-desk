// POST: submit an application. Returns the application number to quote.
import { db, migrate, allow } from "../lib/db.js";
import { json, readJson, route, fail } from "../lib/http.js";
import { applicationInput } from "../lib/core.js";
import { programmeBySlug, insertApplication } from "../lib/data.js";

export const POST = route(async (request) => {
  await migrate();
  const body = await readJson(request, 32 * 1024);
  if (!(await allow(request, `apply:${body.slug}`, 10, 60))) throw fail(429, "Too many applications from this network. Try again in an hour.");
  const sql = db();
  // Applications are personal data: programmes older than 180 days go, checked on every application too.
  await sql`delete from apply_desk.programmes where not is_demo and created_at < now() - interval '180 days'`;
  const p = await programmeBySlug(sql, body.slug);
  if (!p.open) throw fail(409, "Applications are closed.");
  const a = applicationInput(body, p.questions);
  if (p.is_demo) {
    // The demo's admin key is public, so contact details typed here would be readable by anyone.
    // Keep the answers, replace who sent them.
    const n = Math.random().toString(36).slice(2, 8);
    Object.assign(a, { name: `Demo applicant ${n}`, email: `demo-${n}@example.com`, phone: "", org: a.org ? "Demo startup" : "" });
  }
  const [dupe] = await sql`select ref from apply_desk.applications where programme_id = ${p.id} and email = ${a.email}`;
  if (dupe) throw fail(409, `You already applied with this email (application ${dupe.ref}). Contact the programme team to change it.`);
  const [count] = await sql`select count(*)::int as n from apply_desk.applications where programme_id = ${p.id}`;
  if (count.n >= 2000) throw fail(409, "This programme has reached its application limit.");
  const { ref } = await insertApplication(sql, p.id, a);
  return json({ ok: true, ref }, 201);
});
