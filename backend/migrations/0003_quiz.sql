create table quizzes (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    document_ids uuid[] not null,
    created_at timestamptz not null default now()
);

create table quiz_questions (
    id uuid primary key,
    quiz_id uuid not null references quizzes(id) on delete cascade,
    question_index integer not null,
    question text not null,
    options jsonb not null check (jsonb_array_length(options) = 4),
    correct_answer integer not null check (correct_answer between 0 and 3),
    source_reference jsonb not null
);

create table quiz_attempts (
    id uuid primary key,
    quiz_id uuid not null references quizzes(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    answers jsonb not null,
    score integer not null,
    completed_at timestamptz not null default now()
);

create index quizzes_user_id_idx on quizzes (user_id);
create index quiz_questions_quiz_id_idx on quiz_questions (quiz_id);
create index quiz_attempts_quiz_id_idx on quiz_attempts (quiz_id);
create index quiz_attempts_user_id_idx on quiz_attempts (user_id);

alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;

create policy "quizzes_owner" on quizzes
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "quiz_questions_owner" on quiz_questions
    for all using (
        exists (select 1 from quizzes q where q.id = quiz_questions.quiz_id and q.user_id = auth.uid())
    );

create policy "quiz_attempts_owner" on quiz_attempts
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
