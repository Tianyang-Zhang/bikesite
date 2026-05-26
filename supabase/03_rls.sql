-- ============================================================================
-- BikeSite v2 · Phase 2 · Row-Level Security
-- ============================================================================
-- Apply in the Supabase SQL editor AFTER 01_schema.sql.
--
-- After this runs, the data is properly fenced:
--   * Anonymous users (public booking page) CAN:
--     - read all bikes (bikes.SELECT)
--     - see what dates are taken via the `availability` view (NO renter info)
--     - create a new booking (bookings.INSERT, guarded by CHECKs)
--   * Anonymous users CANNOT:
--     - read renter_name, renter_contact, or any other booking field directly
--     - modify or delete any booking
--     - modify bikes
--   * The signed-in manager (Phase 4 admin page) can do anything.
-- ============================================================================

-- Enable RLS (idempotent: Supabase's "Run and enable RLS" prompt already
-- turned this on during Phase 1; running these again is a no-op).
alter table bikes    enable row level security;
alter table bookings enable row level security;


-- ----------------------------------------------------------------------------
-- bikes — anyone reads; only the manager writes.
-- ----------------------------------------------------------------------------
drop policy if exists bikes_select_public  on bikes;
drop policy if exists bikes_write_manager  on bikes;

create policy bikes_select_public on bikes
  for select
  to anon, authenticated
  using (true);

create policy bikes_write_manager on bikes
  for all
  to authenticated
  using (true)
  with check (true);


-- ----------------------------------------------------------------------------
-- bookings — anon may INSERT (guarded); never SELECT/UPDATE/DELETE.
--            The manager (authenticated) can do anything.
-- ----------------------------------------------------------------------------
drop policy if exists bookings_manager_all     on bookings;
drop policy if exists bookings_insert_public   on bookings;

create policy bookings_manager_all on bookings
  for all
  to authenticated
  using (true)
  with check (true);

-- Public booking insert. The CHECK is the public-facing guardrail:
--   * status must be 'confirmed' (no submitting pre-cancelled bookings)
--   * start_date must be today or future (no back-dating)
--   * duration capped at 30 days (no year-long squats)
--   * name and contact must be non-empty
create policy bookings_insert_public on bookings
  for insert
  to anon
  with check (
    status = 'confirmed'
    and start_date >= current_date
    and (end_date - start_date) <= 30
    and length(trim(renter_name))    > 0
    and length(trim(renter_contact)) > 0
  );

-- Deliberately NO anon SELECT/UPDATE/DELETE policies.
-- RLS denies by default; the public can never read a booking row directly.
-- Anon's window into booked dates is the `availability` view below.


-- ----------------------------------------------------------------------------
-- availability — the contact-free public view.
-- ----------------------------------------------------------------------------
-- security_invoker = false: the view runs as its OWNER (postgres), bypassing
-- the bookings table's RLS. That's deliberate and safe: we hand-pick the three
-- columns the public should see (bike_id, start_date, end_date) — renter info
-- can never leak through this surface no matter what RLS does underneath.
create or replace view availability
  with (security_invoker = false)
as
  select bike_id, start_date, end_date
  from bookings
  where status = 'confirmed';

grant select on availability to anon, authenticated;
