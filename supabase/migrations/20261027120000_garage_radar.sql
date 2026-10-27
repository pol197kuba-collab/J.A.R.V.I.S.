-- =========================================================================
-- GARAGE RADAR — osobna aplikacja (repo pol197kuba-collab/Car-Market-Monitor)
-- w tym samym projekcie Supabase.
--
-- Darmowy plan Supabase ma limit 2 aktywnych projektów, więc Garage Radar
-- korzysta z bazy J.A.R.V.I.S.-a. Wszystko jest w osobnym schemacie
-- garage_radar: tabele, funkcje (garage_radar.handle_new_user,
-- garage_radar.set_updated_at) i polityki RLS. Schemat public J.A.R.V.I.S.-a
-- nie jest dotykany — nazwy public.profiles, handle_new_user, set_updated_at
-- by się pokryły, stąd osobny schemat. Trigger na auth.users ma unikalną
-- nazwę garage_radar_on_auth_user_created (on_auth_user_created należy do
-- J.A.R.V.I.S.-a).
--
-- Konta są wspólne: do Garage Radar logujesz się kontem J.A.R.V.I.S.-a, a
-- enforce_owner_only_signup obejmuje też tę aplikację.
--
-- Źródło: supabase/migrations/20261026120000_init.sql w repo Garage Radar
-- (treść poniżej jest jego kopią). Po wgraniu: Integrations → Data API →
-- Settings → Exposed schemas → zaznaczyć garage_radar (TODO.md, sekcja 0).
-- =========================================================================

-- Garage Radar — initial schema.
--
-- Design notes
-- * Every user-owned row carries user_id; RLS restricts all access to the owner.
-- * Child tables reference parents through composite (id, user_id) foreign keys,
--   so a row can never point at another user's data even if a client sends a
--   foreign id.
-- * Source data (listings) is separated from user-entered data
--   (listing_user_data, listing_notes). Refreshing an advert only touches
--   listings, so notes, ratings and viewing details are never overwritten.
-- * Demo data is never stored in the database (portal 'demo' is not allowed).
-- * Enumerations are text + CHECK constraints: easy to extend in later migrations.
-- * Everything lives in its own schema, garage_radar, so the app can share a
--   Supabase project with another app (whose public.profiles, handle_new_user,
--   set_updated_at… stay untouched). The schema must be added to
--   "Exposed schemas" in the Data API settings.

create schema garage_radar;

-- anon gets no access at all; the app always acts as a signed-in user or as the server.
revoke all on schema garage_radar from public;
grant usage on schema garage_radar to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function garage_radar.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & settings
-- ---------------------------------------------------------------------------

create table garage_radar.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on garage_radar.profiles
  for each row execute function garage_radar.set_updated_at();

-- Creates the profile row for every new auth user.
create or replace function garage_radar.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into garage_radar.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger garage_radar_on_auth_user_created after insert on auth.users
  for each row execute function garage_radar.handle_new_user();

-- ---------------------------------------------------------------------------
-- Vehicles: groups listings the user confirmed as the same physical vehicle
-- (e.g. one car advertised on Otomoto and OLX). Never filled automatically.
-- ---------------------------------------------------------------------------

create table garage_radar.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Listings (source data, normalised, portal-independent)
-- ---------------------------------------------------------------------------

create table garage_radar.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vehicle_id uuid,

  -- Source
  portal text not null check (portal in ('otomoto', 'olx', 'manual', 'other')),
  provider_id text check (char_length(provider_id) <= 40),
  source_url text check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 2048)),
  external_id text check (char_length(external_id) <= 120),
  title text check (char_length(title) <= 300),
  photos text[] not null default '{}' check (cardinality(photos) <= 60),
  published_at timestamptz,
  price numeric(12, 2) check (price is null or price >= 0),
  currency text not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  previous_price numeric(12, 2) check (previous_price is null or previous_price >= 0),

  -- Vehicle specification
  vehicle_type text not null default 'car' check (vehicle_type in ('car', 'motorcycle', 'other')),
  make text check (char_length(make) <= 80),
  model text check (char_length(model) <= 80),
  version text check (char_length(version) <= 160),
  generation text check (char_length(generation) <= 80),
  year smallint check (year between 1886 and 2100),
  first_registration date,
  mileage_km integer check (mileage_km between 0 and 5000000),
  fuel_type text check (fuel_type in ('petrol', 'diesel', 'lpg', 'hybrid', 'plugin_hybrid', 'electric', 'cng', 'hydrogen', 'other')),
  engine_capacity_cm3 integer check (engine_capacity_cm3 between 0 and 20000),
  power_hp integer check (power_hp between 0 and 3000),
  power_kw integer check (power_kw between 0 and 2500),
  gearbox text check (gearbox in ('manual', 'automatic', 'other')),
  body_type text check (body_type in ('sedan', 'hatchback', 'kombi', 'suv', 'coupe', 'cabrio', 'van', 'minivan', 'pickup', 'naked', 'sport', 'touring', 'enduro', 'cruiser', 'scooter', 'other')),
  drive text check (drive in ('fwd', 'rwd', 'awd', 'other')),
  color text check (char_length(color) <= 60),
  vin text check (char_length(vin) <= 17),
  country_of_origin text check (char_length(country_of_origin) <= 60),
  equipment text[] not null default '{}' check (cardinality(equipment) <= 300),
  description text check (char_length(description) <= 20000),

  -- Location (approximate unless geo_accuracy = 'exact')
  country text check (char_length(country) <= 60),
  region text check (char_length(region) <= 80),
  city text check (char_length(city) <= 120),
  postal_code text check (char_length(postal_code) <= 12),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geo_source text not null default 'none' check (geo_source in ('listing', 'geocoded', 'user', 'none')),
  geo_accuracy text not null default 'unknown' check (geo_accuracy in ('exact', 'postal_code', 'city', 'region', 'country', 'unknown')),
  geocode_status text not null default 'pending' check (geocode_status in ('ok', 'pending', 'failed', 'not_needed', 'manual')),

  -- Monitoring state
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  fetch_state text not null default 'never' check (fetch_state in ('ok', 'partial', 'error', 'blocked', 'retry_pending', 'never')),
  availability text not null default 'unknown' check (availability in ('active', 'probably_unavailable', 'confirmed_unavailable', 'unknown')),
  fetch_message text check (char_length(fetch_message) <= 500),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  checksum text check (char_length(checksum) <= 128),
  next_refresh_at timestamptz,

  manual_overrides text[] not null default '{}',
  unread_changes integer not null default 0 check (unread_changes >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),
  constraint listings_coordinates_pair check ((lat is null) = (lng is null)),
  constraint listings_vehicle_fk foreign key (vehicle_id, user_id) references garage_radar.vehicles (id, user_id) on delete set null (vehicle_id)
);

create trigger listings_updated_at before update on garage_radar.listings
  for each row execute function garage_radar.set_updated_at();

-- The same advert cannot be stored twice by the same user.
create unique index listings_user_url_key on garage_radar.listings (user_id, source_url) where source_url is not null;
create unique index listings_user_external_key on garage_radar.listings (user_id, portal, external_id) where external_id is not null;

-- Filtering / sorting (all queries are scoped by user_id).
create index listings_user_created_idx on garage_radar.listings (user_id, created_at desc);
create index listings_user_price_idx on garage_radar.listings (user_id, price);
create index listings_user_year_idx on garage_radar.listings (user_id, year);
create index listings_user_mileage_idx on garage_radar.listings (user_id, mileage_km);
create index listings_user_make_model_idx on garage_radar.listings (user_id, lower(make), lower(model));
create index listings_user_last_success_idx on garage_radar.listings (user_id, last_success_at desc);
create index listings_user_geo_idx on garage_radar.listings (user_id, lat, lng) where lat is not null;
create index listings_vehicle_idx on garage_radar.listings (vehicle_id) where vehicle_id is not null;
-- Background refresh scheduler.
create index listings_refresh_due_idx on garage_radar.listings (next_refresh_at) where source_url is not null and next_refresh_at is not null;

-- ---------------------------------------------------------------------------
-- User-entered data (never touched by refresh)
-- ---------------------------------------------------------------------------

create table garage_radar.listing_user_data (
  listing_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stage text not null default 'new' check (stage in ('new', 'to_check', 'to_contact', 'contacted', 'viewing_scheduled', 'viewed', 'negotiating', 'rejected', 'bought')),
  priority smallint not null default 0 check (priority between 0 and 3),
  rating smallint check (rating between 1 and 5),
  favorite boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 20000),
  contact_at timestamptz,
  viewing_at timestamptz,
  viewing_notes text not null default '' check (char_length(viewing_notes) <= 2000),
  decision text not null default 'undecided' check (decision in ('undecided', 'positive', 'negative')),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  costs jsonb not null default '{}'::jsonb check (jsonb_typeof(costs) = 'object'),
  own_photos text[] not null default '{}' check (cardinality(own_photos) <= 60),
  updated_at timestamptz not null default now(),
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create trigger listing_user_data_updated_at before update on garage_radar.listing_user_data
  for each row execute function garage_radar.set_updated_at();

create index listing_user_data_user_stage_idx on garage_radar.listing_user_data (user_id, stage);
create index listing_user_data_viewing_idx on garage_radar.listing_user_data (viewing_at) where viewing_at is not null;

create table garage_radar.listing_notes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'general' check (kind in ('general', 'call', 'viewing')),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create index listing_notes_listing_idx on garage_radar.listing_notes (listing_id, created_at desc);

-- ---------------------------------------------------------------------------
-- History & monitoring
-- ---------------------------------------------------------------------------

create table garage_radar.listing_price_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  observed_at timestamptz not null default now(),
  source text not null check (source in ('import', 'refresh', 'manual')),
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create index listing_price_history_listing_idx on garage_radar.listing_price_history (listing_id, observed_at);

create table garage_radar.listing_snapshots (
  id bigint generated always as identity primary key,
  listing_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fetched_at timestamptz not null default now(),
  http_status integer,
  status text not null check (status in ('success', 'partial', 'failed', 'blocked', 'unsupported')),
  checksum text,
  data jsonb not null default '{}'::jsonb,
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create index listing_snapshots_listing_idx on garage_radar.listing_snapshots (listing_id, fetched_at desc);

create table garage_radar.listing_events (
  id bigint generated always as identity primary key,
  listing_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('imported', 'created_manually', 'price_drop', 'price_rise', 'mileage_changed', 'description_changed', 'params_changed', 'photos_changed', 'availability_changed', 'refresh_failed', 'refreshed_no_changes')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create index listing_events_listing_idx on garage_radar.listing_events (listing_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Collections (many independent search profiles, e.g. cars vs motorcycles)
-- ---------------------------------------------------------------------------

create table garage_radar.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table garage_radar.collection_items (
  collection_id uuid not null,
  listing_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, listing_id),
  foreign key (collection_id, user_id) references garage_radar.collections (id, user_id) on delete cascade,
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

create index collection_items_listing_idx on garage_radar.collection_items (listing_id);

-- ---------------------------------------------------------------------------
-- Route plans
-- ---------------------------------------------------------------------------

create table garage_radar.route_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  plan_date date,
  start_time time,
  origin jsonb check (origin is null or jsonb_typeof(origin) = 'object'),
  destination jsonb check (destination is null or jsonb_typeof(destination) = 'object'),
  return_to_origin boolean not null default true,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create trigger route_plans_updated_at before update on garage_radar.route_plans
  for each row execute function garage_radar.set_updated_at();

create table garage_radar.route_stops (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  listing_id uuid,
  position integer not null check (position >= 0),
  label text not null check (char_length(label) between 1 and 200),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  dwell_minutes integer not null default 45 check (dwell_minutes between 0 and 600),
  priority smallint not null default 0 check (priority between 0 and 3),
  foreign key (plan_id, user_id) references garage_radar.route_plans (id, user_id) on delete cascade,
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete set null (listing_id)
);

create index route_stops_plan_idx on garage_radar.route_stops (plan_id, position);

-- ---------------------------------------------------------------------------
-- Jobs (audit + rate limiting + refresh queue)
-- ---------------------------------------------------------------------------

create table garage_radar.import_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (char_length(url) <= 2048),
  provider_id text,
  status text not null check (status in ('success', 'partial', 'failed', 'blocked', 'unsupported', 'invalid_url')),
  http_status integer,
  message text check (char_length(message) <= 500),
  created_at timestamptz not null default now()
);

create index import_jobs_user_created_idx on garage_radar.import_jobs (user_id, created_at desc);

create table garage_radar.refresh_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  listing_id uuid not null,
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete cascade
);

-- At most one pending job per listing.
create unique index refresh_jobs_pending_key on garage_radar.refresh_jobs (listing_id) where status in ('queued', 'running');
create index refresh_jobs_due_idx on garage_radar.refresh_jobs (status, run_after);
create index refresh_jobs_user_created_idx on garage_radar.refresh_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------

create table garage_radar.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('price_drop', 'price_rise', 'params_changed', 'unavailable', 'refresh_completed', 'refresh_failed', 'viewing_upcoming', 'system')),
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 1000),
  listing_id uuid,
  route_plan_id uuid,
  dedupe_key text check (char_length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (listing_id, user_id) references garage_radar.listings (id, user_id) on delete set null (listing_id),
  foreign key (route_plan_id, user_id) references garage_radar.route_plans (id, user_id) on delete set null (route_plan_id)
);

create unique index user_notifications_dedupe_key on garage_radar.user_notifications (user_id, dedupe_key) where dedupe_key is not null;
create index user_notifications_user_created_idx on garage_radar.user_notifications (user_id, created_at desc);
create index user_notifications_unread_idx on garage_radar.user_notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Shared geocoding cache (no personal data; server-side access only)
-- ---------------------------------------------------------------------------

create table garage_radar.geocode_cache (
  query text primary key check (char_length(query) <= 300),
  results jsonb not null,
  provider text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table garage_radar.profiles enable row level security;
alter table garage_radar.vehicles enable row level security;
alter table garage_radar.listings enable row level security;
alter table garage_radar.listing_user_data enable row level security;
alter table garage_radar.listing_notes enable row level security;
alter table garage_radar.listing_price_history enable row level security;
alter table garage_radar.listing_snapshots enable row level security;
alter table garage_radar.listing_events enable row level security;
alter table garage_radar.collections enable row level security;
alter table garage_radar.collection_items enable row level security;
alter table garage_radar.route_plans enable row level security;
alter table garage_radar.route_stops enable row level security;
alter table garage_radar.import_jobs enable row level security;
alter table garage_radar.refresh_jobs enable row level security;
alter table garage_radar.user_notifications enable row level security;
-- RLS on, no policies: only the service role (server) can use the cache.
alter table garage_radar.geocode_cache enable row level security;

create policy "profiles: owner reads" on garage_radar.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner updates" on garage_radar.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: owner inserts" on garage_radar.profiles for insert to authenticated with check (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'vehicles', 'listings', 'listing_user_data', 'listing_notes', 'listing_price_history',
    'listing_snapshots', 'listing_events', 'collections', 'collection_items', 'route_plans',
    'route_stops', 'import_jobs', 'refresh_jobs', 'user_notifications'
  ]
  loop
    execute format(
      'create policy %I on garage_radar.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || ': owner only', t
    );
  end loop;
end;
$$;

-- Explicit privileges (do not rely on project defaults). anon gets nothing.
revoke all on all tables in schema garage_radar from anon;
grant select, insert, update, delete on all tables in schema garage_radar to authenticated;
revoke all on garage_radar.geocode_cache from authenticated;
grant usage, select on all sequences in schema garage_radar to authenticated;
grant all on all tables in schema garage_radar to service_role;
grant all on all sequences in schema garage_radar to service_role;
