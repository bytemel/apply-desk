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
  const p = await programmeBySlug(sql, body.slug);
  if (!p.open) throw fail(409, "Applications are closed.");
  const a = applicationInput(body, p.questions);
  const [dupe] = await sql`select ref from apply_desk.applications where programme_id = ${p.id} and email = ${a.email}`;
  if (dupe) throw fail(409, `You already applied with this email (application ${dupe.ref}). Contact the programme team to change it.`);
  const [count] = await sql`select count(*)::int as n from apply_desk.applications where programme_id = ${p.id}`;
  if (count.n >= 2000) throw fail(409, "This programme has reached its application limit.");
  const { ref } = await insertApplication(sql, p.id, a);
  return json({ ok: true, ref }, 201);
});
