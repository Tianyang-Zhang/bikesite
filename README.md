# BikeSite — live self-serve motorcycle rental + marketplace

A free, live website with three tabs:

- **Rental** (default) — renters book bikes directly. **Double-bookings are
  physically impossible** (enforced by Postgres, not just app code).
- **Sell** — used bikes for sale. Buyer submits a purchase inquiry; manager
  follows up on WeChat.
- **Parts** — accessories / consumables for sale. Same inquire flow with
  quantity support.

The manager can **check / modify / cancel / move** any booking and **add /
edit / delete** rental bikes, sale bikes, parts, and orders from a single
admin page.

- **Public site:** https://tianyang-zhang.github.io/bikesite/ (Rental by default; also `#sell`, `#parts`)
- **Manager console:** https://tianyang-zhang.github.io/bikesite/admin.html

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│   GitHub Pages (free)                                    │
│     docs/index.html  ← public site (Rental / Sell / Parts)│
│     docs/admin.html  ← manager console                   │
│     vanilla HTML/CSS/JS + @supabase/supabase-js (CDN)    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│   Supabase (free tier)                                   │
│     Postgres   ← bikes, bookings, availability           │
│                  sale_bikes, parts, orders               │
│     Auth       ← manager email + password login          │
│     Realtime   ← every open page updates live            │
│     Storage    ← photos (bike-photos bucket; shared by   │
│                  rental, sale, and parts)                │
└──────────────────────────────────────────────────────────┘
```

**Cost: $0/month.** Supabase free tier + GitHub Pages.

A small GitHub Actions cron (`.github/workflows/keep-alive.yml`) hits one Supabase endpoint twice a week so the free project never pauses (the free tier pauses after 7 days idle).

## The heart of the design — Rental

```sql
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    bike_id                               WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'confirmed');
```

Postgres itself refuses to store two overlapping confirmed bookings for the same bike. Not app code that tries to prevent it — the database physically cannot store conflicting data. When an insert violates the constraint the frontend catches the `23P01` error and shows: *"Sorry — those dates were just taken on this bike. Pick different dates."*

## The heart of the design — Sell + Parts

A single payment-ready `orders` table captures purchase intent for both
sale bikes and parts:

```sql
create table orders (
  id                  bigint        primary key generated always as identity,
  item_type           text          check (item_type in ('sale_bike', 'part')),
  item_id             bigint,
  qty                 integer,
  unit_price          numeric,
  total_price         numeric,
  buyer_name          text,
  buyer_contact       text,                                   -- WeChat ID
  status              text          check (status in
                        ('pending', 'paid', 'fulfilled', 'cancelled')),
  payment_provider    text,                                   -- 'stripe' / null
  payment_session_id  text,
  payment_intent_id   text,
  notes               text,
  created_at          timestamptz   default now()
);
```

Today every inquiry comes in as `status='pending'` with all `payment_*` fields
null. The manager messages the buyer on WeChat and updates the status
manually.

**Tomorrow**, when a payment provider is wired up (Stripe Checkout is the
obvious one), the change is server-side only: a Supabase Edge Function
turns the pending order into a Checkout Session and writes `session_id` +
`payment_provider='stripe'`; a webhook updates the status to `paid`. The
public frontend doesn't need to change. See **`ARCHITECTURE-MARKETPLACE.md`**
for the full plan.

## How the data is fenced

Row-Level Security (`supabase/03_rls.sql` for rentals, `supabase/06_marketplace.sql`
for marketplace):

- **Anonymous clients** (the public site) can:
  - Read every rental bike (`bikes.SELECT`)
  - Read the contact-free `availability` view (only `bike_id`, `start_date`, `end_date`)
  - Insert new bookings — guarded by CHECKs: `status='confirmed'`, `start_date >= current_date`, `duration <= 30 days`, non-empty name and contact.
  - Read every active sale bike via the `sale_bikes_public` view
  - Read every active part via the `parts_public` view
  - Insert new orders — guarded by CHECKs: `status='pending'`, all `payment_*` null,
    `qty >= 1`, `total_price = qty * unit_price`, non-empty buyer name and contact,
    valid `item_type`.
- **Anonymous clients cannot** read renter names/contacts, read other people's
  orders, edit or delete any booking or order, or modify any inventory.
- **The authenticated manager** (signed in via the admin page) can do all of it.

The `service_role` key is never used by the frontend and is never written
to the repo. Only the **anon** (publishable) key appears in
`docs/supabase-config.js`, where it belongs.

## Repository layout

```
docs/                            ← what GitHub Pages serves
  index.html                     ← public site (three hash-routed tabs)
  admin.html                     ← manager console
  app.js                         ← tab router (loads each tab module on demand)
  lib.js                         ← shared helpers (supabase client, channel, esc, toast)
  booking.js                     ← Rental tab module
  sell.js                        ← Sell tab module
  parts.js                       ← Parts tab module
  admin.js                       ← manager-console logic
  styles.css, admin.css
  supabase-config.js             ← Project URL + anon key (public by design)
  .nojekyll                      ← Pages serves files as-is

supabase/
  01_schema.sql                  ← rental tables + the no_overlap constraint
  03_rls.sql                     ← RLS policies + the availability view
  04_storage.sql                 ← bike-photos bucket (also reused by sale/parts)
  05_site_settings.sql           ← editable site name + tagline
  06_marketplace.sql             ← sale_bikes + parts + orders + RLS + public views
  checkpoint1_test.sql           ← self-rolling-back proof of no_overlap
  README.md

.github/workflows/
  keep-alive.yml                 ← Mon/Thu cron, keeps Supabase awake

ARCHITECTURE-MARKETPLACE.md      ← how Sell/Parts work + payment integration plan
DESIGN-DOC.md                    ← v1 rationale (kept for context)
LIVE-BOOKING-PLAN.md             ← v2 build plan (kept for context)
```

## Local development

```sh
python3 -m http.server 8000 --directory docs
# Open:
#   http://localhost:8000/         → Rental tab (default)
#   http://localhost:8000/#sell    → Sell tab
#   http://localhost:8000/#parts   → Parts tab
#   http://localhost:8000/admin.html
```

## Deployment

`docs/` is the GitHub Pages source (**Settings → Pages → "Deploy from a branch" → `main` / `/docs`**). Any push to `main` that changes `docs/` triggers an automatic redeploy.

## Applying the schema

The SQL files in `supabase/` apply manually in the Supabase SQL editor, in
order:

1. `01_schema.sql`           (rentals)
2. `03_rls.sql`              (rental RLS)
3. `04_storage.sql`          (photos)
4. `05_site_settings.sql`    (editable site name + tagline)
5. `06_marketplace.sql`      (sale_bikes + parts + orders)  ← **new**

Each file is idempotent — re-running is a no-op.

## Adding rental bikes / sale bikes / parts

Sign in to the manager console. Each section has a `+ Add` button that
opens the same kind of modal as the rental flow. Photos can be pasted as a
URL or uploaded from the device; uploads land in the public `bike-photos`
bucket and the public URL is filled in automatically.

## Managing bookings + orders

The manager console lists every booking with renter contacts (visible only when signed in). Edit dates, **cancel** (status → `cancelled`, the dates immediately free up for re-booking — the `no_overlap` constraint only applies to confirmed rows), or delete.

Orders behave the same way: every inquiry shows up in the **Orders** card
as `pending`. Move it through `paid` → `fulfilled` (or `cancelled`) as
you go. Every change appears on the public page live via Realtime
broadcast.

## Manual database changes

For ad-hoc work, use the Supabase **SQL Editor** under your project. Always run as the default `postgres` role — `service_role` is for emergencies only and must never reach client code.
