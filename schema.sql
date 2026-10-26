-- The app runs these itself on first request (lib/db.js). Kept here so you can read the shape.
-- Reviewers see applications through apply_desk.assignments only, and never the name, email, phone or org columns.

create schema if not exists apply_desk;

create table if not exists apply_desk.programmes (
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
  created_at timestamptz not null default now());

create table if not exists apply_desk.applications (
  id bigserial primary key,
  programme_id bigint not null references apply_desk.programmes(id) on delete cascade,
  ref text not null,
  name text not null,
  email text not null,
  phone text not null default '',
  org text not null default '',
  answers jsonb not null,
  created_at timestamptz not null default now(),
  unique (programme_id, ref));

create table if not exists apply_desk.reviewers (
  id bigserial primary key,
  programme_id bigint not null references apply_desk.programmes(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now());

create table if not exists apply_desk.assignments (
  application_id bigint not null references apply_desk.applications(id) on delete cascade,
  reviewer_id bigint not null references apply_desk.reviewers(id) on delete cascade,
  conflict boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (application_id, reviewer_id));

create table if not exists apply_desk.scores (
  application_id bigint not null references apply_desk.applications(id) on delete cascade,
  reviewer_id bigint not null references apply_desk.reviewers(id) on delete cascade,
  scores jsonb not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (application_id, reviewer_id));

create table if not exists apply_desk.hits (
  bucket text primary key,
  n int not null,
  expires_at timestamptz not null);
