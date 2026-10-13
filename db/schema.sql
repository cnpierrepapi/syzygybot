-- SYZYGY schema. Every agent step writes one row to `actions`; the SDR floor reads that table.

create table if not exists entities (
  qloo_id        text primary key,
  name           text not null,
  type           text not null,            -- brand | artist | tv_show | movie ...
  popularity     double precision,
  official_site  text,
  wikidata       text,
  x_handle       text,
  x_handle_status text not null default 'none' check (x_handle_status in ('verified','review','none')),
  x_handle_sources jsonb not null default '[]',
  raw            jsonb,
  updated_at     timestamptz not null default now()
);

create table if not exists pairs (
  id          uuid primary key default gen_random_uuid(),
  a_id        text not null references entities(qloo_id),
  b_id        text not null references entities(qloo_id),
  dims        jsonb not null default '{}',  -- per-dimension raw values + scores
  score       double precision,
  band        text check (band in ('PASS','WATCH','PITCH')),
  thesis      text,
  rubric_version text not null,
  called_at   timestamptz not null default now(),  -- "called on <date>" track record
  unique (a_id, b_id, rubric_version)
);

create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  pair_id     uuid not null references pairs(id),
  entity_id   text not null references entities(qloo_id),
  reason      text not null,                 -- why the qualifier picked this side
  passed_on   text references entities(qloo_id),
  evidence    jsonb not null default '{}',   -- numbers pack, incl. the 3 extra partners
  created_at  timestamptz not null default now()
);

create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id),
  name         text,
  role         text not null,
  email        text,
  email_status text not null default 'unverified' check (email_status in ('unverified','valid','invalid','risky','role_inbox')),
  sources      jsonb not null default '[]',  -- public URLs only; never LinkedIn
  created_at   timestamptz not null default now()
);

create table if not exists plans (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  angle       text not null,
  channels    jsonb not null default '[]',
  triggers    jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

create table if not exists touches (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id),
  plan_id     uuid references plans(id),
  channel     text not null check (channel in ('email','letter','x_post')),
  step        int not null default 1,
  subject     text,
  body        text not null,
  status      text not null default 'draft' check (status in ('draft','dry_run','queued','sent','bounced','failed')),
  scheduled_for timestamptz,
  sent_at     timestamptz,
  message_id  text,
  created_at  timestamptz not null default now()
);

create table if not exists replies (
  id          uuid primary key default gen_random_uuid(),
  touch_id    uuid references touches(id),
  class       text not null check (class in ('interested','not_now','referral','opt_out','ooo','other')),
  body        text not null,
  answer      text,                          -- inbox agent's data-backed answer
  created_at  timestamptz not null default now()
);

create table if not exists do_not_contact (
  value       text primary key,              -- email address or domain
  reason      text not null,
  created_at  timestamptz not null default now()
);

create table if not exists actions (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null check (agent in ('scout','qualifier','numbers','contact_finder','verifier','strategist','writer','sequencer','inbox','booker')),
  kind        text not null,                 -- e.g. thesis.published, account.qualified, touch.sent
  summary     text not null,                 -- one line for the floor feed
  ref_table   text,
  ref_id      text,
  detail      jsonb not null default '{}',
  llm_cost_usd double precision,
  created_at  timestamptz not null default now()
);
create index if not exists actions_created_idx on actions (created_at desc);

-- Contact finder + Verifier (13 Oct). A contact is a named person or a published role inbox.
alter table contacts add column if not exists kind text not null default 'person';
alter table contacts add column if not exists role_status text not null default 'unconfirmed';
alter table contacts add column if not exists verified_at timestamptz;
alter table contacts add column if not exists verification jsonb not null default '{}';
alter table plans add column if not exists detail jsonb not null default '{}';
alter table touches add column if not exists to_address text;
alter table touches add column if not exists detail jsonb not null default '{}';
