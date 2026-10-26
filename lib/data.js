// Database helpers shared by the routes: loading a programme, checking keys, assigning, the demo.
import { db, hash } from "./db.js";
import { fail } from "./http.js";
import { assign, DEMO } from "./core.js";

export async function programmeBySlug(sql, slug) {
  if (!/^[a-z0-9]{3,16}$/.test(String(slug || ""))) throw fail(404, "No programme here.");
  if (slug === "demo") await ensureDemo(sql);
  const [p] = await sql`select * from apply_desk.programmes where slug = ${slug}`;
  if (!p) throw fail(404, "No programme here. Check the link.");
  return p;
}

export async function asAdmin(request, slug) {
  const sql = db();
  const key = request.headers.get("x-manage-key") || "";
  if (!key) throw fail(401, "Open this from your admin link.");
  const p = await programmeBySlug(sql, slug);
  if (hash(key) !== p.key_hash) throw fail(403, "That admin link is not valid for this programme.");
  return { sql, p };
}

export async function asReviewer(request, slug) {
  const sql = db();
  const key = request.headers.get("x-manage-key") || "";
  if (!key) throw fail(401, "Open this from your reviewer link.");
  const p = await programmeBySlug(sql, slug);
  const [r] = await sql`select id, name from apply_desk.reviewers where key_hash = ${hash(key)} and programme_id = ${p.id}`;
  if (!r) throw fail(403, "That reviewer link is not valid for this programme.");
  return { sql, p, reviewer: r };
}

// Fills every open reviewing slot with the least loaded reviewer who has no conflict.
export async function runAssignment(sql, p) {
  const apps = (await sql`select id from apply_desk.applications where programme_id = ${p.id} order by id`).map((a) => Number(a.id));
  const reviewers = (await sql`select id from apply_desk.reviewers where programme_id = ${p.id} order by id`).map((r) => Number(r.id));
  if (!apps.length || !reviewers.length) return 0;
  const existing = (await sql`
    select a.application_id, a.reviewer_id, a.conflict from apply_desk.assignments a
    join apply_desk.applications x on x.id = a.application_id where x.programme_id = ${p.id}`)
    .map((e) => ({ app: Number(e.application_id), reviewer: Number(e.reviewer_id), conflict: e.conflict }));
  const pairs = assign(apps, reviewers, existing, p.per_app);
  if (!pairs.length) return 0;
  await sql`
    insert into apply_desk.assignments (application_id, reviewer_id)
    select x.app, x.reviewer from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) as x(app bigint, reviewer bigint)
    on conflict do nothing`;
  return pairs.length;
}

// Short, readable application numbers per programme: A-001, A-002...
export async function insertApplication(sql, programmeId, a, extra = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [n] = await sql`select count(*)::int + 1 + ${attempt} as n from apply_desk.applications where programme_id = ${programmeId}`;
    const ref = `A-${String(n.n).padStart(3, "0")}`;
    const rows = await sql`
      insert into apply_desk.applications (programme_id, ref, name, email, phone, org, answers, created_at)
      values (${programmeId}, ${ref}, ${a.name}, ${a.email}, ${a.phone}, ${a.org}, ${JSON.stringify(a.answers)}::jsonb, ${extra.createdAt || new Date().toISOString()})
      on conflict (programme_id, ref) do nothing returning id, ref`;
    if (rows.length) return { id: Number(rows[0].id), ref: rows[0].ref };
  }
  throw fail(409, "Busy moment. Send it again.");
}

// The demo programme starts over once a day. Its admin key is "demo" and its reviewer keys are
// "demo-a", "demo-b" and "demo-c", printed on the page, so anyone can try every side of it.
export async function ensureDemo(sql) {
  const [old] = await sql`select id, created_at, about from apply_desk.programmes where slug = 'demo'`;
  // Starts over once a day, or as soon as the demo content in lib/core.js changes.
  if (old && new Date(old.created_at) > new Date(Date.now() - 86400e3) && old.about === DEMO.about) return;
  if (old) await sql`delete from apply_desk.programmes where id = ${old.id}`;
  const [p] = await sql`
    insert into apply_desk.programmes (slug, name, about, questions, criteria, per_app, key_hash, is_demo)
    values ('demo', ${DEMO.name}, ${DEMO.about}, ${JSON.stringify(DEMO.questions)}::jsonb, ${JSON.stringify(DEMO.criteria)}::jsonb, ${DEMO.perApp}, ${hash("demo")}, true)
    on conflict (slug) do nothing returning id`;
  if (!p) return;
  try {
    await seedDemo(sql, p.id);
  } catch (e) {
    // A half-made demo would never be rebuilt: remove it so the next request starts clean.
    await sql`delete from apply_desk.programmes where id = ${p.id}`;
    throw e;
  }
}

async function seedDemo(sql, programmeId) {
  const p = { id: programmeId };
  const revIds = [];
  for (const [i, name] of DEMO.reviewers.entries()) {
    const [r] = await sql`insert into apply_desk.reviewers (programme_id, name, key_hash) values (${p.id}, ${name}, ${hash(`demo-${"abc"[i]}`)}) returning id`;
    revIds.push(Number(r.id));
  }
  const founders = ["Wanjiru Kamau", "Otieno Ouma", "Achieng Odhiambo", "Kiprop Rotich", "Nyambura Mwangi", "Mutua Musyoka", "Fatuma Hassan", "Njeri Gitau", "Kamau Njoroge", "Atieno Okoth", "Chebet Langat", "Baraka Kilonzo", "Halima Abdi", "Juma Wekesa"];
  for (const [i, [org, line, traction, team]] of DEMO.apps.entries()) {
    const { id } = await insertApplication(sql, p.id, {
      name: founders[i], email: `founder${i + 1}@example.com`, phone: "", org, answers: [line, traction, team],
    }, { createdAt: new Date(Date.now() - (DEMO.apps.length - i) * 3600e3).toISOString() });
    for (const [k, s] of (DEMO.scores[i] || []).entries()) {
      if (!s) continue;
      await sql`insert into apply_desk.assignments (application_id, reviewer_id) values (${id}, ${revIds[k]})`;
      await sql`insert into apply_desk.scores (application_id, reviewer_id, scores) values (${id}, ${revIds[k]}, ${JSON.stringify(s)}::jsonb)`;
    }
  }
  // Leave every reviewer something to do: the open slots go out now, unscored.
  await runAssignment(sql, { id: p.id, per_app: DEMO.perApp });
}
