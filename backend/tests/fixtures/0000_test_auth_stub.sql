create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key
);

alter table auth.users add column if not exists email text;

create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select null::uuid $$;
