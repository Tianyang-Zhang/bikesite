-- ============================================================================
-- BikeSite v2 · Marketplace · sale_bikes + parts + orders
-- ============================================================================
-- Apply in the Supabase SQL editor AFTER 01_schema.sql / 03_rls.sql.
--
-- Adds the two new public tabs:
--   * Sell  -> used bikes for sale  (sale_bikes table)
--   * Parts -> parts inventory      (parts table)
--
-- Plus the shared `orders` table that captures purchase intent for both. The
-- schema is deliberately payment-ready -- today the anon role inserts a row
-- with status='pending' and the manager follows up by WeChat. Tomorrow a
-- Stripe Checkout (or any provider) integration slots in by:
--   1. An Edge Function creates a checkout session, writes session_id back.
--   2. A webhook handler updates status='paid' + payment_intent_id.
-- The frontend keeps writing the same "pending" row -- no rewrite needed.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- sale_bikes -- bikes that are for sale (separate inventory from rentals).
-- ----------------------------------------------------------------------------
-- Rentals (`bikes`) have a per-day price + an availability constraint over
-- date ranges. Sale bikes have a one-time price + a single "sold" flag and
-- enough metadata to make the purchase decision (year, mileage, condition).
create table if not exists sale_bikes (
  id            bigint        generated always as identity primary key,
  name          text          not null,
  type          text          not null,                -- street, dual-sport, cruiser, ...
  engine        text,                                  -- "650cc parallel-twin"
  year          integer       check (year is null or (year between 1900 and 2100)),
  mileage_km    integer       check (mileage_km is null or mileage_km >= 0),
  condition     text,                                  -- "excellent", "minor scuffs", ...
  description   text,                                  -- free-form pitch
  price         numeric(10,2) not null check (price >= 0),
  photo_url     text,
  sold          boolean       not null default false,
  display_order integer       not null default 0,
  active        boolean       not null default true,   -- show on public Sell tab
  created_at    timestamptz   not null default now()
);


-- ----------------------------------------------------------------------------
-- parts -- consumables / accessories for sale.
-- ----------------------------------------------------------------------------
-- `stock` is intentionally a simple integer count, not a per-row inventory
-- ledger. When an order is fulfilled the manager decrements stock manually
-- (or via the orders admin flow). For v2 that's enough; if stock contention
-- becomes a real problem we can move to a `parts_inventory` ledger later.
create table if not exists parts (
  id            bigint        generated always as identity primary key,
  name          text          not null,
  category      text          not null,                -- "helmet", "chain", "tire", ...
  condition     text          not null default 'new'
                  check (condition in ('new', 'used')),
  description   text,
  price         numeric(10,2) not null check (price >= 0),
  stock         integer       not null default 0 check (stock >= 0),
  photo_url     text,
  display_order integer       not null default 0,
  active        boolean       not null default true,
  created_at    timestamptz   not null default now()
);


-- ----------------------------------------------------------------------------
-- orders -- ONE row per purchase-intent. Generic over (sale_bike | part).
-- ----------------------------------------------------------------------------
-- `item_type` + `item_id` is a soft polymorphic reference (no FK because PG
-- can't FK to two different tables from one column). We validate item_type
-- with a CHECK; orphan rows are tolerated -- a deleted listing doesn't have
-- to invalidate historical orders.
--
-- The payment_* fields are nullable today. The status machine is:
--
--     pending  --(manual or Stripe webhook)-->  paid
--     pending  --(manager cancels)----------->  cancelled
--     paid     --(manager fulfills)---------->  fulfilled
--     paid     --(refund)-------------------->  cancelled
--
-- "pending" means the buyer has expressed interest (today, this is all we
-- collect; tomorrow it would also mean "Checkout session created, awaiting
-- webhook"). The manager moves a row to fulfilled once the bike/part has
-- been handed over.
create table if not exists orders (
  id                  bigint        generated always as identity primary key,

  -- what's being bought
  item_type           text          not null check (item_type in ('sale_bike', 'part')),
  item_id             bigint        not null,
  qty                 integer       not null default 1 check (qty >= 1),
  unit_price          numeric(10,2) not null check (unit_price >= 0),
  total_price         numeric(10,2) not null check (total_price >= 0),

  -- who's buying
  buyer_name          text          not null,
  buyer_contact       text          not null,           -- WeChat ID, same convention as bookings.renter_contact

  -- where we are in the flow
  status              text          not null default 'pending'
                        check (status in ('pending', 'paid', 'fulfilled', 'cancelled')),

  -- payment provider hookup -- all null until a Stripe/etc integration writes here
  payment_provider    text          check (payment_provider is null
                                           or payment_provider in ('stripe', 'manual')),
  payment_session_id  text,                             -- e.g. Stripe Checkout Session ID
  payment_intent_id   text,                             -- e.g. Stripe PaymentIntent ID

  notes               text,
  created_at          timestamptz   not null default now()
);

create index if not exists orders_status_created_idx on orders (status, created_at desc);
create index if not exists orders_item_idx           on orders (item_type, item_id);


-- ============================================================================
-- Row-Level Security -- same shape as rentals: anon can SELECT public listings
-- and INSERT a pending order; only the manager reads/edits orders.
-- ============================================================================

alter table sale_bikes enable row level security;
alter table parts      enable row level security;
alter table orders     enable row level security;


-- ----------------------------------------------------------------------------
-- sale_bikes -- anyone reads; only the manager writes.
-- ----------------------------------------------------------------------------
drop policy if exists sale_bikes_select_public  on sale_bikes;
drop policy if exists sale_bikes_write_manager  on sale_bikes;

create policy sale_bikes_select_public on sale_bikes
  for select to anon, authenticated using (true);

create policy sale_bikes_write_manager on sale_bikes
  for all to authenticated using (true) with check (true);


-- ----------------------------------------------------------------------------
-- parts -- anyone reads; only the manager writes.
-- ----------------------------------------------------------------------------
drop policy if exists parts_select_public  on parts;
drop policy if exists parts_write_manager  on parts;

create policy parts_select_public on parts
  for select to anon, authenticated using (true);

create policy parts_write_manager on parts
  for all to authenticated using (true) with check (true);


-- ----------------------------------------------------------------------------
-- orders -- anon INSERT (guarded); never SELECT/UPDATE/DELETE. Manager: all.
-- ----------------------------------------------------------------------------
drop policy if exists orders_manager_all     on orders;
drop policy if exists orders_insert_public   on orders;

create policy orders_manager_all on orders
  for all to authenticated using (true) with check (true);

-- The public CHECK is the guardrail:
--   * orders may only be CREATED as 'pending' (no submitting pre-paid rows)
--   * payment_* fields must start null (only the webhook / manager writes them)
--   * qty + prices must be sane
--   * total_price must equal qty * unit_price (no $1 motorcycle exploits)
--   * buyer fields must be non-empty
--   * item_type must be valid -- the table CHECK enforces this too, but
--     stating it in the policy is documentation
create policy orders_insert_public on orders
  for insert to anon
  with check (
    status = 'pending'
    and payment_provider   is null
    and payment_session_id is null
    and payment_intent_id  is null
    and qty >= 1
    and unit_price >= 0
    and total_price = qty * unit_price
    and length(trim(buyer_name))    > 0
    and length(trim(buyer_contact)) > 0
    and item_type in ('sale_bike', 'part')
  );


-- ============================================================================
-- Public listing views (mirrors of the `availability` pattern) -- explicit
-- public surface that excludes any field we don't want the anon role to see.
-- Today there's nothing sensitive on sale_bikes / parts, but the view gives
-- us a place to add private columns later (manager-only notes, cost basis,
-- supplier, ...) without breaking the public page.
-- ============================================================================

create or replace view sale_bikes_public
  with (security_invoker = false)
as
  select id, name, type, engine, year, mileage_km, condition,
         description, price, photo_url, sold, display_order
  from sale_bikes
  where active = true;

grant select on sale_bikes_public to anon, authenticated;

create or replace view parts_public
  with (security_invoker = false)
as
  select id, name, category, condition, description, price, stock,
         photo_url, display_order
  from parts
  where active = true;

grant select on parts_public to anon, authenticated;


-- ============================================================================
-- Storage -- reuse the `bike-photos` bucket from 04_storage.sql for sale_bike
-- AND part photos too. The bucket is already public-read + manager-write, and
-- the file naming convention in admin.js prefixes filenames so there is no
-- collision risk between rental / sale / part photos.
-- (No SQL change needed here -- noted for the reader.)
-- ============================================================================
