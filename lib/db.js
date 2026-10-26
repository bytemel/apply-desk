// Neon Postgres over HTTP. One query per request, no pool to manage, works on Vercel functions.
// The tables live in their own schema so this app can share a database with others.
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

let sql = null;
let ready = null;

export function db() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not set"), { status: 503 });
  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

// Creates the tables on the first request after a cold start. Every statement is idempotent,
// so a fresh Neon database needs no setup step. The same SQL is in schema.sql for reading.
export function migrate() {
  ready ??= db().transaction((q) => [
    q`create schema if not exists apply_desk`,
    q`create table if not exists apply_desk.programmes (
        id bigserial primary key,
        slug text not null unique,
        name text not null,
        about text not null default '',
        questions jsonb not null,
        criteria jsonb not null,
        per_app int not null default 2 check (per_app between 1 and 3),
        open boolean not null default true,
        key_hash text not null,
        is_demo boolean not null default false,
        created_at timestamptz not null default now())`,
    q`create table if not exists apply_desk.applications (
        id bigserial primary key,
        programme_id bigint not null references apply_desk.programmes(id) on delete cascade,
        ref text not null,
        name text not null,
        email text not null,
        phone text not null default '',
        org text not null default '',
        answers jsonb not null,
        created_at timestamptz not null default now(),
        unique (programme_id, ref))`,
    q`create table if not exists apply_desk.reviewers (
        id bigserial primary key,
        programme_id bigint not null references apply_desk.programmes(id) on delete cascade,
        name text not null,
        key_hash text not null unique,
        created_at timestamptz not null default now())`,
    q`create table if not exists apply_desk.assignments (
        application_id bigint not null references apply_desk.applications(id) on delete cascade,
        reviewer_id bigint not null references apply_desk.reviewers(id) on delete cascade,
        conflict boolean not null default false,
        created_at timestamptz not null default now(),
        primary key (application_id, reviewer_id))`,
    q`create table if not exists apply_desk.scores (
        application_id bigint not null references apply_desk.applications(id) on delete cascade,
        reviewer_id bigint not null references apply_desk.reviewers(id) on delete cascade,
        scores jsonb not null,
        note text not null default '',
        updated_at timestamptz not null default now(),
        primary key (application_id, reviewer_id))`,
    q`create table if not exists apply_desk.hits (
        bucket text primary key,
        n int not null,
        expires_at timestamptz not null)`,
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

export const hash = (s) => createHash("sha256").update(String(s)).digest("hex");

// The caller's IP, hashed so the table never stores a raw address.
export function clientId(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  return hash(`apply-desk:${ip}`).slice(0, 32);
}

// Fixed-window rate limit in Postgres: at most `max` calls per `minutes` for one action and caller.
export async function allow(request, action, max, minutes) {
  const bucket = `${action}:${clientId(request)}`;
  const [row] = await db()`
    insert into apply_desk.hits (bucket, n, expires_at)
    values (${bucket}, 1, now() + make_interval(mins => ${minutes}))
    on conflict (bucket) do update set
      n = case when hits.expires_at < now() then 1 else hits.n + 1 end,
      expires_at = case when hits.expires_at < now() then excluded.expires_at else hits.expires_at end
    returning n`;
  return row.n <= max;
}
