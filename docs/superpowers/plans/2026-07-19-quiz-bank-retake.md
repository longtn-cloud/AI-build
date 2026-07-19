# Quiz Bank Retake + Answer Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user retake a previously generated quiz from their history, and fix the quiz-taking UI so answers can be changed and previous questions revisited.

**Architecture:** Add one new read endpoint (`GET /quiz/{quiz_id}`) that returns a persisted quiz in the same shape `POST /quiz/generate` already returns. On the frontend, restructure `QuizPage`'s answer state from an append-only list to one slot per question (so re-selecting and revisiting are both just array writes), add a Previous button, and wire a "Retake" action on the quiz history page through a new `/quiz/:quizId/retake` route that fetches the quiz and drops straight into the taking view.

**Tech Stack:** FastAPI + psycopg (backend), React + TanStack Query + react-router-dom + Vitest/Testing Library (frontend).

## Global Constraints

- No schema changes — `quizzes`, `quiz_questions`, `quiz_attempts` are untouched.
- `GET /quiz/{quiz_id}` must never expose `correct_answer` or `source_reference` (same anti-cheat rule as `POST /quiz/generate`'s response).
- Route ordering in `backend/app/routers/quiz.py` matters: the new `GET /{quiz_id}` route must be registered **after** the existing `GET /attempts` route, or it will shadow `/quiz/attempts` (FastAPI/Starlette matches routes in registration order, and `/attempts` would otherwise be captured as `quiz_id="attempts"`).
- Follow existing test conventions exactly: backend tests duplicate small `_create_user`/`_create_document`/`_create_quiz_with_questions` helpers per test file (see `backend/tests/test_quiz_attempts.py`) rather than sharing a module — match that pattern in the new test file.
- Frontend tests use `renderWithQueryClient` + `MemoryRouter` from `frontend/tests/test-utils.tsx`, and mock `../../src/lib/api` per-file with `vi.mock`.

---

### Task 1: Backend — `GET /quiz/{quiz_id}` endpoint

**Files:**
- Modify: `backend/app/routers/quiz.py` (add route at end of file, after `list_attempts`, which currently ends at line 320)
- Test: Create `backend/tests/test_quiz_get.py`

**Interfaces:**
- Produces: `GET /quiz/{quiz_id}` → 200 with `{id, document_ids, requested_count, actual_count, created_at, questions: [{id, question, options}]}` (no `correct_answer`/`source_reference`), or 404 if the quiz doesn't exist or isn't owned by the caller.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_quiz_get.py`:

```python
import uuid

import psycopg
from fastapi.testclient import TestClient
from psycopg.types.json import Json

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document(user_id: str, filename: str) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
    return document_id


def _create_quiz_with_questions(user_id: str, document_id: str, questions: list[dict]) -> tuple[str, list[str]]:
    quiz_id = str(uuid.uuid4())
    question_ids = []
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO quizzes (id, user_id, document_ids) VALUES (%s, %s, %s)",
            (quiz_id, user_id, [document_id]),
        )
        for index, q in enumerate(questions):
            question_id = str(uuid.uuid4())
            question_ids.append(question_id)
            conn.execute(
                """
                INSERT INTO quiz_questions
                    (id, quiz_id, question_index, question, options, correct_answer, source_reference)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    question_id,
                    quiz_id,
                    index,
                    q["question"],
                    Json(q["options"]),
                    q["correct_answer"],
                    Json(
                        {"document_id": document_id, "filename": "doc.txt", "chunk_index": 0, "total_chunks": 1}
                    ),
                ),
            )
    return quiz_id, question_ids


def test_get_quiz_returns_questions_without_correct_answers():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id,
        document_id,
        [
            {"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 1},
            {"question": "Q2", "options": ["a", "b", "c", "d"], "correct_answer": 2},
        ],
    )

    response = client.get(f"/quiz/{quiz_id}", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == quiz_id
    assert body["document_ids"] == [document_id]
    assert body["actual_count"] == 2
    assert body["requested_count"] == 2
    assert body["questions"] == [
        {"id": question_ids[0], "question": "Q1", "options": ["a", "b", "c", "d"]},
        {"id": question_ids[1], "question": "Q2", "options": ["a", "b", "c", "d"]},
    ]
    for q in body["questions"]:
        assert "correct_answer" not in q
        assert "source_reference" not in q


def test_get_quiz_returns_404_for_missing_quiz():
    _, headers = _create_user()

    response = client.get(f"/quiz/{uuid.uuid4()}", headers=headers)

    assert response.status_code == 404


def test_get_quiz_returns_404_for_other_users_quiz():
    owner_id, _ = _create_user()
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, _ = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    _, other_headers = _create_user()
    response = client.get(f"/quiz/{quiz_id}", headers=other_headers)

    assert response.status_code == 404


def test_get_quiz_still_allows_get_attempts_route_to_match():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 0}]},
        headers=headers,
    )

    response = client.get("/quiz/attempts", headers=headers)

    assert response.status_code == 200
    assert response.json()["attempts"][0]["quiz_id"] == quiz_id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_quiz_get.py -v`
Expected: FAIL — 404 responses (no such route) for the `GET /quiz/{quiz_id}` calls, since the route doesn't exist yet. (`test_get_quiz_still_allows_get_attempts_route_to_match` will pass already — that's fine, it's a regression guard for the next step.)

- [ ] **Step 3: Implement the endpoint**

Append to the end of `backend/app/routers/quiz.py` (after the `list_attempts` function, i.e. after the current line 320):

```python
@router.get("/{quiz_id}")
def get_quiz(quiz_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        quiz_row = conn.execute(
            "SELECT id, document_ids, created_at FROM quizzes WHERE id = %s AND user_id = %s",
            (quiz_id, user_id),
        ).fetchone()
        if quiz_row is None:
            raise HTTPException(status_code=404, detail="Quiz not found")

        question_rows = conn.execute(
            """
            SELECT id, question, options
            FROM quiz_questions
            WHERE quiz_id = %s
            ORDER BY question_index
            """,
            (quiz_id,),
        ).fetchall()

    return {
        "id": str(quiz_row["id"]),
        "document_ids": [str(d) for d in quiz_row["document_ids"]],
        "requested_count": len(question_rows),
        "actual_count": len(question_rows),
        "created_at": quiz_row["created_at"].isoformat(),
        "questions": [
            {"id": str(r["id"]), "question": r["question"], "options": r["options"]}
            for r in question_rows
        ],
    }
```

This MUST be placed after `list_attempts` (the `GET /attempts` route), not before — see Global Constraints.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_quiz_get.py tests/test_quiz_attempts.py tests/test_quiz_generate.py -v`
Expected: PASS (all tests in all three files, confirming the new route doesn't regress the existing ones)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/quiz.py backend/tests/test_quiz_get.py
git commit -m "feat: add GET /quiz/{quiz_id} to re-fetch a persisted quiz for retaking"
```

---

### Task 2: Frontend — `getQuiz` API client function

**Files:**
- Modify: `frontend/src/lib/api.ts:171` (insert after the `generateQuiz` function, before the `QuizAnswer` type)
- Test: Modify `frontend/tests/lib/api.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `apiFetch`, `authHeader`, `API_BASE`, `Quiz` type already in this file)
- Produces: `getQuiz(quizId: string): Promise<Quiz>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/lib/api.test.ts` (inside the `describe('api client', ...)` block, alongside the other quiz tests — add `getQuiz` to the existing import list from `'../../src/lib/api'` at the top of the file):

```ts
  it('getQuiz sends an authorized GET request for the quiz id', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'quiz-1', document_ids: [], requested_count: 1, actual_count: 1, created_at: '2026-07-19T00:00:00Z', questions: [] }),
    })

    const result = await getQuiz('quiz-1')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quiz/quiz-1'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(result.id).toBe('quiz-1')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/lib/api.test.ts`
Expected: FAIL with `getQuiz is not defined` (or a TypeScript import error, since it's not exported yet)

- [ ] **Step 3: Implement `getQuiz`**

In `frontend/src/lib/api.ts`, insert directly after the `generateQuiz` function (which currently ends at line 171, right before `export type QuizAnswer = ...`):

```ts
export async function getQuiz(quizId: string): Promise<Quiz> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}`, {
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to load quiz')
  return res.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/lib/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/tests/lib/api.test.ts
git commit -m "feat: add getQuiz API client function"
```

---

### Task 3: Frontend — free answer re-selection + Previous question navigation

**Files:**
- Modify: `frontend/src/pages/QuizPage.tsx`
- Test: Modify `frontend/tests/pages/QuizPage.test.tsx`

**Interfaces:**
- Consumes: `Quiz`, `QuizAnswer` types from `frontend/src/lib/api.ts` (already exported there).
- Produces: `QuizPage` behavior — options are always clickable/re-clickable; a "Previous" button appears next to "Next question"/"Finish quiz", disabled on the first question. This task does NOT touch retake/routing — it only fixes the existing generate → take → result flow. Task 4 builds the retake path on top of the `answers`/`selected`/`startQuiz` shape this task introduces.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/pages/QuizPage.test.tsx`, inside the existing `describe('QuizPage', ...)` block:

```ts
  it('allows changing the selected answer before moving on', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue(RESULT)

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))
    await waitFor(() => screen.getByText('What is the refund window?'))

    fireEvent.click(screen.getByText('7 days'))
    fireEvent.click(screen.getByText('30 days'))
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    await waitFor(() => screen.getByText('What is covered?'))
    fireEvent.click(screen.getByText('Service outages'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish quiz' }))

    await waitFor(() => {
      expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
        { question_id: 'q-1', selected_option: 1 },
        { question_id: 'q-2', selected_option: 1 },
      ])
    })
  })

  it('goes back to the previous question and keeps its answer editable', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue(RESULT)

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))
    await waitFor(() => screen.getByText('What is the refund window?'))

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByText('30 days'))
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    await waitFor(() => screen.getByText('What is covered?'))

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => screen.getByText('What is the refund window?'))
    fireEvent.click(screen.getByText('60 days'))
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    await waitFor(() => screen.getByText('What is covered?'))
    fireEvent.click(screen.getByText('Data breaches'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish quiz' }))

    await waitFor(() => {
      expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
        { question_id: 'q-1', selected_option: 2 },
        { question_id: 'q-2', selected_option: 0 },
      ])
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/pages/QuizPage.test.tsx`
Expected: FAIL — the re-selection test fails because `pickOption` currently ignores the second click; the Previous test fails because there's no button named "Previous".

- [ ] **Step 3: Rework state and rendering in `QuizPage.tsx`**

Replace the state declarations (current lines 13-21):

```ts
export function QuizPage() {
  const [view, setView] = useState<View>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Awaited<ReturnType<typeof generateQuiz>> | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answers, setAnswers] = useState<{ question_id: string; selected_option: number }[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitQuizAttempt>> | null>(null)
  const queryClient = useQueryClient()
```

with:

```ts
export function QuizPage() {
  const [view, setView] = useState<View>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Awaited<ReturnType<typeof generateQuiz>> | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<(QuizAnswer | null)[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitQuizAttempt>> | null>(null)
  const queryClient = useQueryClient()
  const selected = answers[qIndex]?.selected_option ?? null
```

Add `QuizAnswer` to the import from `'../lib/api'` at the top of the file (line 6 currently reads
`import { generateQuiz, listDocuments, listQuizAttempts, submitQuizAttempt } from '../lib/api'`):

```ts
import { generateQuiz, listDocuments, listQuizAttempts, submitQuizAttempt, QuizAnswer } from '../lib/api'
```

Replace `generateMutation` (current lines 41-52) — introduce a shared `startQuiz` reset helper here so Task 4 can reuse the exact same reset logic for the retake path instead of duplicating it:

```ts
  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions),
    onSuccess: (generated) => {
      setQuiz(generated)
      setQIndex(0)
      setSelected(null)
      setAnswers([])
      setResult(null)
      setView('taking')
    },
  })
```

with:

```ts
  function startQuiz(loaded: Awaited<ReturnType<typeof generateQuiz>>) {
    setQuiz(loaded)
    setQIndex(0)
    setAnswers(Array(loaded.questions.length).fill(null))
    setResult(null)
    setView('taking')
  }

  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions),
    onSuccess: (generated) => startQuiz(generated),
  })
```

Replace `pickOption` and `handleNext` (current lines 73-89):

```ts
  function pickOption(index: number) {
    if (selected !== null) return
    setSelected(index)
  }

  function handleNext() {
    if (selected === null || !quiz) return
    const question = quiz.questions[qIndex]
    const nextAnswers = [...answers, { question_id: question.id, selected_option: selected }]
    setAnswers(nextAnswers)
    if (qIndex >= quiz.questions.length - 1) {
      submitMutation.mutate({ quizId: quiz.id, answers: nextAnswers })
      return
    }
    setQIndex(qIndex + 1)
    setSelected(null)
  }
```

with:

```ts
  function pickOption(index: number) {
    if (!quiz) return
    const question = quiz.questions[qIndex]
    setAnswers((prev) => {
      const next = [...prev]
      next[qIndex] = { question_id: question.id, selected_option: index }
      return next
    })
  }

  function handlePrevious() {
    if (qIndex === 0) return
    setQIndex(qIndex - 1)
  }

  function handleNext() {
    if (selected === null || !quiz) return
    if (qIndex >= quiz.questions.length - 1) {
      const finalAnswers = answers.filter((a): a is QuizAnswer => a !== null)
      submitMutation.mutate({ quizId: quiz.id, answers: finalAnswers })
      return
    }
    setQIndex(qIndex + 1)
  }
```

In the `submitMutation` declaration (current lines 54-62), change the `answers` param type from `typeof answers` to `QuizAnswer[]` since it's now the filtered array:

```ts
  const submitMutation = useMutation({
    mutationFn: (vars: { quizId: string; answers: QuizAnswer[] }) =>
      submitQuizAttempt(vars.quizId, vars.answers),
```

Finally, replace the button row in the `'taking'` view (current lines 263-267):

```tsx
        <div className="mt-5 flex justify-end">
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? 'Finish quiz' : 'Next question'}
          </Button>
        </div>
```

with:

```tsx
        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={handlePrevious} disabled={qIndex === 0}>
            Previous
          </Button>
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? 'Finish quiz' : 'Next question'}
          </Button>
        </div>
```

Nothing else in the file changes — the per-option styling (`isSelected`/`revealed` logic at current lines 238-259) already reads from `selected`/`revealed`, which are still defined the same way (`const revealed = selected !== null` in the `'taking'` view block stays as-is).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/QuizPage.test.tsx`
Expected: PASS — all tests in the file, including the two new ones and all pre-existing ones (confirms no regression to the config/list/result flows).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QuizPage.tsx frontend/tests/pages/QuizPage.test.tsx
git commit -m "fix: allow changing quiz answers and navigating to previous questions"
```

---

### Task 4: Frontend — retake wiring (route, history action, load-by-id)

**Files:**
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/pages/QuizHistoryPage.tsx` (add Retake action)
- Modify: `frontend/src/pages/QuizPage.tsx` (load quiz by id when reached via retake route)
- Modify: `frontend/src/lib/queryKeys.ts` (add a keyed entry for a single quiz)
- Test: Modify `frontend/tests/pages/QuizHistoryPage.test.tsx`, `frontend/tests/pages/QuizPage.test.tsx`, `frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: `getQuiz` from Task 2; the `startQuiz(loaded)` helper introduced in Task 3.
- Produces: visiting `/quiz/:quizId/retake` renders `QuizPage` straight into the `'taking'` view for that quiz; `QuizHistoryPage` attempt rows gain a "Retake" button that navigates there.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/pages/QuizHistoryPage.test.tsx` (needs `useNavigate` to be exercised — mock `react-router-dom`'s navigate the same way the rest of the suite uses `MemoryRouter`, by asserting the resulting location instead of mocking navigate directly). Replace the file's `renderQuizHistoryPage` helper and add a test:

```tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listQuizAttempts: vi.fn(),
}))

import { listQuizAttempts } from '../../src/lib/api'
import { QuizHistoryPage } from '../../src/pages/QuizHistoryPage'

function renderQuizHistoryPage() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/quiz/history']}>
      <Routes>
        <Route path="/quiz/history" element={<QuizHistoryPage />} />
        <Route path="/quiz/:quizId/retake" element={<div>retake page for {location.pathname}</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
```

(This replaces the bare `<MemoryRouter><QuizHistoryPage /></MemoryRouter>` wrapper used by the three existing tests in this file — they continue to pass unchanged since `/quiz/history` still matches.)

Then add a new test at the end of the `describe` block:

```tsx
  it('navigates to the retake route when Retake is clicked', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 7,
        total_questions: 10,
        completed_at: '2026-07-18T12:05:00Z',
        document_filenames: ['policy.pdf'],
      },
    ])

    renderQuizHistoryPage()
    await waitFor(() => screen.getByRole('button', { name: 'Retake' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }))

    await waitFor(() => {
      expect(screen.getByText('retake page for /quiz/quiz-1/retake')).toBeInTheDocument()
    })
  })
```

Add to `frontend/tests/pages/QuizPage.test.tsx`: extend the mock at the top of the file to include `getQuiz` (change the `vi.mock('../../src/lib/api', ...)` block to add `getQuiz: vi.fn(),` and add `getQuiz` to the import list below it), add a `renderQuizPageAt` helper, and a new test:

```ts
vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  listQuizAttempts: vi.fn(),
  generateQuiz: vi.fn(),
  getQuiz: vi.fn(),
  submitQuizAttempt: vi.fn(),
}))

import {
  generateQuiz,
  getQuiz,
  listDocuments,
  listQuizAttempts,
  submitQuizAttempt,
} from '../../src/lib/api'
import { Route, Routes } from 'react-router-dom'

function renderQuizPageAt(path: string) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/quiz/:quizId/retake" element={<QuizPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
```

```ts
  it('loads a persisted quiz and starts taking it when visited via the retake route', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(getQuiz as any).mockResolvedValue(QUIZ)

    renderQuizPageAt('/quiz/quiz-1/retake')

    await waitFor(() => {
      expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    })
    expect(getQuiz).toHaveBeenCalledWith('quiz-1')
  })
```

Add `/quiz/quiz-1/retake` handling to `frontend/tests/App.test.tsx`'s parametrized redirect test — change the `it.each` array from
`['/documents', '/search', '/quiz', '/quiz/history', '/chat']` to
`['/documents', '/search', '/quiz', '/quiz/history', '/quiz/quiz-1/retake', '/chat']`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/pages/QuizHistoryPage.test.tsx tests/pages/QuizPage.test.tsx tests/App.test.tsx`
Expected: FAIL — no "Retake" button exists yet, `getQuiz` isn't wired into `QuizPage`, and `/quiz/quiz-1/retake` has no matching route in `App.tsx`.

- [ ] **Step 3: Add the query key**

In `frontend/src/lib/queryKeys.ts`, add a `quiz` entry:

```ts
export const queryKeys = {
  documents: ['documents'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
  quiz: (quizId: string) => ['quiz', quizId] as const,
}
```

- [ ] **Step 4: Add the route in `App.tsx`**

In `frontend/src/App.tsx`, add a new route right after the `/quiz/history` route (current lines 50-59):

```tsx
        <Route
          path="/quiz/:quizId/retake"
          element={
            <ProtectedRoute>
              <AppShell>
                <QuizPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
```

- [ ] **Step 5: Add the Retake action in `QuizHistoryPage.tsx`**

Replace the full contents of `frontend/src/pages/QuizHistoryPage.tsx`:

```tsx
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/quiz" className="text-sm font-semibold text-accent-hover hover:underline">
          Take a quiz
        </Link>
      </div>
      {attemptsQuery.isError && <Alert>Failed to load quiz history, try again</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="text-sm text-muted">No quiz attempts yet</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {attempts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-4">
              <span>
                {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
                {a.completed_at}
              </span>
              <Button variant="secondary" onClick={() => navigate(`/quiz/${a.quiz_id}/retake`)}>
                Retake
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Wire retake loading into `QuizPage.tsx`**

Add `useParams` to the `react-router-dom` import (this import doesn't exist yet in the file — add it as a new import line near the top, after the `@tanstack/react-query` import):

```ts
import { useParams } from 'react-router-dom'
```

Add `getQuiz` to the `../lib/api` import (from Task 3's updated import line):

```ts
import { generateQuiz, getQuiz, listDocuments, listQuizAttempts, submitQuizAttempt, QuizAnswer } from '../lib/api'
```

Add `useEffect` to the `react` import at the top of the file (currently `import { useMemo, useState } from 'react'`):

```ts
import { useEffect, useMemo, useState } from 'react'
```

At the top of the `QuizPage` function body, right after the `queryClient` line (end of the state block from Task 3), add:

```ts
  const { quizId: retakeQuizId } = useParams<{ quizId?: string }>()

  const retakeQuery = useQuery({
    queryKey: retakeQuizId ? queryKeys.quiz(retakeQuizId) : queryKeys.quiz('none'),
    queryFn: () => getQuiz(retakeQuizId as string),
    enabled: !!retakeQuizId,
  })

  useEffect(() => {
    if (retakeQuery.data) {
      startQuiz(retakeQuery.data)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retakeQuery.data])
```

Right before the `if (view === 'list')` block, add a loading/error guard for the retake path:

```tsx
  if (retakeQuizId && !quiz) {
    return (
      <div className="mx-auto max-w-[680px] px-8 pb-12 pt-7">
        {retakeQuery.isError ? (
          <Alert>Failed to load quiz, try again</Alert>
        ) : (
          <p className="text-sm text-muted">Loading quiz…</p>
        )}
      </div>
    )
  }

```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS — full frontend suite, confirming no regressions across `QuizPage`, `QuizHistoryPage`, and `App` routing tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/QuizHistoryPage.tsx frontend/src/pages/QuizPage.tsx frontend/src/lib/queryKeys.ts frontend/tests/pages/QuizHistoryPage.test.tsx frontend/tests/pages/QuizPage.test.tsx frontend/tests/App.test.tsx
git commit -m "feat: add Retake action on quiz history that reloads a persisted quiz"
```

---

### Task 5: Backend regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend quiz test suite**

Run: `cd backend && python -m pytest tests/test_quiz_generate.py tests/test_quiz_attempts.py tests/test_quiz_get.py -v`
Expected: PASS — all tests across the three quiz test files.

- [ ] **Step 2: Run the full backend suite**

Run: `cd backend && python -m pytest -v`
Expected: PASS — no regressions anywhere else in the backend.

(No commit — this task only verifies Tasks 1-4 didn't break anything outside the quiz feature.)
