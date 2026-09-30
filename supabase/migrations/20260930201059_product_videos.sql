-- Existing image gallery is preserved. Video files have their own upload limits.
alter table public.sales_products
  add column videos jsonb not null default '[]'::jsonb
  check (jsonb_typeof(videos) = 'array' and jsonb_array_length(videos) <= 4);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-videos', 'product-videos', true, 26214400, array['video/mp4', 'video/webm']);
-- No authenticated write policies: products.manage is checked server-side before
-- generating a signed upload token scoped to organization_id/random_uuid.
