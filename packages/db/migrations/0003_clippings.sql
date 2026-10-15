-- A page a user saved. `created_at` has no default on purpose: the service stamps it from its
-- clock, so tests control time and the list's keyset cursor round-trips exactly.

create table clippings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" ("id") on delete cascade,
  url text not null,
  url_normalized text not null,
  title text not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  source text not null check (source in ('web', 'extension', 'mcp', 'digest')),
  client_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, url_normalized)
);

-- The list: one user's clippings, newest first, paged by (created_at, id).
create index clippings_user_newest_idx on clippings (user_id, created_at desc, id desc);
