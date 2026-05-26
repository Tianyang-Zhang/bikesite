-- ============================================================================
-- BikeSite v2 · Site settings (admin-editable site name + tagline)
-- ============================================================================
-- Single-row table — the `one_row` CHECK keeps it that way. Manager edits
-- via the admin page; anon reads on page load and on Realtime broadcast.
-- ============================================================================

create table if not exists site_settings (
  id          int          primary key default 1,
  site_name   text         not null,
  tagline     text         not null default '',
  updated_at  timestamptz  not null default now(),
  constraint  one_row      check (id = 1)
);

insert into site_settings (id, site_name, tagline)
values (1, 'Bay Area Motorcycle Rentals', 'Pick a bike, pick your dates, book it. Live availability.')
on conflict (id) do nothing;

alter table site_settings enable row level security;

drop policy if exists "site_settings_read_any"        on site_settings;
drop policy if exists "site_settings_update_manager"  on site_settings;

create policy "site_settings_read_any"
  on site_settings for select
  to anon, authenticated
  using (true);

create policy "site_settings_update_manager"
  on site_settings for update
  to authenticated
  using (true)
  with check (true);
