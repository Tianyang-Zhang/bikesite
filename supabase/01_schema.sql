-- ============================================================================
-- BikeSite v2 · Phase 1 · Database schema + the no-overlap guarantee
-- ============================================================================
-- Apply this FIRST, in the Supabase SQL editor:
--   SQL Editor  ->  New query  ->  paste this whole file  ->  Run
--
-- The heart of v2 is the `no_overlap` constraint near the bottom. Once it
-- exists, Postgres itself refuses to store two overlapping confirmed bookings
-- for the same bike -- double-booking becomes physically impossible, not just
-- something app code tries to prevent.
-- ============================================================================

-- btree_gist lets one GiST index combine equality (=) on bike_id with
-- range-overlap (&&) on the dates. The no_overlap constraint needs it.
create extension if not exists btree_gist;


-- ----------------------------------------------------------------------------
-- bikes -- the rentable bikes.
-- ----------------------------------------------------------------------------
create table bikes (
  id            bigint        generated always as identity primary key,
  name          text          not null,
  type          text          not null,
  engine        text,
  price_per_day numeric(10,2) not null check (price_per_day >= 0),
  photo_url     text,
  display_order integer       not null default 0,
  active        boolean       not null default true,
  created_at    timestamptz   not null default now()
);

-- id is a bigint (not uuid) on purpose: the no_overlap constraint below builds
-- a GiST index on bike_id, and bigint is the safest type for that on every
-- Postgres version. LIVE-BOOKING-PLAN.md Phase 1 calls out this exact choice.


-- ----------------------------------------------------------------------------
-- bookings -- one row per reservation.
-- ----------------------------------------------------------------------------
create table bookings (
  id             bigint      generated always as identity primary key,
  bike_id        bigint      not null references bikes (id) on delete restrict,
  start_date     date        not null,
  end_date       date        not null,
  renter_name    text        not null,
  renter_contact text        not null,
  status         text        not null default 'confirmed'
                   check (status in ('confirmed', 'cancelled')),
  created_at     timestamptz not null default now(),

  -- A booking can't end before it starts.
  constraint valid_dates check (end_date >= start_date)
);

-- Note: the public-facing guards (start_date must be in the future, a sane max
-- duration, non-empty name/contact) are intentionally NOT table constraints --
-- those would also block the manager from recording, say, a booking that
-- started yesterday. They live in the public INSERT policy in Phase 2
-- (03_rls.sql), where they apply to anonymous users only.


-- ----------------------------------------------------------------------------
-- THE GUARANTEE -- no two confirmed bookings for one bike may overlap.
-- ----------------------------------------------------------------------------
-- daterange(start, end, '[]') is inclusive of BOTH ends, so a booking ending
-- the 14th and another starting the 14th DO conflict -- correct, because the
-- bike physically cannot be handed to two renters on the same day.
--
-- `where (status = 'confirmed')` makes it a partial constraint: cancelling a
-- booking (status -> 'cancelled') instantly frees its dates for re-booking.
alter table bookings
  add constraint no_overlap
  exclude using gist (
    bike_id                               with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status = 'confirmed');


-- Speeds up the public availability lookups added in Phase 2.
create index bookings_confirmed_bike_dates_idx
  on bookings (bike_id, start_date, end_date)
  where status = 'confirmed';
