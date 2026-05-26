-- ============================================================================
-- BikeSite v2 · Phase 4 follow-up · Storage bucket for bike photos
-- ============================================================================
-- Apply in the Supabase SQL editor.
--
-- Creates a public `bike-photos` bucket and the storage.objects RLS that
-- lets:
--   * anyone (anon + authenticated) READ any photo in the bucket — the
--     public page needs to render <img src="https://....supabase.co/.../*">
--   * the authenticated manager UPLOAD / REPLACE / DELETE photos
-- ============================================================================

-- Create / update the bucket. public = true means files are served via the
-- public URL (no signed URL or auth needed for reads).
insert into storage.buckets (id, name, public)
values ('bike-photos', 'bike-photos', true)
on conflict (id) do update set public = excluded.public;


-- ----------------------------------------------------------------------------
-- RLS on storage.objects, scoped to the bike-photos bucket.
-- (Drop-then-create makes the script idempotent.)
-- ----------------------------------------------------------------------------
drop policy if exists "bike_photos_read_any"           on storage.objects;
drop policy if exists "bike_photos_insert_manager"     on storage.objects;
drop policy if exists "bike_photos_update_manager"     on storage.objects;
drop policy if exists "bike_photos_delete_manager"     on storage.objects;

create policy "bike_photos_read_any"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'bike-photos');

create policy "bike_photos_insert_manager"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'bike-photos');

create policy "bike_photos_update_manager"
  on storage.objects
  for update
  to authenticated
  using      (bucket_id = 'bike-photos')
  with check (bucket_id = 'bike-photos');

create policy "bike_photos_delete_manager"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'bike-photos');
