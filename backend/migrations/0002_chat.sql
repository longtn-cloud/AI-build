create table chat_sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    created_at timestamptz not null default now()
);

create table chat_messages (
    id uuid primary key,
    session_id uuid not null references chat_sessions(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    citations jsonb not null default '[]'::jsonb,
    used_web_search boolean not null default false,
    created_at timestamptz not null default now()
);

create index chat_sessions_user_id_idx on chat_sessions (user_id);
create index chat_messages_session_id_idx on chat_messages (session_id);

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy "chat_sessions_owner" on chat_sessions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_messages_owner" on chat_messages
    for all using (
        exists (select 1 from chat_sessions s where s.id = chat_messages.session_id and s.user_id = auth.uid())
    );
