-- MartialSystem - Marketplace images + schema hardening (idempotent)
-- Run this in Supabase SQL Editor AFTER 008_roles_sensei.sql

begin;

-- 1) Marketplace image support (native column)
alter table if exists marketplace_items
  add column if not exists image_url text;

alter table if exists students
  add column if not exists photo_url text;

create index if not exists idx_marketplace_items_created_at
  on marketplace_items(created_at desc);

create index if not exists idx_marketplace_items_active
  on marketplace_items(is_active);

create index if not exists idx_marketplace_items_discipline
  on marketplace_items(discipline_id);

-- 2) Keep role checks aligned with backend roles used today
alter table if exists profiles
  drop constraint if exists profiles_role_check;
alter table if exists profiles
  add constraint profiles_role_check
  check (role in ('owner','sensei','admin','instructor','student','guardian','superadmin'));

alter table if exists establishment_members
  drop constraint if exists establishment_members_role_check;
alter table if exists establishment_members
  add constraint establishment_members_role_check
  check (role in ('owner','sensei','admin','instructor','student','guardian','superadmin'));

-- 3) Notifications audience role alignment (adds sensei/superadmin safely)
alter table if exists notifications
  drop constraint if exists notifications_audience_role_check;
alter table if exists notifications
  add constraint notifications_audience_role_check
  check (audience_role in ('all','owner','sensei','admin','instructor','student','guardian','superadmin'));

-- 4) Defensive defaults (safe idempotent)
alter table if exists marketplace_items
  alter column currency set default 'USD';
alter table if exists marketplace_items
  alter column is_active set default true;

-- 5) Optional backfill for existing rows
update marketplace_items
set image_url = null
where image_url = '';

update students
set photo_url = null
where photo_url = '';

-- 6) Supabase Storage bucket for uploaded images
insert into storage.buckets (id, name, public)
values ('martial-media', 'martial-media', true)
on conflict (id) do update
set public = excluded.public;

-- Allow authenticated users to upload/manage images in this bucket.
drop policy if exists "martial_media_upload_auth" on storage.objects;
create policy "martial_media_upload_auth"
on storage.objects for insert to authenticated
with check (bucket_id = 'martial-media');

drop policy if exists "martial_media_update_auth" on storage.objects;
create policy "martial_media_update_auth"
on storage.objects for update to authenticated
using (bucket_id = 'martial-media')
with check (bucket_id = 'martial-media');

drop policy if exists "martial_media_delete_auth" on storage.objects;
create policy "martial_media_delete_auth"
on storage.objects for delete to authenticated
using (bucket_id = 'martial-media');

-- Public read for product/catalog/profile images.
drop policy if exists "martial_media_read_public" on storage.objects;
create policy "martial_media_read_public"
on storage.objects for select to public
using (bucket_id = 'martial-media');

commit;
