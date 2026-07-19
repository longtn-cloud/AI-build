create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
    language plpgsql
    as $$
begin
    insert into profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

create table teams (
    id uuid primary key,
    name text not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now()
);

create table team_members (
    team_id uuid not null references teams(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('admin', 'member')),
    added_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

create table document_shares (
    document_id uuid not null references documents(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    shared_by uuid not null references auth.users(id),
    shared_at timestamptz not null default now(),
    primary key (document_id, team_id)
);

create table quiz_shares (
    quiz_id uuid not null references quizzes(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    shared_by uuid not null references auth.users(id),
    shared_at timestamptz not null default now(),
    primary key (quiz_id, team_id)
);

create index team_members_user_id_idx on team_members (user_id);
create index document_shares_team_id_idx on document_shares (team_id);
create index quiz_shares_team_id_idx on quiz_shares (team_id);

alter table profiles enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table document_shares enable row level security;
alter table quiz_shares enable row level security;

create policy "profiles_self" on profiles
    for select using (auth.uid() = id);

create policy "teams_member" on teams
    for select using (
        exists (select 1 from team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid())
    );

create policy "team_members_member" on team_members
    for select using (
        exists (select 1 from team_members tm where tm.team_id = team_members.team_id and tm.user_id = auth.uid())
    );

create policy "document_shares_team_member" on document_shares
    for select using (
        exists (select 1 from team_members tm where tm.team_id = document_shares.team_id and tm.user_id = auth.uid())
    );

create policy "quiz_shares_team_member" on quiz_shares
    for select using (
        exists (select 1 from team_members tm where tm.team_id = quiz_shares.team_id and tm.user_id = auth.uid())
    );

create policy "documents_shared_with_team" on documents
    for select using (
        exists (
            select 1 from document_shares ds
            join team_members tm on tm.team_id = ds.team_id
            where ds.document_id = documents.id and tm.user_id = auth.uid()
        )
    );

create policy "quizzes_shared_with_team" on quizzes
    for select using (
        exists (
            select 1 from quiz_shares qs
            join team_members tm on tm.team_id = qs.team_id
            where qs.quiz_id = quizzes.id and tm.user_id = auth.uid()
        )
    );
