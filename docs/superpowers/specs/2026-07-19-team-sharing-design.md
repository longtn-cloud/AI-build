# Team sharing — design

## Problem

Every resource today (`documents`, `chunks`, `quizzes`, `quiz_questions`, `quiz_attempts`,
`chat_sessions`, `chat_messages`) is private to its single owning `user_id`, both via an explicit
`WHERE user_id = %s` in every hand-written query and via RLS policies as a backstop. There is no
group/shared access path, no app-owned users table (only Supabase's `auth.users`), and no
admin/role concept anywhere. This spec adds a minimal team (workspace) feature so a user can add
an existing colleague to a team directly (no email invite flow) and share specific documents/quizzes
with that team — with search and the AI chat assistant able to draw on shared documents too.

## Scope

- Multi-team model: any user can create a team and becomes its permanent admin (no promotion,
  transfer, or team deletion in v1); a user can belong to multiple teams.
- Admin adds an existing user to the team by searching email (the user must already have an
  account) — membership is immediate, no invite/accept step.
- Admin can remove a member. The admin/creator can't be removed and can't leave.
- A document/quiz owner explicitly shares individual items to one or more of their teams via a
  "Share" action (not automatic — unshared items stay private). Owner can unshare later.
- Team members get view + interact access to shared documents/quizzes: preview/download, chat
  Q&A, quiz generation, and search all include team-shared documents alongside the member's own —
  but no rename/delete (owner-only).
- Shared items surface in a separate "Shared with me" tab on the Documents and Quiz pages, not
  merged into the owner's own list.
- Out of scope: delete-team, leave-team, promoting/transferring admin, per-member granular
  permissions, notifications/email of any kind.

## Data model

New migration `backend/migrations/0006_teams.sql`:

```sql
-- profiles: minimal mirror of auth.users, populated by trigger so every signup gets a row
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
-- + trigger function + trigger on auth.users insert to populate profiles automatically

create table teams (
  id uuid primary key default gen_random_uuid(),
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
```

RLS: enable on all four new tables (membership-scoped policies mirroring the existing
`_owner`-style policies), and extend the existing `documents`/`quizzes` SELECT policies to also
allow rows reachable via a share to a team the requester belongs to. This keeps parity with the
existing "RLS + explicit `WHERE`, never rely on one alone" invariant, even though the backend's
own connection (`get_conn()`, direct `SUPABASE_DB_URL`) currently bypasses RLS as the owning role —
RLS here is defense-in-depth for any other access path, not the live enforcement mechanism.

## Centralized access-check helper

Quiz generation, chat, and search each independently decide which documents a user can read. Today
that's just `d.user_id = %s`; after this change it's "owned by caller OR shared with a team the
caller belongs to" in three places. To avoid duplicating that logic (and risking one place getting
it wrong), add one helper — e.g. `accessible_documents_filter(user_id)` in a small new
`app/services/access.py` — that returns the SQL fragment/params for this condition, used by all
three call sites plus the new document/quiz share endpoints' ownership checks.

## Backend API

New router `backend/app/routers/teams.py`:

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/teams` | any authenticated user | Create a team; caller becomes admin |
| GET | `/teams` | any authenticated user | List teams caller belongs to, with role |
| GET | `/teams/{team_id}/members` | any member | List members (email + role) |
| GET | `/teams/{team_id}/members/search?q=` | admin only | `profiles.email ILIKE` search, excludes existing members |
| POST | `/teams/{team_id}/members` | admin only | `{user_id}` → add membership as `'member'`, 404 if `user_id` not in `profiles` |
| DELETE | `/teams/{team_id}/members/{user_id}` | admin only | Remove a member; 403 if target is the admin |

Extensions to `backend/app/routers/documents.py`:

- `POST /documents/{id}/share` — owner-only (404 if not owner or doc doesn't exist), body
  `{team_id}`; 403 if caller isn't a member of `team_id`; `INSERT ... ON CONFLICT DO NOTHING`
  (idempotent).
- `DELETE /documents/{id}/share/{team_id}` — owner-only; removes the share row.
- `GET /documents/shared` — lists documents shared with any team the caller belongs to (backs the
  "Shared with me" tab), same response shape as `GET /documents` plus `shared_by`/`team_id`.

Extensions to `backend/app/routers/quiz.py`: identical trio —
`POST /quiz/{id}/share`, `DELETE /quiz/{id}/share/{team_id}`, `GET /quiz/shared`.

Extensions using the shared access helper:

- `POST /quiz/generate` — the existing "verify all `document_ids` belong to `user_id`" check
  (`quiz.py:80-85`) becomes "owned by caller OR shared with caller's team".
- `chat.py` retrieval query — the `WHERE d.user_id = %s` filter (line 116) becomes the same
  owned-or-shared condition, so chat answers can draw on shared documents across the whole corpus,
  not just the caller's own.
- `search.py` — the `filters_sql` base clause (`d.user_id = %s`, reused three times in the fused
  vector/FTS query) becomes the same owned-or-shared condition.

## Frontend

- New page `frontend/src/pages/TeamsPage.tsx` + nav entry in `AppNav.tsx`: list of the caller's
  teams with role badge, "Create team" form, and a team detail view (member list; admin-only
  email-search box + "Add" button; admin-only "Remove" button per non-admin member).
- `DocumentsPage.tsx` / `QuizPage.tsx` / `QuizHistoryPage.tsx`: add a "Share" action per owned item
  opening a picker listing the caller's teams as checkboxes (a doc/quiz can be shared to several
  teams at once), toggling share/unshare. Add a second "Shared with me" tab fed by
  `GET /documents/shared` / `GET /quiz/shared`, items badged as shared (same visual convention as
  the existing "General knowledge"/"Web" badges) with rename/delete actions hidden for non-owners.
- `frontend/src/lib/api.ts`: typed functions for all new endpoints (`createTeam`, `listTeams`,
  `listTeamMembers`, `searchTeamMembers`, `addTeamMember`, `removeTeamMember`, `shareDocument`,
  `unshareDocument`, `listSharedDocuments`, and the quiz equivalents).
- `frontend/src/lib/queryKeys.ts`: new keys for teams, team members, and shared documents/quizzes.

## Error handling

- 403: non-admin attempting member add/remove; non-owner attempting share/unshare; sharing to a
  team the owner doesn't belong to; removing the admin.
- 404: unknown team/document/quiz id, or a searched/added `user_id` with no `profiles` row.
- Idempotent share (`ON CONFLICT DO NOTHING`) — re-sharing an already-shared item is a silent
  no-op, not an error.

## Testing

- Backend: new `backend/tests/test_teams.py` (create/list teams, member search, add/remove member,
  permission checks including "can't remove admin"). Extend `test_documents*.py`/`test_quiz*.py`
  for share/unshare endpoints and shared-access read/chat/generate/search paths. Follows the
  existing pattern of seeding `auth.users` via the test fixture stub.
- Frontend: Vitest coverage for `TeamsPage` (create team, add/remove member, admin-only UI gating)
  and the share picker + "Shared with me" tab on Documents/Quiz pages.

## Out of scope

- Delete team, leave team, promote/transfer admin, multiple admins.
- Per-member granular permissions (e.g. view-only vs. full interact) — all team members get the
  same "view + chat/quiz" access to shared items.
- Any invite/notification flow (email, in-app) — adding a member is immediate and silent.
