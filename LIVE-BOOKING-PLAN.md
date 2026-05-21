# Plan — BikeSite v2: Live Self-Serve Booking

**Goal:** a **free, live** site where clients **book bikes directly** (instant, no
request form), **double-bookings are physically impossible**, and the manager can
**check / modify / cancel / move** every booking.

---

## Read this first — what v2 is

v2 **replaces** v1. The current setup — build-time-baked static page + Airtable +
the request form + the GitHub Actions build — is retired. The *concept* and the
*bike data* carry over; the architecture is rebuilt.

`DESIGN-DOC.md` deliberately scoped self-serve booking OUT of v1 ("Approach B" /
Booqable). Building it now is a deliberate, eyes-open decision. v2 is a real
(small) web app — more capable, and more to maintain — than v1's static page.

## Architecture — DECISION 1 (committed)

**Supabase (free tier) + two static pages.**

- **Supabase Postgres** = the database. A Postgres `EXCLUDE` constraint makes it
  **physically impossible** to store two overlapping confirmed bookings for the
  same bike — the database itself rejects the second one. This is the *hard*
  double-booking guarantee v1 never had.
- **Supabase Auth** = the manager's login for the admin page.
- **Supabase Realtime** = the public page updates live as bookings happen — no
  staleness, no polling.
- **Two static frontends** — a public booking page and a manager admin page —
  hosted free on GitHub Pages (reuse the existing `bikesite` repo).
- **Supabase Storage** = bike photos.

**Alternative considered:** Airtable + a Cloudflare Worker — keeps Airtable as the
admin console, but conflict-prevention becomes app-level (a tiny race window, not
a hard guarantee). Rejected because an absolute no-double-booking guarantee has
been the priority throughout. → If keeping Airtable as the admin matters more to
you than the hard guarantee, say so before the build session starts and this plan
can be swapped.

## Cost — $0/month

Supabase free tier + GitHub Pages. One caveat: a free Supabase project **pauses
after 7 days of zero activity**. A weekend rental gets weekly activity, so it
won't — and Phase 6 adds a weekly keep-alive ping so it never can. Un-pausing, if
ever needed, is one click.

## Tech stack — pre-decided (don't re-litigate in the build session)

- Backend: **Supabase** (Postgres + Auth + Realtime + Storage).
- Frontend: **plain HTML/CSS/JS + the `@supabase/supabase-js` client** — no
  framework, matching v1's minimalism.
- Hosting: **GitHub Pages**, the existing `Tianyang-Zhang/bikesite` repo.
- The Supabase **anon key** is safe in public client code (public by design;
  Row-Level Security protects the data). The **service_role key** must NEVER
  appear in client code.

## Prerequisites — human steps (do these before / at the start of the build session)

- [ ] Create a free **Supabase** account → new project (region near Milpitas,
  e.g. West US). Save: **Project URL**, **anon key**, **service_role key**,
  **database password**.
- [ ] Decide the manager admin **login email + a strong password**.
- [ ] Have the **bike list** ready: name, type, engine, price/day, a photo each.

---

## Phases & checkpoints

### Phase 1 — Database schema + the no-overlap guarantee
- Enable the `btree_gist` extension.
- `bikes` table: id, name, type, engine, price_per_day, photo_url,
  display_order, active, created_at.
- `bookings` table: id, bike_id → bikes, start_date, end_date, renter_name,
  renter_contact, status ('confirmed' | 'cancelled', default 'confirmed'),
  created_at.
- Constraints: `CHECK (end_date >= start_date)`, and the critical one:
  ```sql
  ALTER TABLE bookings ADD CONSTRAINT no_overlap
    EXCLUDE USING gist (
      bike_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status = 'confirmed');
  ```
  (If `btree_gist` rejects a uuid `bike_id` on this Postgres version, make
  `bikes.id` a `bigint` instead.)
- Seed the bikes.
- **✅ Checkpoint 1:** Insert two confirmed bookings for the *same bike with
  overlapping dates* in the SQL editor → the second is **rejected** by
  `no_overlap`. Double-booking is now physically impossible.

### Phase 2 — Security: Row-Level Security (RLS)
- Enable RLS on both tables.
- `bikes`: anyone may `SELECT`.
- Renter contact info must stay private. Create a public view `availability`
  exposing only `bike_id, start_date, end_date` for confirmed bookings; grant the
  public `SELECT` on the **view only** — never on the `bookings` table.
- `bookings` `INSERT` for the public: allowed, but guarded by `CHECK`s — status
  must be 'confirmed', `start_date >= current_date`, duration within a sane max
  (e.g. ≤ 30 days), name and contact non-empty.
- `bookings` `UPDATE` / `DELETE` / full-row `SELECT`: **authenticated users only**
  (the manager).
- **✅ Checkpoint 2:** As an anonymous user you can read bikes + the `availability`
  view and insert a valid booking, but you **cannot** read anyone's contact info
  and **cannot** edit or delete a booking. As the logged-in manager you can do all
  of it.

### Phase 3 — Public booking page
- Static page: load bikes (+ photos) and the `availability` view via the anon key.
- Per bike: a date picker / calendar showing free vs taken dates.
- Booking form: pick dates, enter name + contact → `insert` into `bookings`.
- If `no_overlap` rejects it → catch the error → friendly "Sorry — those dates
  were just taken, pick another." On success → "Booked! ✓".
- Subscribe to Realtime on `availability` → the page updates live as others book.
- Mobile-first.
- **✅ Checkpoint 3:** Book a bike for a weekend → it shows taken immediately; a
  second browser attempting the same bike + dates is rejected gracefully; no
  renter contact info appears in the page or network traffic.

### Phase 4 — Manager admin page
- A separate `admin.html`. Supabase Auth email+password login (create the manager
  user in Supabase).
- Behind login: a list of all bookings (with contact details) and actions —
  **edit dates ("move"), cancel, delete, add a manual booking, add/edit bikes,
  upload photos** to Storage.
- The manager's authenticated session lets RLS permit all of this.
- **✅ Checkpoint 4:** Log in as the manager → see all bookings incl. contacts →
  move one booking's dates, cancel one, add one manually, add/edit a bike → every
  change appears live on the public page.

### Phase 5 — Deploy
- Host the public page and `admin.html` on GitHub Pages (restructure the repo).
- Wire the production Supabase URL + anon key into the frontend.
- **✅ Checkpoint 5:** The public booking URL and the admin URL both work
  end-to-end from a phone on cellular data.

### Phase 6 — Cutover, keep-alive, cleanup
- Add a small **weekly GitHub Actions cron** running one trivial Supabase query —
  keeps the free project from ever pausing.
- Migrate any real bikes/bookings from Airtable into Supabase.
- Remove v1: `build.mjs`, the `lib/` build modules, the Airtable build /
  conflict-check workflow, the request form. (Git history keeps them.)
- Rewrite `README.md` for the v2 architecture.
- **✅ Checkpoint 6:** The old build-time-baked flow is gone; the live app *is*
  the site; the weekly keep-alive runs; docs match reality.

---

## Honest risks & notes

- **Public writes = an abuse surface.** Anyone can POST a booking. Phase 2's
  `CHECK` constraints blunt it; if spam appears, add a free CAPTCHA (Cloudflare
  Turnstile) as a fast-follow.
- **RLS must be correct** — a wrong policy could expose renter contacts.
  Checkpoint 2 exists to verify this; do not skip it.
- **It's a real app to maintain** — a database, auth, two pages. Supabase carries
  most of the weight, but it is a step up in surface area from v1.
- **Effort:** realistically a few focused build sessions, not one short pass.

## For the build session

The repo is at `/Users/ztytom/Project/BikeSite`; v1 is described in
`DESIGN-DOC.md` and `README.md`. Execute the phases in order. **After each phase,
verify its checkpoint before continuing.** At Phase 1 you'll need the user's
Supabase keys; at Phase 4, the admin login. Treat the `no_overlap` constraint
(Phase 1) as the heart of the system — everything else serves it.
