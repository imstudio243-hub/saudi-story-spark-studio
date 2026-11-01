create policy "studio own read" on storage.objects for select to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own insert" on storage.objects for insert to authenticated with check (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own update" on storage.objects for update to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own delete" on storage.objects for delete to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
