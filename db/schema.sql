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

-- Sequencer + Inbox agent (13 Oct). A touch can be called off (opt-out, reply, do-not-contact).
alter table touches drop constraint if exists touches_status_check;
alter table touches add constraint touches_status_check check (status in ('draft','dry_run','queued','sent','bounced','failed','cancelled'));
alter table accounts add column if not exists tz text;
alter table replies add column if not exists simulated boolean not null default false;
alter table replies add column if not exists detail jsonb not null default '{}';
create index if not exists touches_contact_idx on touches (contact_id, step);

-- Readable addresses (14 Oct): every public page gets a slug; opt-out links get a short random token.
alter table pairs add column if not exists slug text;
alter table accounts add column if not exists slug text;
alter table contacts add column if not exists slug text;
alter table plans add column if not exists slug text;
alter table touches add column if not exists slug text;
alter table replies add column if not exists slug text;
alter table touches add column if not exists optout_token text;
create unique index if not exists pairs_slug_idx on pairs (slug);
create unique index if not exists accounts_slug_idx on accounts (slug);
create unique index if not exists contacts_slug_idx on contacts (slug);
create unique index if not exists plans_slug_idx on plans (slug);
create unique index if not exists touches_slug_idx on touches (slug);
create unique index if not exists replies_slug_idx on replies (slug);
create unique index if not exists touches_optout_idx on touches (optout_token);

-- One account per company (14 Oct): a later thesis about the same company joins its account as extra evidence.
alter table pairs add column if not exists account_id uuid references accounts(id);
-- Run locks with an expiry, so two cron runs (or a cron and a manual run) never work the same queue at once.
create table if not exists run_locks (
  name   text primary key,
  until  timestamptz not null
);

-- CRM connectors (14 Oct). A workspace is a claimed brand; its CRM receives the brands that need it.
create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  entity_id     text not null references entities(qloo_id),
  name          text not null,
  connect_token text not null unique,          -- private link the brand uses to connect a CRM
  created_at    timestamptz not null default now()
);
create table if not exists crm_connections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  provider      text not null check (provider in ('hubspot','salesforce')),
  access_enc    text not null,                 -- AES-256-GCM, key CRM_TOKEN_KEY
  refresh_enc   text,
  instance_url  text,                          -- Salesforce org URL
  external_id   text,                          -- HubSpot portal id / Salesforce org id
  expires_at    timestamptz not null,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, provider)
);
-- Which SYZYGY record became which CRM record, so a re-sync updates nothing twice.
create table if not exists crm_records (
  connection_id uuid not null references crm_connections(id) on delete cascade,
  local_type    text not null,                 -- company | contact | note
  local_id      text not null,
  remote_id     text not null,
  synced_at     timestamptz not null default now(),
  primary key (connection_id, local_type, local_id)
);

-- Deal check (lib/dealcheck.ts): is the thesis already a live partnership? clear | past | active; null = not checked yet.
alter table pairs add column if not exists deal_status text;
alter table pairs add column if not exists deal_check jsonb;
alter table pairs add column if not exists deal_checked_at timestamptz;
alter table actions drop constraint if exists actions_agent_check;
alter table actions add constraint actions_agent_check check (agent in ('scout','checker','qualifier','numbers','contact_finder','verifier','strategist','writer','sequencer','inbox','booker'));

-- Claim flow (15 Oct). A brand claims its page by posting a one-time code from its X account; X's oEmbed
-- says who really posted it. A claim makes (or takes over) the brand's workspace.
create table if not exists claims (
  id          uuid primary key default gen_random_uuid(),
  entity_id   text not null references entities(qloo_id),
  code        text not null,                   -- public: it goes in the post
  secret      text not null,                   -- private: held in the claimant's cookie
  status      text not null default 'pending' check (status in ('pending','verified','failed')),
  tweet_url   text,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists claims_entity_idx on claims (entity_id, created_at desc);
alter table workspaces add column if not exists claimed_at timestamptz;
-- handle, tweet url, how it was checked
alter table workspaces add column if not exists claim jsonb not null default '{}';
-- judges' test claims: never send, never stop anything
alter table workspaces add column if not exists demo boolean not null default false;
-- inward mode: SYZYGY writes for the brand, signed as it
alter table workspaces add column if not exists send_as boolean not null default false;
-- "Maria Lopez, partnerships"
alter table workspaces add column if not exists signer text;
-- where interested replies go
alter table workspaces add column if not exists handoff_email text;
alter table workspaces add column if not exists detail jsonb not null default '{}';
create unique index if not exists workspaces_entity_real_idx on workspaces (entity_id) where not demo;
-- A message written for a claimed brand, signed as it. Null = SYZYGY's own pitch.
alter table touches add column if not exists workspace_id uuid references workspaces(id);

-- Handoff (15 Oct). An interested reply goes to a person: SYZYGY's own desk (who refers it to Qloo),
-- or the brand itself when the thread was signed as a claimed brand.
create table if not exists handoffs (
  id           uuid primary key default gen_random_uuid(),
  reply_id     uuid not null unique references replies(id) on delete cascade,
  workspace_id uuid references workspaces(id),   -- null = SYZYGY's desk
  token        text not null unique,             -- private page /handoff/<token>
  status       text not null default 'open' check (status in ('open','referred','closed')),
  packet       jsonb not null default '{}',
  simulated    boolean not null default false,
  notified     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Pre-scored queue (18 Oct). The sweep scores every partner on each seed's Qloo list ahead of time;
-- Scout then takes the best queued pair whose brand hasn't been pitched yet. Picked pairs add both
-- sides as new seeds, so the pool keeps growing.
create table if not exists scout_seeds (
  entity_id   text primary key,
  name        text not null,
  type        text not null,
  source      text not null default 'seed',   -- seed | entities | picked
  swept_at    timestamptz,
  added_at    timestamptz not null default now()
);

create table if not exists pair_queue (
  id          uuid primary key default gen_random_uuid(),
  a_id        text not null,
  b_id        text not null,
  a           jsonb not null,                 -- Qloo records, so Scout can rescore without a lookup
  b           jsonb not null,
  score       double precision not null,
  band        text not null check (band in ('PASS','WATCH','PITCH')),
  dims        jsonb not null default '{}',
  rubric_version text not null,
  status      text not null default 'queued' check (status in ('queued','picked','skipped')),
  note        text,
  pair_id     uuid references pairs(id),
  scored_at   timestamptz not null default now(),
  picked_at   timestamptz,
  unique (a_id, b_id)
);
create index if not exists pair_queue_next on pair_queue (status, band, score desc);

-- Brands Scout must never pick, on top of every brand already pitched (any thesis or account).
create table if not exists scout_exclude (
  entity_id   text primary key,
  name        text not null,
  reason      text,
  added_at    timestamptz not null default now()
)
;

-- Venues (18 Oct). Concert rooms near each metro, from Wikidata, scored on the Qloo corpus: which measured
-- audiences concentrate in the venue's city (heatmaps), which artists fit the room's size, and which brands
-- those audiences pull toward. No new Qloo calls: everything comes from the stored measurements.
create table if not exists venues (
  id           text primary key,                 -- Wikidata id
  name         text not null,
  metro        text not null,
  capacity     int,                              -- from Wikidata
  capacity_est int,                              -- capacity, or a typical size for the kind of room
  kinds        text,
  operator     text,
  owner        text,
  site         text,
  lat          double precision,
  lng          double precision,
  live_nation  boolean not null default false,
  score        double precision,
  evidence     jsonb not null default '{}',
  slug         text unique,
  updated_at   timestamptz not null default now()
);

create table if not exists venue_fits (
  venue_id     text not null references venues(id) on delete cascade,
  entity_id    text not null,
  entity_name  text not null,
  entity_type  text not null,
  role         text not null check (role in ('book','sponsor')),
  fit          double precision not null,
  evidence     jsonb not null default '{}',
  primary key (venue_id, entity_id, role)
);

-- Look-alikes (18 Oct). Brands, people and companies Qloo hasn't measured for us: a profile synthesized from
-- public sources in Qloo's tag vocabulary, matched to the nearest measured profiles. Never shown as a Qloo number.
create table if not exists synthetic_profiles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  kind         text not null check (kind in ('brand','talent')),
  description  text,
  tags         jsonb not null default '[]',
  age          jsonb,
  metros       jsonb not null default '[]',
  summary      text,
  confidence   text,
  sources      jsonb not null default '[]',
  lookalikes   jsonb not null default '[]',
  slug         text unique,
  created_at   timestamptz not null default now()
);

create table if not exists pattern_matches (
  profile_id   uuid not null references synthetic_profiles(id) on delete cascade,
  partner_id   text not null,
  partner      text not null,
  partner_type text not null,
  match_pct    int not null,
  evidence     jsonb not null default '[]',
  primary key (profile_id, partner_id)
)
;
-- What a room actually books, read from the web in Qloo's tag vocabulary (18 Oct). Null = scored on city and size only.
alter table venues add column if not exists profile jsonb
