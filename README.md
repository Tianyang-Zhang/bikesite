# Weekend Bike Rentals — live availability page

A read-only, manager-maintained availability page for a weekend motorcycle
rental business. Renters see, per bike with photos, which weekends are free;
they still text to book. The manager keeps one source of truth in Airtable.

Full rationale and design: [`DESIGN-DOC.md`](DESIGN-DOC.md).

## How it works

There is **no backend and no server**. The renter's page is plain static
files on a CDN.

```
Airtable (Bikes + Bookings)  ──fetch──▶  build.mjs  ──writes──▶  dist/
   edited from the phone app              (GitHub Actions,        (index.html,
                                           every ~15 min)          photos, css)
                                                │
                                                ▼
                                          GitHub Pages ──▶ renter's phone
```

`build.mjs` fetches Airtable **at build time**, bakes the data and photos
into static files, and deploys. The Airtable token never reaches the
browser. The page can be up to ~15 minutes stale — it shows a "last
updated" timestamp so that is visible.

| File | Role |
|---|---|
| `build.mjs` | Orchestrator — the only file that does network/disk I/O. |
| `lib/dates.mjs` | Weekend-window date math. Pure. |
| `lib/availability.mjs` | Free/busy, overlap, booking validation. Pure. |
| `lib/project.mjs` | Builds the public model — **excludes private fields**. Pure. |
| `lib/render.mjs` | Renders the HTML. Pure. |
| `config.mjs` | All settings you edit (timezone, phone, base ID, …). |
| `index.template.html`, `styles.css` | Page template and styling. |
| `assets/placeholder.svg` | Shown when a bike has no photo. |
| `.github/workflows/build.yml` | The scheduled build + deploy. |

No runtime dependencies. Node 20+ only.

## One-time setup

### 1. Create the Airtable base

Make a base with two tables.

**Bikes**

| Field | Type | Notes |
|---|---|---|
| `Name` | Single line text | e.g. "Ducati Monster". |
| `Type` | Single select | Cruiser, Naked, Sport, Adventure, … |
| `Engine` | Single line text | e.g. "937cc". |
| `Price per day` | Currency | Optional — shown only if set. |
| `Photo` | Attachment | One photo per bike. |
| `Display order` | Number | Lower numbers show first. |
| `Active` | Checkbox | Tick = in the fleet. See below. |

**Bookings**

| Field | Type | Notes |
|---|---|---|
| `Bike` | Link to Bikes | The bike this booking is for. |
| `Start` | Date | First day out, inclusive. |
| `End` | Date | Last day out, inclusive. |
| `Renter note` | Single line text | Private. Never shown on the page. |

Bookings are **whole days** — there are no time slots.

### 2. Get a read token

In Airtable → Builder hub → Personal access tokens, create a token with
the **`data.records:read`** scope, granted to this base. Copy it once.

> Airtable read tokens are base-wide — the token *can* read `Renter note`.
> That field stays private because `build.mjs` never writes it to any
> public file ([`lib/project.mjs`](lib/project.mjs)), not because of token
> scoping. A unit test and an integration test both enforce this.

### 3. Edit `config.mjs`

Open [`config.mjs`](config.mjs) and set every value marked `« EDIT »`:

- `timezone` — your business's IANA timezone.
- `businessName`, `tagline`, `footerNote` — header and footer text.
- `contactPhone` — the number renters text (E.164, e.g. `+15551234567`).
- `airtable.baseId` — your base ID (starts with `app`; it is in the
  Airtable API docs URL for your base). Not secret.

### 4. Repo, Pages, and the secret

1. Push this project to a **public** GitHub repo. Public repos get
   unlimited free Actions minutes; the token is a secret, never in code.
2. Settings → Secrets and variables → Actions → **New repository secret**:
   name `AIRTABLE_TOKEN`, value the token from step 2.
3. Settings → Pages → **Source: GitHub Actions**.

### 5. The first build

Actions tab → "Build & deploy availability page" → **Run workflow**.

When it goes green, open the published URL and check the page on a phone.
**Only share the URL after this first build is confirmed live** — there is
no previous deploy to fall back on.

## Manager's guide

Everything is done in the Airtable phone app.

**Add a booking.** Bookings table → new row → pick the `Bike`, set `Start`
and `End` (inclusive — a Sat+Sun rental is Start Sat, End Sun). The page
updates within ~15 minutes.

**Block a bike** (service, personal use) — add a normal booking for those
dates. Do **not** untick `Active` for this.

**Retire a bike** — untick `Active`. It leaves the page entirely. Do not
retire a bike that still has upcoming bookings shown.

**The ⚠ marker** means a data problem on that bike — two bookings overlap,
or a booking has a bad date. Open Airtable and fix it. Catch overlaps early
using Airtable's per-bike Calendar view, where they show as overlapping
blocks. A double-booking also **fails the `conflict-check` job** in GitHub
Actions, so GitHub emails you. A red workflow run therefore means one of two
things — open the run to see which job is red: `build` = a broken pipeline;
`conflict-check` = a double-booking to fix (the page still deployed fine).

**The "updated" timestamp** is your health check. A stamp **older than ~45
minutes means the build pipeline is broken** — and while it is broken, new
⚠ warnings stop appearing. Check the repo's Actions tab.

**Housekeeping** — Airtable's free tier holds ~1,000 records per base.
Delete past bookings every few months.

This page **flags** double-bookings; it cannot **prevent** you typing one
into Airtable. If double-bookings still happen after a month, that is the
signal to move to off-the-shelf rental software (see `DESIGN-DOC.md`).

## Local development

```sh
node --test                 # run the full test suite

# Run a real build (writes ./dist):
AIRTABLE_TOKEN=your_token node build.mjs

# Preview the result:
cd dist && python3 -m http.server 8000   # then open http://localhost:8000
```

Requires Node 20+. The `lib/` modules are pure and unit-tested; `build.mjs`
has an integration test that runs against saved fixtures — no network or
Airtable account needed to run the tests.

> GitHub disables scheduled workflows after 60 days with no repo activity.
> If the page stops refreshing, open the Actions tab and re-enable it.
