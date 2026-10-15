-- Chat media (customer images, voice notes, documents) and CRM files. The code has always written
-- here, but the bucket was never created in this project, so every media save failed with
-- "Bucket not found". Private: only the server (service role) reads and writes; the app shows
-- files through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-files', 'crm-files', false, 52428800)
on conflict (id) do nothing;
