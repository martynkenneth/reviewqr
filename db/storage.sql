-- Creates the storage bucket for business logos.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Public = anyone can view a logo (they appear on customer review pages).
-- Only the app's server can upload or delete, because there are no upload
-- policies and the server uses the service key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png'])
on conflict (id) do nothing;
