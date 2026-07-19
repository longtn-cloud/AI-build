# Quiz bank retake + answer navigation — design

Follows on from [2026-07-18-quiz-design.md](2026-07-18-quiz-design.md), which deliberately chose
"generate once, take once, no reload" for v1. This spec reverses that specific constraint (quizzes
are now retakeable from history) and separately fixes two frontend UX issues in the taking flow.

## Problem

1. A generated quiz's questions/options are already fully persisted (`quizzes` + `quiz_questions`
   tables), but there's no way to take the same quiz again later — `QuizPage.tsx` only ever holds
   the quiz in local component state, and there's no endpoint to re-fetch it.
2. Once an option is clicked, `pickOption()` locks in the choice (`if (selected !== null) return`)
   — the user can't change their mind before moving on.
3. There is no "previous question" navigation — only `Next question` / `Finish quiz`.

## Scope

- Add a way to retake a previously generated quiz from the quiz history page, producing a new
  `quiz_attempts` row (old attempt/score stays untouched in history).
- Allow changing a selected answer at any point before/after navigating away from a question.
- Add a Previous button so the user can revisit earlier questions in the current attempt.
- No changes to scoring, the `quiz_attempts`/`quizzes`/`quiz_questions` schema, or attempt
  submission semantics.

## Backend: `GET /quiz/{quiz_id}`

New route in `backend/app/routers/quiz.py`, alongside the existing three. Mirrors the ownership
check already used by `submit_attempt` (`SELECT id FROM quizzes WHERE id = %s AND user_id = %s`,
404 if absent), then returns the same response shape as `POST /quiz/generate` (id, document_ids,
created_at, questions with `id`/`question`/`options` only — no `correct_answer` or
`source_reference`), read from `quiz_questions` ordered by `question_index`.

`requested_count`/`actual_count` aren't stored on the `quizzes` row (only `document_ids` is). For
a reloaded quiz both are simply set to the persisted question count — the "generated fewer than
requested" notice is a first-generation-only concern and doesn't need to reappear on retake.

No change to `POST /quiz/{quiz_id}/attempts` — it already accepts a full `answers` payload and
inserts a fresh `quiz_attempts` row with no uniqueness constraint on `quiz_id`, so retaking a quiz
naturally produces a new, separate attempt.

## Frontend: retake entry point

- `frontend/src/lib/api.ts`: add `getQuiz(quizId: string): Promise<Quiz>` calling
  `GET /quiz/{quizId}`, reusing the existing `Quiz`/`QuizQuestion` types.
- `frontend/src/App.tsx`: add route `/quiz/:quizId/retake` → same `QuizPage` element.
- `frontend/src/pages/QuizHistoryPage.tsx`: add a "Retake" action per attempt row (button using
  `useNavigate()` to `/quiz/${a.quiz_id}/retake` — `Card` currently renders attempts as plain
  divs, so this adds a small flex row with the existing text plus a `Button`).
- `frontend/src/pages/QuizPage.tsx`: read `quizId` via `useParams<{ quizId?: string }>()`. When
  present, fetch it with `useQuery` (`enabled: !!quizId`) instead of showing the `'list'` view;
  on data arriving, call the same `startQuiz()` reset helper used by `generateMutation.onSuccess`
  and switch to `'taking'`. While loading, render a minimal loading state (reuse existing page
  chrome, no new component needed).

## Frontend: answer selection & Previous navigation

In `QuizPage.tsx`:

- Replace `selected: number | null` state with a derived value: `answers` becomes
  `(QuizAnswer | null)[]`, one slot per question (`Array(quiz.questions.length).fill(null)`,
  set whenever a quiz starts — both on generate and on retake, via the shared `startQuiz()`
  helper). `selected` is then `answers[qIndex]?.selected_option ?? null` — no separate state to
  keep in sync.
- `pickOption(index)` always writes `answers[qIndex] = { question_id, selected_option: index }`,
  replacing whatever was there — no lock, so re-clicking a different option changes the answer.
  Revisited questions (via Previous) show their prior selection and remain editable the same way.
- `handleNext()` keeps requiring `selected !== null` to advance (same guard/disabled-button
  behavior as today). On the last question it filters `answers` to non-null entries before
  calling `submitMutation.mutate` (all slots are guaranteed non-null by then, since Next always
  required an answer at every step forward).
- New `handlePrevious()`: `if (qIndex === 0) return; setQIndex(qIndex - 1)`. New secondary-variant
  `Button` next to the existing Next/Finish button, disabled when `qIndex === 0`.
- No change to the "revealed" dimming style or the progress bar — both already key off whether
  the *current* question has an answer, which still holds under back/forward navigation.

## Out of scope

- No UI to browse/list all past quizzes independent of attempts (retake is reached via history,
  not a separate "quiz bank" browser page).
- No editing/removal of a stored quiz's questions.
- No change to how scoring or `results` (correct answer reveal) works after submission.
