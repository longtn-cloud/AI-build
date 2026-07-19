# Vietnamese-default i18n — design

## Problem

The app has no internationalization anywhere: the frontend renders hardcoded English strings
directly in JSX across all 7 pages, and the backend's Gemini system prompts
(`backend/app/services/llm.py`) contain no language instruction at all — Gemini answers in
whatever language the user's question happens to be in. There's no way for a user to see the UI in
Vietnamese, and no way to make chat/quiz responses reliably come back in Vietnamese.

## Scope

- Add a real, switchable i18n framework to the frontend (react-i18next), Vietnamese as the default
  language, English as the second supported language.
- A language switcher visible on every authenticated page, persisted to `localStorage`.
- Translate all existing user-facing strings across `frontend/src/pages/*`,
  `AppNav.tsx`/`AppShell.tsx`/`PreviewModal.tsx` into `vi`/`en`.
- Thread the selected language through to the backend for both chat responses and quiz generation,
  so Gemini is explicitly instructed which language to answer in (default Vietnamese server-side
  too, so any caller that omits it still gets Vietnamese).
- Out of scope: per-user server-side language storage (no user-profile table exists; not adding
  one), translating database content (document text, citations, filenames), pluralization/ICU
  formatting beyond what react-i18next gives out of the box, RTL support.

## Frontend: i18n framework

- Add `i18next`, `react-i18next`, `i18next-browser-languagedetector` to `frontend/package.json`.
- `frontend/src/i18n/index.ts`: initializes i18next with `fallbackLng: 'vi'`, detector `order:
  ['localStorage']`, `caches: ['localStorage']`. Imported once, as a side effect, at the top of
  `frontend/src/main.tsx` (before `<App/>` renders). react-i18next keeps its own internal context,
  so no custom `LanguageContext`/provider component is needed — this is a deliberate deviation from
  the app's existing "one Context per concern" pattern (seen in `AuthContext.tsx`), because
  react-i18next already solves that problem.
- Translation files: `frontend/src/i18n/locales/{vi,en}/{common,auth,chat,documents,search,quiz}.json`.
  Namespace-to-page mapping:
  - `common`: `AppNav.tsx`, `AppShell.tsx`, shared buttons/errors reused across pages.
  - `auth`: `LoginPage.tsx`, `SignupPage.tsx`.
  - `chat`: `ChatPage.tsx`.
  - `documents`: `DocumentsPage.tsx`, `PreviewModal.tsx`.
  - `search`: `SearchPage.tsx`.
  - `quiz`: `QuizPage.tsx`, `QuizHistoryPage.tsx`.
- Every hardcoded string in the files above is replaced with `t('key')` via
  `useTranslation(namespace)`. Vietnamese copy in `vi/*.json` is the primary content; `en/*.json`
  reuses today's existing English strings as its content, so English behavior is unchanged.

## Language switcher

A small toggle/dropdown added to `AppNav.tsx` (rendered on every authenticated page), calling
`i18n.changeLanguage('vi' | 'en')`. The `i18next-browser-languagedetector` plugin persists the
choice to `localStorage` automatically and reads it back before first render on reload — no manual
persistence code needed.

## Backend: language-aware prompts

- `backend/app/routers/chat.py`: `SendMessageRequest` gains `language: Literal["vi", "en"] = "vi"`.
  Passed through to `answer_from_chunks(question, chunks, history, language)` and
  `answer_with_web_search(question, history, language)`.
- `backend/app/routers/quiz.py`: `GenerateQuizRequest` gains the same `language` field, passed to
  `generate_quiz_questions(chunks, num_questions, language)`.
- `backend/app/services/llm.py`: `DOCUMENTS_SYSTEM_PROMPT` and `GENERAL_KNOWLEDGE_SYSTEM_PROMPT`
  become functions of `language` (or keep the constant text and append a language directive
  sentence built from a small `_language_instruction(language: str) -> str` helper, e.g.
  `"Respond in Vietnamese."` / `"Respond in English."`); `_quiz_system_prompt` gains the same
  suffix. `answer_with_web_search` currently passes no `system_instruction` at all — it gains one
  containing just the language directive. Default is `"vi"` at every layer (request model default,
  and the helper's own default), so omitting the field anywhere still yields Vietnamese.

## Frontend → backend wiring

- `frontend/src/lib/api.ts`: `sendChatMessage` and `generateQuiz` each gain a `language` parameter.
- Call sites (`ChatPage.tsx`, `QuizPage.tsx`) pass `i18n.language` (imported from
  `frontend/src/i18n`) at call time — the language sent with a request is whatever the UI is
  showing at the moment the user sends it.

## Testing

- Frontend: existing vitest suites for pages with translated strings are updated so assertions
  check the rendered Vietnamese default text (since Vietnamese is now what actually renders
  first). Tests wrap components with the initialized i18n instance the same way the app does, no
  mocking needed since translations are static bundled JSON.
- Backend: existing pytest coverage for `chat.py`/`quiz.py`/`llm.py` gets a case per endpoint
  asserting the `language` field flows into the constructed system prompt (via the mocked Gemini
  client), plus a default-omitted case asserting it defaults to Vietnamese.
