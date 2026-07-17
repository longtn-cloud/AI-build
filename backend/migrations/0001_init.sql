create extension if not exists vector;

create table documents (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null,
    file_type text not null,
    storage_path text not null,
    status text not null default 'uploading'
        check (status in ('uploading', 'processing', 'ready', 'failed')),
    error_reason text,
    extracted_text text,
    uploaded_at timestamptz not null default now()
);

create table chunks (
    id bigserial primary key,
    document_id uuid not null references documents(id) on delete cascade,
    content text not null,
    embedding vector(512) not null,
    chunk_index integer not null
);

create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops);
create index documents_user_id_idx on documents (user_id);
create index chunks_document_id_idx on chunks (document_id);

alter table documents enable row level security;
alter table chunks enable row level security;

create policy "documents_owner" on documents
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chunks_owner" on chunks
    for all using (
        exists (select 1 from documents d where d.id = chunks.document_id and d.user_id = auth.uid())
    );
