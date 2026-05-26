# supabase/ — BikeSite v2 database

SQL for the v2 backend (Supabase Postgres). Apply files in the Supabase
**SQL Editor** in numeric order: SQL Editor → New query → paste → Run.

| File | Phase | Purpose |
|------|-------|---------|
| `01_schema.sql` | 1 | `bikes` + `bookings` tables and the `no_overlap` constraint — the rule that makes double-booking physically impossible. |
| `checkpoint1_test.sql` | 1 | Verifies `no_overlap`. Rolls itself back; changes nothing. |
| `02_seed.sql` | 1 | Inserts the real bikes. *Added once the bike list is provided.* |
| `03_rls.sql` | 2 | Row-Level Security: the public can read bikes and create bookings; only the signed-in manager can see renter contacts or edit anything. *Phase 2.* |
| `04_storage.sql` | 4 | Storage bucket `bike-photos` + RLS. Anyone reads photos (so the public page can `<img>` them); only the manager uploads/replaces/deletes. |
| `05_site_settings.sql` | — | Single-row `site_settings` table (site name + tagline). Editable from the admin's *Site settings* card; anon reads on every public page load. |

## Keys

The **Project URL** and **anon key** are safe in frontend code — the anon key is
public by design; Row-Level Security is what protects the data.

The **service_role key** and the **database password** must never appear in this
repo, in any frontend file, or in chat. Keep them somewhere private.
