# BikeSite — live self-serve motorcycle rental

A free, live website where renters **book bikes directly**, **double-bookings are physically impossible** (enforced by Postgres, not just app code), and the manager can **check / modify / cancel / move** any booking from a single admin page.

- **Public booking page:** https://tianyang-zhang.github.io/bikesite/
- **Manager console:** https://tianyang-zhang.github.io/bikesite/admin.html

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│   GitHub Pages (free)                                    │
│     docs/index.html  ← public booking page               │
│     docs/admin.html  ← manager console                   │
│     vanilla HTML/CSS/JS + @supabase/supabase-js (CDN)    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│   Supabase (free tier)                                   │
│     Postgres   ← `bikes`, `bookings`, `availability`     │
│     Auth       ← manager email + password login          │
│     Realtime   ← every open page updates live            │
│     Storage    ← bike photos (optional)                  │
└──────────────────────────────────────────────────────────┘
```

**Cost: $0/month.** Supabase free tier + GitHub Pages.

A small GitHub Actions cron (`.github/workflows/keep-alive.yml`) hits one Supabase endpoint twice a week so the free project never pauses (the free tier pauses after 7 days idle).

## The heart of the design

```sql
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    bike_id                               WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'confirmed');
```

Postgres itself refuses to store two overlapping confirmed bookings for the same bike. Not app code that tries to prevent it — the database physically cannot store conflicting data. When an insert violates the constraint the frontend catches the `23P01` error and shows: *"Sorry — those dates were just taken on this bike. Pick different dates."*

## How the data is fenced

Row-Level Security (`supabase/03_rls.sql`):

- **Anonymous clients** (the public booking page) can:
  - Read every bike (`bikes.SELECT`)
  - Read the contact-free `availability` view (only `bike_id`, `start_date`, `end_date`)
  - Insert new bookings — guarded by CHECKs: `status = 'confirmed'`, `start_date >= current_date`, `duration ≤ 30 days`, non-empty name and contact.
- **Anonymous clients cannot** read renter names or contacts, edit any booking, or modify bikes.
- **The authenticated manager** (signed in via the admin page) can do all of it.

The `service_role` key is never used by the frontend and is never written to the repo. Only the **anon** key appears in `docs/supabase-config.js`, where it belongs.

## Repository layout

```
docs/                        ← what GitHub Pages serves
  index.html                 ← public booking page
  admin.html                 ← manager console
  booking.js, admin.js
  styles.css, admin.css
  supabase-config.js         ← Project URL + anon key (public by design)
  .nojekyll                  ← Pages serves files as-is

supabase/
  01_schema.sql              ← tables + the no_overlap constraint
  03_rls.sql                 ← RLS policies + the availability view
  checkpoint1_test.sql       ← self-rolling-back proof of no_overlap
  README.md

.github/workflows/
  keep-alive.yml             ← Mon/Thu cron, keeps Supabase awake

DESIGN-DOC.md                ← v1 rationale (kept for context)
LIVE-BOOKING-PLAN.md         ← v2 build plan (kept for context)
```

## Local development

```sh
python3 -m http.server 8000 --directory docs
# then open http://localhost:8000/ (public) or /admin.html (manager)
```

## Deployment

`docs/` is the GitHub Pages source (**Settings → Pages → "Deploy from a branch" → `main` / `/docs`**). Any push to `main` that changes `docs/` triggers an automatic redeploy.

## Adding a bike

1. Sign in to the manager console.
2. Bikes → **+ Add bike**.
3. Fill name, type, engine, price/day, optionally a photo URL.
4. The bike appears on the public page instantly (Realtime broadcast).

## Managing bookings

The manager console lists every booking with renter contacts (visible only when signed in). Edit dates, **cancel** (status → `cancelled`, the dates immediately free up for re-booking — the `no_overlap` constraint only applies to confirmed rows), or delete. Every change appears on the public page live.

## Manual database changes

For ad-hoc work, use the Supabase **SQL Editor** under your project. Always run as the default `postgres` role — `service_role` is for emergencies only and must never reach client code.
