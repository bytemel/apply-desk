// POST: create a programme and get its private admin key. GET ?slug=: what the public form needs.
import { db, migrate, allow, hash } from "../lib/db.js";
import { json, readJson, route, fail } from "../lib/http.js";
import { newSlug, newKey, programmeInput } from "../lib/core.js";
import { programmeBySlug } from "../lib/data.js";

export const POST = route(async (request) => {
  await migrate();
  if (!(await allow(request, "programme", 5, 60))) throw fail(429, "That is a lot of programmes. Try again in an hour.");
  const p = programmeInput(await readJson(request, 16 * 1024));
  const sql = db();
  // Applications hold personal data: programmes are deleted 180 days after they are made.
  await sql`delete from apply_desk.programmes where not is_demo and created_at < now() - interval '180 days'`;
  const slug = newSlug();
  const key = newKey();
  await sql`
    insert into apply_desk.programmes (slug, name, about, questions, criteria, per_app, key_hash)
    values (${slug}, ${p.name}, ${p.about}, ${JSON.stringify(p.questions)}::jsonb, ${JSON.stringify(p.criteria)}::jsonb, ${p.perApp}, ${hash(key)})`;
  return json({ ok: true, slug, key }, 201);
});

export const GET = route(async (request) => {
  await migrate();
  const p = await programmeBySlug(db(), new URL(request.url).searchParams.get("slug"));
  return json({ ok: true, programme: { slug: p.slug, name: p.name, about: p.about, questions: p.questions, open: p.open, demo: p.is_demo } });
});
