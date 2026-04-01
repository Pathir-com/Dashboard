-- Add finance_document_url column to practices
alter table practices add column if not exists finance_document_url text;

-- Create storage bucket for document uploads (public read, authenticated upload)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to the documents bucket
create policy "Authenticated users can upload documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

-- Allow public read access to documents
create policy "Public read access to documents"
  on storage.objects for select
  to public
  using (bucket_id = 'documents');

-- Allow authenticated users to delete their uploads
create policy "Authenticated users can delete documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents');
