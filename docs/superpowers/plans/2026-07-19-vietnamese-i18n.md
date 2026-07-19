# Vietnamese-default i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable i18n framework (react-i18next) to the frontend with Vietnamese as the default language and English as the second option, and make the backend's Gemini-driven chat/quiz responses default to Vietnamese, following whichever language the UI is currently showing.

**Architecture:** `i18next` + `react-i18next` + `i18next-browser-languagedetector` (localStorage-only detection, `vi` fallback) initialized once at app startup, with per-feature-area JSON translation namespaces (`common`, `auth`, `documents`, `search`, `chat`, `quiz`). Every page/component swaps hardcoded strings for `useTranslation()` calls. The frontend sends the active `i18n.language` with chat and quiz-generation requests; the backend threads a `language` field through `SendMessageRequest`/`GenerateQuizRequest` into the Gemini system prompts in `llm.py`, defaulting to `"vi"` everywhere.

**Tech Stack:** React 18 + TypeScript + Vite (frontend), FastAPI + Pydantic + `google-genai` (backend), Vitest + Testing Library (frontend tests), pytest (backend tests).

## Global Constraints

- Default language is Vietnamese (`vi`) everywhere — UI, and LLM responses (chat + quiz) — per `docs/superpowers/specs/2026-07-19-vietnamese-i18n-design.md`.
- Supported languages: `vi` and `en` only.
- Language persists via `localStorage` only (detector order: `['localStorage']`); no backend user-profile storage.
- No custom `LanguageContext` — react-i18next's own internal state (via `initReactI18next`) is the single source of truth for the active language on the frontend.
- Namespace-to-file mapping is fixed: `common` (AppNav/AppShell), `auth` (Login/Signup), `documents` (Documents/PreviewModal), `search` (Search), `chat` (Chat), `quiz` (Quiz/QuizHistory).
- Backend `language` field is `Literal["vi", "en"]` defaulting to `"vi"` at every layer (request model default and each `llm.py` function's own default).
- Dynamic/external content is NOT translated: Supabase auth error messages, document filenames, quiz question content, chat answer content, quiz history composed from live data.

---

### Task 1: i18n infrastructure + translation content

**Files:**
- Modify: `frontend/package.json` (add dependencies)
- Create: `frontend/src/i18n/index.ts`
- Create: `frontend/src/i18n/locales/vi/common.json`
- Create: `frontend/src/i18n/locales/en/common.json`
- Create: `frontend/src/i18n/locales/vi/auth.json`
- Create: `frontend/src/i18n/locales/en/auth.json`
- Create: `frontend/src/i18n/locales/vi/documents.json`
- Create: `frontend/src/i18n/locales/en/documents.json`
- Create: `frontend/src/i18n/locales/vi/search.json`
- Create: `frontend/src/i18n/locales/en/search.json`
- Create: `frontend/src/i18n/locales/vi/chat.json`
- Create: `frontend/src/i18n/locales/en/chat.json`
- Create: `frontend/src/i18n/locales/vi/quiz.json`
- Create: `frontend/src/i18n/locales/en/quiz.json`
- Modify: `frontend/src/main.tsx:1-7` (import `./i18n` before `App`)
- Modify: `frontend/src/test-setup.ts:1-3` (import `../src/i18n` so all test files get an initialized instance)
- Test: `frontend/tests/i18n.test.ts`

**Interfaces:**
- Produces: default export `i18n` from `frontend/src/i18n/index.ts` — an initialized i18next instance, importable as `import i18n from '../i18n'` (relative to `src/`). Namespaces available: `common`, `auth`, `documents`, `search`, `chat`, `quiz`, each in `vi` and `en`. Every later task's `useTranslation('<namespace>')` calls read from these bundles — **the exact keys below are final; later tasks must use them as-is, not invent new ones.**

- [ ] **Step 1: Write the failing test**

`frontend/tests/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

import i18n from '../src/i18n'

describe('i18n', () => {
  it('defaults to Vietnamese when nothing is in localStorage', () => {
    expect(i18n.language).toBe('vi')
    expect(i18n.t('common:appName')).toBe('DigiAgent')
    expect(i18n.t('common:signOut')).toBe('Đăng xuất')
  })

  it('has matching English translations for the same keys', () => {
    expect(i18n.getFixedT('en', 'common')('signOut')).toBe('Sign out')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- i18n.test.ts`
Expected: FAIL — cannot find module `../src/i18n`

- [ ] **Step 3: Install dependencies**

Run: `cd frontend && npm install i18next react-i18next i18next-browser-languagedetector`

- [ ] **Step 4: Create translation files**

`frontend/src/i18n/locales/vi/common.json`:
```json
{
  "appName": "DigiAgent",
  "tagline": "Cơ sở kiến thức",
  "nav": {
    "documents": "Tài liệu",
    "search": "Tìm kiếm",
    "chat": "Trợ lý AI",
    "quiz": "Đố vui",
    "quizHistory": "Lịch sử đố vui"
  },
  "uploadDocuments": "Tải lên tài liệu",
  "signOut": "Đăng xuất",
  "topSearchLabel": "Tìm kiếm tài liệu của bạn",
  "topSearchPlaceholder": "Tìm kiếm tài liệu của bạn…",
  "pageInfo": {
    "documents": { "title": "Tài liệu", "subtitle": "Cơ sở kiến thức đã lập chỉ mục của bạn" },
    "search": { "title": "Tìm kiếm", "subtitle": "Tìm đoạn văn trong mọi tài liệu" },
    "chat": { "title": "Trợ lý AI", "subtitle": "Câu trả lời dựa trên tài liệu của bạn" },
    "quiz": { "title": "Đố vui", "subtitle": "Tự kiểm tra kiến thức của bạn" },
    "quizHistory": { "title": "Lịch sử đố vui", "subtitle": "Mọi lượt làm bài bạn đã thực hiện" }
  },
  "languageSwitcher": {
    "vietnamese": "Tiếng Việt",
    "english": "English"
  }
}
```

`frontend/src/i18n/locales/en/common.json`:
```json
{
  "appName": "DigiAgent",
  "tagline": "Knowledge Base",
  "nav": {
    "documents": "Documents",
    "search": "Search",
    "chat": "AI Assistant",
    "quiz": "Quiz",
    "quizHistory": "Quiz History"
  },
  "uploadDocuments": "Upload documents",
  "signOut": "Sign out",
  "topSearchLabel": "Search your documents",
  "topSearchPlaceholder": "Search your documents…",
  "pageInfo": {
    "documents": { "title": "Documents", "subtitle": "Your indexed knowledge base" },
    "search": { "title": "Search", "subtitle": "Find passages across every document" },
    "chat": { "title": "AI Assistant", "subtitle": "Grounded answers from your documents" },
    "quiz": { "title": "Quizzes", "subtitle": "Test yourself on your material" },
    "quizHistory": { "title": "Quiz History", "subtitle": "Every attempt you have taken" }
  },
  "languageSwitcher": {
    "vietnamese": "Tiếng Việt",
    "english": "English"
  }
}
```

`frontend/src/i18n/locales/vi/auth.json`:
```json
{
  "login": "Đăng nhập",
  "signup": "Đăng ký",
  "email": "Email",
  "password": "Mật khẩu",
  "noAccount": "Chưa có tài khoản?",
  "alreadyHaveAccount": "Đã có tài khoản?",
  "signUpLink": "Đăng ký",
  "loginLink": "Đăng nhập"
}
```

`frontend/src/i18n/locales/en/auth.json`:
```json
{
  "login": "Log in",
  "signup": "Sign up",
  "email": "Email",
  "password": "Password",
  "noAccount": "No account?",
  "alreadyHaveAccount": "Already have an account?",
  "signUpLink": "Sign up",
  "loginLink": "Log in"
}
```

`frontend/src/i18n/locales/vi/documents.json`:
```json
{
  "status": {
    "uploading": "Đang tải lên…",
    "processing": "Đang xử lý…",
    "ready": "Đã lập chỉ mục",
    "failed": "Thất bại"
  },
  "filters": {
    "all": "Tất cả",
    "pdf": "PDF",
    "docx": "Tài liệu",
    "other": "Văn bản"
  },
  "errors": {
    "upload": "Tải lên tài liệu thất bại",
    "rename": "Đổi tên tài liệu thất bại",
    "delete": "Xóa tài liệu thất bại",
    "download": "Tải xuống tài liệu thất bại",
    "load": "Tải danh sách tài liệu thất bại"
  },
  "uploadLabel": "Tải lên tài liệu",
  "dragHint": "Kéo tệp vào đây, hoặc nhấp để chọn",
  "emptyTitle": "Xây dựng kho kiến thức của bạn",
  "emptyBody": "Tải lên tệp PDF, Word, văn bản hoặc Markdown. Chúng tôi sẽ lập chỉ mục từng đoạn để bạn có thể tìm kiếm, hỏi đáp và làm bài đố vui — tất cả đều dựa trên tài liệu của chính bạn.",
  "documentCount": "{{count}} tài liệu",
  "uploadedOn": "Tải lên {{date}}",
  "preview": "Xem trước",
  "download": "Tải xuống",
  "rename": "Đổi tên",
  "delete": "Xóa",
  "renamePromptLabel": "Tên tệp mới",
  "deleteConfirm": "Xóa {{filename}}?",
  "previewFailed": "Tải bản xem trước thất bại.",
  "close": "Đóng",
  "previewTitle": "Xem trước tài liệu"
}
```

`frontend/src/i18n/locales/en/documents.json`:
```json
{
  "status": {
    "uploading": "Uploading…",
    "processing": "Processing…",
    "ready": "Indexed",
    "failed": "Failed"
  },
  "filters": {
    "all": "All",
    "pdf": "PDF",
    "docx": "Docs",
    "other": "Text"
  },
  "errors": {
    "upload": "Failed to upload document",
    "rename": "Failed to rename document",
    "delete": "Failed to delete document",
    "download": "Failed to download document",
    "load": "Failed to load documents"
  },
  "uploadLabel": "Upload document",
  "dragHint": "Drag a file here, or click to browse",
  "emptyTitle": "Build your knowledge base",
  "emptyBody": "Upload PDFs, Word docs, text or Markdown files. We'll index every passage so you can search, ask, and quiz — all grounded in your own material.",
  "documentCount": "{{count}} documents",
  "uploadedOn": "Uploaded {{date}}",
  "preview": "Preview",
  "download": "Download",
  "rename": "Rename",
  "delete": "Delete",
  "renamePromptLabel": "New filename",
  "deleteConfirm": "Delete {{filename}}?",
  "previewFailed": "Failed to load preview.",
  "close": "Close",
  "previewTitle": "Document preview"
}
```

`frontend/src/i18n/locales/vi/search.json`:
```json
{
  "fileTypes": {
    "all": "Tất cả loại",
    "pdf": "PDF",
    "docx": "DOCX",
    "text": "Văn bản"
  },
  "recent": "Gần đây",
  "inputLabel": "Tìm kiếm tài liệu của bạn",
  "inputPlaceholder": "Tìm kiếm trong tất cả tài liệu của bạn…",
  "searchButton": "Tìm kiếm",
  "errors": {
    "searchFailed": "Tìm kiếm thất bại, vui lòng thử lại"
  },
  "searching": "Đang tìm kiếm...",
  "noResults": "Không tìm thấy kết quả",
  "matchPercent": "Khớp {{pct}}%",
  "passageOf": "đoạn {{index}} trên {{total}}",
  "morePassages": "+{{count}} đoạn khác trong tài liệu này",
  "loadMore": "Xem thêm"
}
```

`frontend/src/i18n/locales/en/search.json`:
```json
{
  "fileTypes": {
    "all": "All types",
    "pdf": "PDF",
    "docx": "DOCX",
    "text": "Text"
  },
  "recent": "Recent",
  "inputLabel": "Search your documents",
  "inputPlaceholder": "Search across all your documents…",
  "searchButton": "Search",
  "errors": {
    "searchFailed": "Search failed, try again"
  },
  "searching": "Searching...",
  "noResults": "No results found",
  "matchPercent": "{{pct}}% match",
  "passageOf": "passage {{index}} of {{total}}",
  "morePassages": "+{{count}} more passages in this document",
  "loadMore": "Load more"
}
```

`frontend/src/i18n/locales/vi/chat.json`:
```json
{
  "errors": {
    "sessionStart": "Không thể bắt đầu phiên trò chuyện, vui lòng tải lại trang",
    "sendFailed": "Gửi tin nhắn thất bại, vui lòng thử lại"
  },
  "badges": {
    "web": "Web",
    "documentsAndGeneral": "Tài liệu + Kiến thức chung",
    "general": "Kiến thức chung"
  },
  "citation": "{{filename}} — đoạn {{index}} trên {{total}}",
  "inputLabel": "Đặt câu hỏi",
  "inputPlaceholder": "Đặt câu hỏi dựa trên tài liệu của bạn…",
  "webSearchLabel": "Tìm kiếm trên web cho tin nhắn này",
  "send": "Gửi"
}
```

`frontend/src/i18n/locales/en/chat.json`:
```json
{
  "errors": {
    "sessionStart": "Failed to start chat session, try refreshing the page",
    "sendFailed": "Failed to send message, try again"
  },
  "badges": {
    "web": "Web",
    "documentsAndGeneral": "Documents + General knowledge",
    "general": "General knowledge"
  },
  "citation": "{{filename}} — passage {{index}} of {{total}}",
  "inputLabel": "Ask a question",
  "inputPlaceholder": "Ask a question grounded in your documents…",
  "webSearchLabel": "Search the web for this message",
  "send": "Send"
}
```

`frontend/src/i18n/locales/vi/quiz.json`:
```json
{
  "loadingQuiz": "Đang tải bài đố vui…",
  "errors": {
    "loadQuiz": "Tải bài đố vui thất bại, vui lòng thử lại",
    "generateQuiz": "Tạo bài đố vui thất bại, vui lòng thử lại",
    "loadHistory": "Tải lịch sử đố vui thất bại, vui lòng thử lại"
  },
  "stats": {
    "taken": "Số bài đã làm",
    "avgScore": "Điểm trung bình"
  },
  "generateTitle": "Tạo bài đố vui mới",
  "generateBody": "Chọn một hoặc nhiều tài liệu và chúng tôi sẽ tạo câu hỏi trắc nghiệm dựa hoàn toàn vào nội dung đó.",
  "createQuiz": "Tạo bài đố vui",
  "recentAttempts": "Các lượt làm gần đây",
  "noAttempts": "Chưa có lượt làm bài đố vui nào",
  "scoreOf": "{{score}} / {{total}}",
  "backToQuizzes": "← Quay lại danh sách đố vui",
  "generateHeading": "Tạo bài đố vui",
  "step1": "1 · Chọn tài liệu nguồn",
  "step2": "2 · Số lượng câu hỏi",
  "generateButton": "Tạo {{count}} câu hỏi",
  "exit": "✕ Thoát",
  "questionOf": "Câu {{index}} trên {{total}}",
  "fewerGenerated": "Đã tạo {{actual}} trên {{requested}} câu hỏi yêu cầu — các tài liệu đã chọn không có đủ nội dung riêng biệt để tạo thêm.",
  "previous": "Trước",
  "nextQuestion": "Câu tiếp theo",
  "finishQuiz": "Hoàn thành",
  "result": {
    "great": "Xuất sắc!",
    "nice": "Khá tốt",
    "keep": "Cố gắng thêm nhé"
  },
  "resultBody": "Bạn đã trả lời đúng <strong>{{score}}</strong> trên {{total}} câu hỏi.",
  "retakeQuiz": "Làm lại bài",
  "backToQuizzesButton": "Quay lại danh sách đố vui",
  "takeQuiz": "Làm bài đố vui",
  "retake": "Làm lại"
}
```

`frontend/src/i18n/locales/en/quiz.json`:
```json
{
  "loadingQuiz": "Loading quiz…",
  "errors": {
    "loadQuiz": "Failed to load quiz, try again",
    "generateQuiz": "Failed to generate quiz, try again",
    "loadHistory": "Failed to load quiz history, try again"
  },
  "stats": {
    "taken": "Quizzes taken",
    "avgScore": "Average score"
  },
  "generateTitle": "Generate a new quiz",
  "generateBody": "Pick one or more documents and we'll build multiple-choice questions grounded strictly in their content.",
  "createQuiz": "Create quiz",
  "recentAttempts": "Recent attempts",
  "noAttempts": "No quiz attempts yet",
  "scoreOf": "{{score}} / {{total}}",
  "backToQuizzes": "← Back to quizzes",
  "generateHeading": "Generate a quiz",
  "step1": "1 · Choose source documents",
  "step2": "2 · Number of questions",
  "generateButton": "Generate {{count}} questions",
  "exit": "✕ Exit",
  "questionOf": "Question {{index}} of {{total}}",
  "fewerGenerated": "Generated {{actual}} of the requested {{requested}} questions — the selected documents didn't have enough distinct content for more.",
  "previous": "Previous",
  "nextQuestion": "Next question",
  "finishQuiz": "Finish quiz",
  "result": {
    "great": "Great work!",
    "nice": "Nice effort",
    "keep": "Keep practicing"
  },
  "resultBody": "You answered <strong>{{score}}</strong> of {{total}} questions correctly.",
  "retakeQuiz": "Retake quiz",
  "backToQuizzesButton": "Back to quizzes",
  "takeQuiz": "Take a quiz",
  "retake": "Retake"
}
```

- [ ] **Step 5: Create `frontend/src/i18n/index.ts`**

```ts
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import authEn from './locales/en/auth.json'
import chatEn from './locales/en/chat.json'
import commonEn from './locales/en/common.json'
import documentsEn from './locales/en/documents.json'
import quizEn from './locales/en/quiz.json'
import searchEn from './locales/en/search.json'
import authVi from './locales/vi/auth.json'
import chatVi from './locales/vi/chat.json'
import commonVi from './locales/vi/common.json'
import documentsVi from './locales/vi/documents.json'
import quizVi from './locales/vi/quiz.json'
import searchVi from './locales/vi/search.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      vi: {
        common: commonVi,
        auth: authVi,
        documents: documentsVi,
        search: searchVi,
        chat: chatVi,
        quiz: quizVi,
      },
      en: {
        common: commonEn,
        auth: authEn,
        documents: documentsEn,
        search: searchEn,
        chat: chatEn,
        quiz: quizEn,
      },
    },
    fallbackLng: 'vi',
    defaultNS: 'common',
    ns: ['common', 'auth', 'documents', 'search', 'chat', 'quiz'],
    detection: { order: ['localStorage'], caches: ['localStorage'] },
    interpolation: { escapeValue: false },
  })

export default i18n
```

- [ ] **Step 6: Wire into app startup and test setup**

`frontend/src/main.tsx` — add the import as the first line (`./i18n` — the file is a sibling of `main.tsx`):
```ts
import './i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import './index.css'
```

`frontend/src/test-setup.ts` — add at the top:
```ts
import './i18n'
import '@testing-library/jest-dom/vitest'
```
(rest of the file unchanged)

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npm test -- i18n.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/i18n frontend/src/main.tsx frontend/src/test-setup.ts frontend/tests/i18n.test.ts
git commit -m "feat: add react-i18next infrastructure with Vietnamese-default translations"
```

---

### Task 2: AppNav + AppShell — common namespace + language switcher

**Files:**
- Modify: `frontend/src/components/AppNav.tsx`
- Modify: `frontend/src/components/AppShell.tsx`
- Test: `frontend/tests/components/AppNav.test.tsx`
- Test: `frontend/tests/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `common` namespace keys from Task 1 (`nav.*`, `uploadDocuments`, `signOut`, `topSearchLabel`, `topSearchPlaceholder`, `pageInfo.*`, `languageSwitcher.*`, `appName`, `tagline`).
- Produces: no new keys; language switcher lives only in `AppNav`.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/tests/components/AppNav.test.tsx` entirely with:
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'sarah@example.com' } },
    signOut: vi.fn(),
  }),
}))

import { listDocuments } from '../../src/lib/api'
import { AppNav } from '../../src/components/AppNav'
import i18n from '../../src/i18n'
import { renderWithQueryClient } from '../test-utils'

function renderAppNav() {
  return renderWithQueryClient(
    <MemoryRouter>
      <AppNav />
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  afterEach(() => {
    i18n.changeLanguage('vi')
    window.localStorage.clear()
  })

  it('renders links to Documents, Search, AI Assistant, Quiz, and Quiz History in Vietnamese by default', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Tài liệu' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Tìm kiếm' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Trợ lý AI' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Đố vui' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Lịch sử đố vui' })).toHaveAttribute(
      'href',
      '/quiz/history',
    )
  })

  it('shows the live document count next to Documents', async () => {
    ;(listDocuments as any).mockResolvedValue([{ id: '1' }, { id: '2' }])
    renderAppNav()

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('shows the signed-in user email', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByText('sarah@example.com')).toBeInTheDocument()
  })

  it('switches nav labels to English when the English toggle is clicked', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
  })
})
```

Replace `frontend/tests/components/AppShell.test.tsx` entirely with:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}))

import { AppShell } from '../../src/components/AppShell'
import i18n from '../../src/i18n'

describe('AppShell', () => {
  afterEach(() => {
    i18n.changeLanguage('vi')
  })

  it('renders the Vietnamese title and subtitle for a known route', () => {
    render(
      <MemoryRouter initialEntries={['/documents']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Tài liệu' })).toBeInTheDocument()
    expect(screen.getByText('Cơ sở kiến thức đã lập chỉ mục của bạn')).toBeInTheDocument()
  })

  it('falls back to the app name for an unknown route', () => {
    render(
      <MemoryRouter initialEntries={['/unknown']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'DigiAgent' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- AppNav.test.tsx AppShell.test.tsx`
Expected: FAIL — text 'Documents' etc. not found (still English), no 'English' button exists yet

- [ ] **Step 3: Update `AppNav.tsx`**

Replace the full file with:
```tsx
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../contexts/AuthContext'
import { listDocuments } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const LINK_PATHS = ['/documents', '/search', '/chat', '/quiz', '/quiz/history'] as const

const LINK_INFO: Record<(typeof LINK_PATHS)[number], { labelKey: string; badge: boolean }> = {
  '/documents': { labelKey: 'nav.documents', badge: true },
  '/search': { labelKey: 'nav.search', badge: false },
  '/chat': { labelKey: 'nav.chat', badge: false },
  '/quiz': { labelKey: 'nav.quiz', badge: false },
  '/quiz/history': { labelKey: 'nav.quizHistory', badge: false },
}

export function AppNav() {
  const { t, i18n } = useTranslation('common')
  const location = useLocation()
  const { session, signOut } = useAuth()
  const documentsQuery = useQuery({ queryKey: queryKeys.documents, queryFn: listDocuments })
  const docCount = documentsQuery.data?.length ?? 0
  const email = session?.user?.email ?? ''
  const initials = email.slice(0, 2).toUpperCase()

  return (
    <nav className="flex w-[264px] flex-shrink-0 flex-col bg-sidebar px-4 py-[22px] text-[#C4CED4]">
      <div className="flex items-center gap-[11px] px-2 pb-[22px] pt-1">
        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px_11px_11px_4px] border-[3px] border-accent">
          <span className="h-[5px] w-[5px] rounded-full bg-accent" />
        </div>
        <div>
          <div className="text-lg font-extrabold leading-none tracking-tight text-white">
            {t('appName')}
          </div>
          <div className="mt-[3px] text-[10px] font-semibold tracking-wide text-accent">
            {t('tagline')}
          </div>
        </div>
      </div>

      <div className="mb-[18px] flex gap-1 px-2">
        <button
          type="button"
          onClick={() => i18n.changeLanguage('vi')}
          aria-pressed={i18n.language === 'vi'}
          className={
            i18n.language === 'vi'
              ? 'rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white'
              : 'rounded-md px-2.5 py-1 text-xs font-semibold text-[#7C8992] hover:text-white'
          }
        >
          {t('languageSwitcher.vietnamese')}
        </button>
        <button
          type="button"
          onClick={() => i18n.changeLanguage('en')}
          aria-pressed={i18n.language === 'en'}
          className={
            i18n.language === 'en'
              ? 'rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white'
              : 'rounded-md px-2.5 py-1 text-xs font-semibold text-[#7C8992] hover:text-white'
          }
        >
          {t('languageSwitcher.english')}
        </button>
      </div>

      <Link
        to="/documents"
        className="mb-[18px] flex items-center justify-center gap-2 rounded-[10px] bg-accent py-3 font-sans text-sm font-bold text-white hover:bg-accent-hover"
      >
        {t('uploadDocuments')}
      </Link>

      <div className="flex flex-col gap-[3px]">
        {LINK_PATHS.map((path) => {
          const info = LINK_INFO[path]
          return (
            <Link
              key={path}
              to={path}
              className={
                location.pathname === path
                  ? 'flex items-center gap-3 rounded-[9px] bg-accent px-3 py-[11px] text-sm font-semibold text-white'
                  : 'flex items-center gap-3 rounded-[9px] px-3 py-[11px] text-sm font-semibold text-[#AEBBC2] hover:bg-white/5'
              }
            >
              <span className="flex-1 text-left">{t(info.labelKey)}</span>
              {info.badge && docCount > 0 && (
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-bold text-[#6BD47C]">
                  {docCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="mt-auto flex items-center gap-[10px] pt-[18px]">
        <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-hover text-[13px] font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{email}</div>
        </div>
        <button
          onClick={signOut}
          aria-label={t('signOut')}
          className="flex-shrink-0 text-[11px] font-semibold text-[#7C8992] hover:text-white"
        >
          {t('signOut')}
        </button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Update `AppShell.tsx`**

Replace the full file with:
```tsx
import { KeyboardEvent, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AppNav } from './AppNav'

const PAGE_INFO_KEYS: Record<string, string> = {
  '/documents': 'documents',
  '/search': 'search',
  '/chat': 'chat',
  '/quiz': 'quiz',
  '/quiz/history': 'quizHistory',
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  const pageKey = PAGE_INFO_KEYS[location.pathname]
  const title = pageKey ? t(`pageInfo.${pageKey}.title`) : t('appName')
  const subtitle = pageKey ? t(`pageInfo.${pageKey}.subtitle`) : ''

  function handleTopSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const value = (event.target as HTMLInputElement).value.trim()
    if (!value) return
    navigate('/search', { state: { query: value } })
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-app-bg">
      <AppNav />
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[68px] flex-shrink-0 items-center gap-5 border-b border-line bg-white px-8">
          <div className="flex-1">
            <h1 className="m-0 text-xl font-extrabold tracking-tight">{title}</h1>
            <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>
          </div>
          <div className="flex w-[300px] items-center gap-2.5 rounded-[10px] border border-line bg-app-bg px-3.5 py-2">
            <input
              aria-label={t('topSearchLabel')}
              placeholder={t('topSearchPlaceholder')}
              onKeyDown={handleTopSearchKey}
              className="w-full border-none bg-transparent font-sans text-sm text-ink outline-none"
            />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- AppNav.test.tsx AppShell.test.tsx`
Expected: PASS (4 + 2 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AppNav.tsx frontend/src/components/AppShell.tsx frontend/tests/components/AppNav.test.tsx frontend/tests/components/AppShell.test.tsx
git commit -m "feat: translate AppNav/AppShell to Vietnamese-default, add language switcher"
```

---

### Task 3: Login + Signup pages — auth namespace

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/SignupPage.tsx`
- Test: `frontend/tests/pages/LoginPage.test.tsx`
- Test: `frontend/tests/pages/SignupPage.test.tsx` (new — no existing test file for SignupPage)

**Interfaces:**
- Consumes: `auth` namespace keys from Task 1 (`login`, `signup`, `email`, `password`, `noAccount`, `alreadyHaveAccount`, `signUpLink`, `loginLink`).
- Note: the Supabase `error` string shown in `<Alert>` is left untranslated (dynamic content from an external service, out of spec scope).

- [ ] **Step 1: Write the failing tests**

Replace `frontend/tests/pages/LoginPage.test.tsx` entirely with:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '../../src/contexts/AuthContext'
import { LoginPage } from '../../src/pages/LoginPage'
import { supabase } from '../../src/lib/supabaseClient'

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

describe('LoginPage', () => {
  it('renders the Vietnamese heading and labels by default', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Đăng ký' })).toBeInTheDocument()
  })

  it('calls signInWithPassword with entered credentials', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password123',
      })
    })
  })
})
```

Create `frontend/tests/pages/SignupPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '../../src/contexts/AuthContext'
import { SignupPage } from '../../src/pages/SignupPage'
import { supabase } from '../../src/lib/supabaseClient'

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

describe('SignupPage', () => {
  it('renders the Vietnamese heading and labels by default', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <SignupPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Đăng ký' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument()
  })

  it('calls signUp with entered credentials', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <SignupPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }))

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password123',
      })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- LoginPage.test.tsx SignupPage.test.tsx`
Expected: FAIL — Vietnamese text not found (pages still hardcoded English)

- [ ] **Step 3: Update `LoginPage.tsx`**

Replace the full file with:
```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
  const { t } = useTranslation('auth')
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
      return
    }
    navigate('/documents')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('login')}</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-muted">
              {t('email')}
            </label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('password')}
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            {t('login')}
          </Button>
          <p className="text-sm text-muted">
            {t('noAccount')}{' '}
            <Link to="/signup" className="text-accent-hover hover:underline">
              {t('signUpLink')}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Update `SignupPage.tsx`**

Replace the full file with:
```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function SignupPage() {
  const { t } = useTranslation('auth')
  const { signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { error } = await signUp(email, password)
    if (error) {
      setError(error)
      return
    }
    navigate('/documents')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('signup')}</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="signup-email"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('email')}
            </label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="signup-password"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('password')}
            </label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            {t('signup')}
          </Button>
          <p className="text-sm text-muted">
            {t('alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-accent-hover hover:underline">
              {t('loginLink')}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- LoginPage.test.tsx SignupPage.test.tsx`
Expected: PASS (2 + 2 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/SignupPage.tsx frontend/tests/pages/LoginPage.test.tsx frontend/tests/pages/SignupPage.test.tsx
git commit -m "feat: translate Login/Signup pages to Vietnamese-default"
```

---

### Task 4: Documents page + PreviewModal — documents namespace

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Modify: `frontend/src/components/PreviewModal.tsx`
- Test: `frontend/tests/pages/DocumentsPage.test.tsx`
- Test: `frontend/tests/components/PreviewModal.test.tsx`

**Interfaces:**
- Consumes: `documents` namespace keys from Task 1 (`status.*`, `filters.*`, `errors.*`, `uploadLabel`, `dragHint`, `emptyTitle`, `emptyBody`, `documentCount`, `uploadedOn`, `preview`, `download`, `rename`, `delete`, `renamePromptLabel`, `deleteConfirm`, `previewFailed`, `close`, `previewTitle`).

- [ ] **Step 1: Read the existing tests to update in place**

Read `frontend/tests/pages/DocumentsPage.test.tsx` and `frontend/tests/components/PreviewModal.test.tsx` in full before editing — update every assertion that checks now-translated English text to its Vietnamese equivalent from the table below, and every `window.prompt`/`window.confirm` string assertion (`'New filename'`, `` `Delete ${filename}?` ``) to the Vietnamese versions. Do not change assertions on dynamic values (filenames, counts, dates).

| English (old) | Vietnamese (new) |
|---|---|
| `Uploading…` | `Đang tải lên…` |
| `Processing…` | `Đang xử lý…` |
| `Indexed` | `Đã lập chỉ mục` |
| `Failed` | `Thất bại` |
| `All` / `PDF` / `Docs` / `Text` (filter buttons) | `Tất cả` / `PDF` / `Tài liệu` / `Văn bản` |
| `Failed to upload document` | `Tải lên tài liệu thất bại` |
| `Failed to rename document` | `Đổi tên tài liệu thất bại` |
| `Failed to delete document` | `Xóa tài liệu thất bại` |
| `Failed to download document` | `Tải xuống tài liệu thất bại` |
| `Failed to load documents` | `Tải danh sách tài liệu thất bại` |
| `Upload document` | `Tải lên tài liệu` |
| `Drag a file here, or click to browse` | `Kéo tệp vào đây, hoặc nhấp để chọn` |
| `Build your knowledge base` | `Xây dựng kho kiến thức của bạn` |
| `{n} documents` | `{n} tài liệu` |
| `Uploaded {date}` | `Tải lên {date}` |
| `Preview` / `Download` / `Rename` / `Delete` (buttons) | `Xem trước` / `Tải xuống` / `Đổi tên` / `Xóa` |
| `New filename` (prompt) | `Tên tệp mới` |
| `` `Delete ${name}?` `` (confirm) | `` `Xóa ${name}?` `` |
| `Failed to load preview.` | `Tải bản xem trước thất bại.` |
| `Close` | `Đóng` |
| `Document preview` (iframe `title` attr, found via `screen.getByTitle(...)`) | `Xem trước tài liệu` |

Note: `DocumentsPage.test.tsx`'s rename/delete tests use `vi.stubGlobal('prompt', ...)` / `vi.stubGlobal('confirm', ...)` and only assert on the mocked *return value* effect, not on the label text passed to `window.prompt`/`window.confirm` — so the `New filename` / `` `Delete ${name}?` `` rows above apply to the `DocumentsPage.tsx` source change only; no test assertion needs editing for them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- DocumentsPage.test.tsx PreviewModal.test.tsx`
Expected: FAIL — Vietnamese text not found

- [ ] **Step 3: Update `DocumentsPage.tsx`**

Replace the full file with:
```tsx
import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import {
  DocumentListItem,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'
import { queryKeys } from '../lib/queryKeys'

const STATUS_VARIANT = {
  uploading: 'gray',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
} as const

const FILTERS = [
  { id: 'all', labelKey: 'filters.all' },
  { id: 'pdf', labelKey: 'filters.pdf' },
  { id: 'docx', labelKey: 'filters.docx' },
  { id: 'other', labelKey: 'filters.other' },
] as const

function matchesFilter(fileType: string, filter: (typeof FILTERS)[number]['id']) {
  if (filter === 'all') return true
  if (filter === 'pdf') return fileType === 'pdf'
  if (filter === 'docx') return fileType === 'docx'
  return fileType !== 'pdf' && fileType !== 'docx'
}

export function DocumentsPage() {
  const { t } = useTranslation('documents')
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const queryClient = useQueryClient()

  const documentsQuery = useQuery({
    queryKey: queryKeys.documents,
    queryFn: listDocuments,
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'uploading' || d.status === 'processing')
        ? 3000
        : false,
  })
  const documents = documentsQuery.data ?? []
  const filtered = useMemo(
    () => documents.filter((d) => matchesFilter(d.file_type, filter)),
    [documents, filter],
  )

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.upload')),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameDocument(id, filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.rename')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.delete')),
  })

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    event.target.value = ''
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave() {
    setIsDraggingOver(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
  }

  function handleRename(doc: DocumentListItem) {
    const newName = window.prompt(t('renamePromptLabel'), doc.filename)
    if (!newName) return
    renameMutation.mutate({ id: doc.id, filename: newName })
  }

  function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(t('deleteConfirm', { filename: doc.filename }))) return
    deleteMutation.mutate(doc.id)
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError(t('errors.download'))
    }
  }

  const displayError = documentsQuery.isError ? t('errors.load') : error

  return (
    <div className="px-8 pb-12 pt-7">
      {displayError && (
        <div className="mb-5">
          <Alert>{displayError}</Alert>
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          isDraggingOver
            ? 'mb-6 rounded-[14px] border-2 border-accent bg-accent/5 p-4'
            : 'mb-6 rounded-[14px] border-2 border-dashed border-line p-4'
        }
      >
        <label
          htmlFor="upload-input"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t('uploadLabel')}
        </label>
        <p className="mb-2 text-sm text-muted">{t('dragHint')}</p>
        <input
          id="upload-input"
          type="file"
          onChange={handleUpload}
          className="block font-sans text-sm text-ink file:mr-4 file:rounded-[10px] file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-accent-hover hover:file:bg-app-bg"
        />
      </div>

      {documents.length === 0 && !documentsQuery.isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[22px] bg-ok-bg">
            <span className="text-4xl">📄</span>
          </div>
          <h2 className="mb-2 text-xl font-extrabold tracking-tight">{t('emptyTitle')}</h2>
          <p className="mb-6 max-w-[400px] text-[15px] leading-relaxed text-muted">
            {t('emptyBody')}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex gap-1 rounded-[10px] border border-line bg-white p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={
                    filter === f.id
                      ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                      : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
                  }
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="text-sm text-muted">{t('documentCount', { count: documents.length })}</span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {filtered.map((doc) => (
              <Card key={doc.id} className="flex flex-col gap-3.5 animate-fade-up">
                <div className="flex gap-3">
                  <div className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[11px] bg-app-bg">
                    <span className="font-mono text-[11px] font-bold text-muted">
                      {doc.file_type.toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[14.5px] font-bold leading-tight">
                      {doc.filename}
                    </div>
                    <div className="mt-1 text-xs text-faint">
                      {t('uploadedOn', { date: new Date(doc.uploaded_at).toLocaleDateString() })}
                    </div>
                  </div>
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-[#EEF2F3] pt-3">
                  {doc.status === 'ready' && (
                    <>
                      <Button variant="secondary" onClick={() => setPreviewing(doc)}>
                        {t('preview')}
                      </Button>
                      <Button variant="secondary" onClick={() => handleDownload(doc)}>
                        {t('download')}
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" onClick={() => handleRename(doc)}>
                    {t('rename')}
                  </Button>
                  <Button variant="danger" onClick={() => handleDelete(doc)}>
                    {t('delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 4: Update `PreviewModal.tsx`**

Replace the full file with:
```tsx
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'

import { Button } from './ui/Button'
import { Document, getDownloadUrl, getPreviewText } from '../lib/api'

type PreviewableDocument = Pick<Document, 'id' | 'file_type'>

export function PreviewModal({
  document,
  onClose,
}: {
  document: PreviewableDocument
  onClose: () => void
}) {
  const { t } = useTranslation('documents')
  const [content, setContent] = useState<{ kind: 'pdf' | 'markdown' | 'text'; value: string } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (document.file_type === 'pdf') {
        const url = await getDownloadUrl(document.id)
        if (!cancelled) setContent({ kind: 'pdf', value: url })
        return
      }
      if (document.file_type === 'docx') {
        const text = await getPreviewText(document.id)
        if (!cancelled) setContent({ kind: 'text', value: text })
        return
      }
      const url = await getDownloadUrl(document.id)
      const response = await fetch(url)
      if (!response.ok) {
        if (!cancelled) setContent({ kind: 'text', value: t('previewFailed') })
        return
      }
      const text = await response.text()
      if (!cancelled) {
        setContent({ kind: document.file_type === 'md' ? 'markdown' : 'text', value: text })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [document, t])

  return (
    <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-[14px] border border-line bg-white">
        <div className="flex shrink-0 justify-end border-b border-line p-4">
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
        <div className="overflow-auto p-4">
          {content?.kind === 'pdf' && (
            <iframe title={t('previewTitle')} src={content.value} width="100%" height="600" />
          )}
          {content?.kind === 'markdown' && (
            <div className="prose prose-sm max-w-none text-ink">
              <ReactMarkdown>{content.value}</ReactMarkdown>
            </div>
          )}
          {content?.kind === 'text' && (
            <pre className="whitespace-pre-wrap font-mono text-sm text-ink">{content.value}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- DocumentsPage.test.tsx PreviewModal.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/src/components/PreviewModal.tsx frontend/tests/pages/DocumentsPage.test.tsx frontend/tests/components/PreviewModal.test.tsx
git commit -m "feat: translate Documents page and preview modal to Vietnamese-default"
```

---

### Task 5: Search page — search namespace

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`
- Test: `frontend/tests/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: `search` namespace keys from Task 1 (`fileTypes.*`, `recent`, `inputLabel`, `inputPlaceholder`, `searchButton`, `errors.searchFailed`, `searching`, `noResults`, `matchPercent`, `passageOf`, `morePassages`, `loadMore`).

- [ ] **Step 1: Update the existing test**

Read `frontend/tests/pages/SearchPage.test.tsx` in full, then update every assertion checking now-translated text to Vietnamese using this table (dynamic values like counts/percentages/filenames stay as-is):

| English (old) | Vietnamese (new) |
|---|---|
| `Search your documents` (sr-only label, found via `screen.getByLabelText(...)` — used in nearly every test in this file) | `Tìm kiếm tài liệu của bạn` |
| `All types` / `PDF` / `DOCX` / `Text` (`PDF` and `DOCX` are identical in both languages, no change needed for those two) | `Tất cả loại` / `PDF` / `DOCX` / `Văn bản` |
| `Recent` (button) | `Gần đây` |
| `Search` (button) | `Tìm kiếm` |
| `Search failed, try again` (alert text) | `Tìm kiếm thất bại, vui lòng thử lại` |
| `Searching...` | `Đang tìm kiếm...` |
| `No results found` | `Không tìm thấy kết quả` |
| `{n}% match` | `Khớp {n}%` |
| `passage {i} of {n}` (e.g. `passage 3 of 5`) | `đoạn {i} trên {n}` (e.g. `đoạn 3 trên 5`) |
| `+{n} more passages in this document` (e.g. `+2 more passages in this document`) | `+{n} đoạn khác trong tài liệu này` (e.g. `+2 đoạn khác trong tài liệu này`) |
| `Load more` | `Xem thêm` |

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- SearchPage.test.tsx`
Expected: FAIL — Vietnamese text not found

- [ ] **Step 3: Update `SearchPage.tsx`**

Replace the full file with:
```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { search, SearchFileType, SearchResult } from '../lib/api'

const FILE_TYPE_IDS: (SearchFileType | '')[] = ['', 'pdf', 'docx', 'text']

const FILE_TYPE_LABEL_KEYS: Record<SearchFileType | '', string> = {
  '': 'fileTypes.all',
  pdf: 'fileTypes.pdf',
  docx: 'fileTypes.docx',
  text: 'fileTypes.text',
}

const PASSAGES_SHOWN = 3

function highlight(content: string, query: string) {
  const terms = [...new Set(query.trim().split(/\s+/).filter((t) => t.length >= 2))]
  if (terms.length === 0) return content
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return content.split(regex).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-[#FFF1B8] px-0.5 font-semibold text-ink">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

type SearchResultGroup = {
  document_id: string
  filename: string
  score: number
  passages: SearchResult[]
}

function groupByDocument(results: SearchResult[]): SearchResultGroup[] {
  const groups: SearchResultGroup[] = []
  const byId = new Map<string, SearchResultGroup>()
  for (const result of results) {
    let group = byId.get(result.document_id)
    if (!group) {
      group = { document_id: result.document_id, filename: result.filename, score: result.score, passages: [] }
      byId.set(result.document_id, group)
      groups.push(group)
    }
    group.passages.push(result)
  }
  return groups
}

export function SearchPage() {
  const { t } = useTranslation('search')
  const location = useLocation()
  const initialQuery = (location.state as { query?: string } | null)?.query ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [fileType, setFileType] = useState<SearchFileType | ''>('')
  const [recent, setRecent] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [visiblePerGroup, setVisiblePerGroup] = useState(PASSAGES_SHOWN)

  const searchMutation = useMutation({
    mutationFn: (vars: { q: string; fileType: SearchFileType | ''; recent: boolean; offset: number }) =>
      search(vars.q, { fileType: vars.fileType || undefined, recent: vars.recent, offset: vars.offset }),
  })

  function runSearch(q: string, ft: SearchFileType | '', rec: boolean) {
    searchMutation.mutate(
      { q, fileType: ft, recent: rec, offset: 0 },
      {
        onSuccess: (response) => {
          setResults(response.results)
          setHasMore(response.has_more)
          setVisiblePerGroup(PASSAGES_SHOWN)
        },
      },
    )
  }

  function loadMore() {
    if (!results) return
    searchMutation.mutate(
      { q: query, fileType, recent, offset: results.length },
      {
        onSuccess: (response) => {
          setResults([...results, ...response.results])
          setHasMore(response.has_more)
          setVisiblePerGroup((prev) => prev + PASSAGES_SHOWN)
        },
      },
    )
  }

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery, '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    runSearch(query, fileType, recent)
  }

  function handleFileTypeChange(id: SearchFileType | '') {
    setFileType(id)
    if (query.trim()) runSearch(query, id, recent)
  }

  function handleRecentToggle() {
    const next = !recent
    setRecent(next)
    if (query.trim()) runSearch(query, fileType, next)
  }

  const groups = results ? groupByDocument(results) : []

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-12 pt-7">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-3 rounded-[13px] border border-line bg-white py-1 pl-4 pr-1 shadow-sm"
      >
        <div className="flex-1">
          <label htmlFor="search-input" className="sr-only">
            {t('inputLabel')}
          </label>
          <Input
            id="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('inputPlaceholder')}
            className="border-none bg-transparent py-3 shadow-none focus:ring-0"
          />
        </div>
        <Button type="submit">{t('searchButton')}</Button>
      </form>

      <div className="my-4 flex flex-wrap items-center gap-2">
        {FILE_TYPE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => handleFileTypeChange(id)}
            className={
              fileType === id
                ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
            }
          >
            {t(FILE_TYPE_LABEL_KEYS[id])}
          </button>
        ))}
        <button
          type="button"
          onClick={handleRecentToggle}
          aria-pressed={recent}
          className={
            recent
              ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('recent')}
        </button>
      </div>

      {searchMutation.isError && <Alert>{t('errors.searchFailed')}</Alert>}
      {searchMutation.isPending && <p className="text-sm text-muted">{t('searching')}</p>}
      {results !== null && !searchMutation.isPending && groups.length === 0 && (
        <p className="text-sm text-muted">{t('noResults')}</p>
      )}
      {groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.document_id}>
              <Card className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-muted">{group.filename}</span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs font-semibold text-muted">
                    {t('matchPercent', { pct: Math.round(group.score * 100) })}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.passages.slice(0, visiblePerGroup).map((passage) => (
                    <li key={passage.chunk_index}>
                      <p className="text-xs text-faint">
                        {t('passageOf', { index: passage.chunk_index + 1, total: passage.total_chunks })}
                      </p>
                      <p className="text-[14.5px] leading-relaxed text-ink">
                        {highlight(passage.content, query)}
                      </p>
                    </li>
                  ))}
                </ul>
                {group.passages.length > visiblePerGroup && (
                  <p className="text-xs text-faint">
                    {t('morePassages', { count: group.passages.length - visiblePerGroup })}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {hasMore && !searchMutation.isPending && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore}>
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- SearchPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx frontend/tests/pages/SearchPage.test.tsx
git commit -m "feat: translate Search page to Vietnamese-default"
```

---

### Task 6: Chat page UI — chat namespace (UI text only, no backend wiring yet)

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Test: `frontend/tests/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: `chat` namespace keys from Task 1 (`errors.sessionStart`, `errors.sendFailed`, `badges.web`, `badges.documentsAndGeneral`, `badges.general`, `citation`, `inputLabel`, `inputPlaceholder`, `webSearchLabel`, `send`).
- This task does NOT change `sendChatMessage`'s signature or add the `language` param — that happens in Task 9, after the backend contract exists (Task 8). Doing it here would leave the frontend calling an API shape the backend doesn't support yet.

- [ ] **Step 1: Update the existing test**

Read `frontend/tests/pages/ChatPage.test.tsx` in full, then update every assertion checking now-translated text to Vietnamese using this table (message content, filenames are dynamic and unchanged):

| English (old) | Vietnamese (new) |
|---|---|
| `Ask a question` (label) | `Đặt câu hỏi` |
| `Search the web for this message` | `Tìm kiếm trên web cho tin nhắn này` |
| `Send` (button) | `Gửi` |
| `Web` (badge) | `Web` *(unchanged — same in both languages)* |
| `Documents + General knowledge` | `Tài liệu + Kiến thức chung` |
| `General knowledge` | `Kiến thức chung` |
| `policy.pdf — passage 2 of 3` | `policy.pdf — đoạn 2 trên 3` |
| `Failed to send message, try again` | `Gửi tin nhắn thất bại, vui lòng thử lại` |
| `Failed to start chat session, try refreshing the page` | `Không thể bắt đầu phiên trò chuyện, vui lòng tải lại trang` |

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ChatPage.test.tsx`
Expected: FAIL — Vietnamese text not found

- [ ] **Step 3: Update `ChatPage.tsx`**

Replace the full file with:
```tsx
import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function ChatPage() {
  const { t } = useTranslation('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)

  const sessionQuery = useQuery({
    queryKey: queryKeys.chatSession,
    queryFn: createChatSession,
    staleTime: Infinity,
  })

  const sendMutation = useMutation({
    mutationFn: (vars: { sessionId: string; content: string; webSearch: boolean }) =>
      sendChatMessage(vars.sessionId, vars.content, vars.webSearch),
    onSuccess: ({ user_message, assistant_message }) => {
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const sessionId = sessionQuery.data?.id
    if (!input.trim() || !sessionId) return
    sendMutation.mutate({ sessionId, content: input, webSearch })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-8">
          {sessionQuery.isError && <Alert>{t('errors.sessionStart')}</Alert>}
          {sendMutation.isError && <Alert>{t('errors.sendFailed')}</Alert>}
          {messages.map((message) =>
            message.role === 'user' ? (
              <div
                key={message.id}
                className="ml-auto max-w-[78%] rounded-[16px_16px_4px_16px] bg-sidebar px-4 py-3 text-[14.5px] leading-relaxed text-white animate-fade-up"
              >
                {message.content}
              </div>
            ) : (
              <div key={message.id} className="flex gap-3 animate-fade-up">
                <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] border border-accent/20 bg-ok-bg">
                  <span className="h-1 w-1 rounded-full bg-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-3.5 text-[15px] leading-relaxed text-sidebar">
                    {message.content}
                  </p>
                  {message.used_web_search ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">{t('badges.web')}</Badge>
                    </div>
                  ) : message.used_general_knowledge ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">
                        {message.citations.length > 0
                          ? t('badges.documentsAndGeneral')
                          : t('badges.general')}
                      </Badge>
                    </div>
                  ) : null}
                  {message.citations.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {message.citations.map((citation) => (
                        <div
                          key={`${citation.document_id}-${citation.chunk_index}`}
                          className="rounded-lg border border-line border-l-[3px] border-l-accent bg-[#FBFDFB] px-3.5 py-3"
                        >
                          <span className="text-xs font-bold text-sidebar">
                            {t('citation', {
                              filename: citation.filename,
                              index: citation.chunk_index + 1,
                              total: citation.total_chunks,
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-line bg-white px-8 py-5">
        <form onSubmit={handleSubmit} className="mx-auto max-w-[760px] space-y-3">
          <div>
            <label
              htmlFor="chat-input"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('inputLabel')}
            </label>
            <Input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('inputPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
              />
              {t('webSearchLabel')}
            </label>
            <Button type="submit" disabled={sendMutation.isPending || !sessionQuery.data}>
              {t('send')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- ChatPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/tests/pages/ChatPage.test.tsx
git commit -m "feat: translate Chat page UI to Vietnamese-default"
```

---

### Task 7: Quiz + QuizHistory pages — quiz namespace

**Files:**
- Modify: `frontend/src/pages/QuizPage.tsx`
- Modify: `frontend/src/pages/QuizHistoryPage.tsx`
- Test: `frontend/tests/pages/QuizPage.test.tsx`
- Test: `frontend/tests/pages/QuizHistoryPage.test.tsx`

**Interfaces:**
- Consumes: `quiz` namespace keys from Task 1 (`loadingQuiz`, `errors.*`, `stats.*`, `generateTitle`, `generateBody`, `createQuiz`, `recentAttempts`, `noAttempts`, `scoreOf`, `backToQuizzes`, `generateHeading`, `step1`, `step2`, `generateButton`, `exit`, `questionOf`, `fewerGenerated`, `previous`, `nextQuestion`, `finishQuiz`, `result.*`, `resultBody`, `retakeQuiz`, `backToQuizzesButton`, `takeQuiz`, `retake`).
- Uses react-i18next's `<Trans>` component for `resultBody` to preserve the embedded `<strong>` tag around the score.
- Does NOT change `generateQuiz`'s signature — that's Task 9.

- [ ] **Step 1: Update the existing tests**

Read `frontend/tests/pages/QuizPage.test.tsx` and `frontend/tests/pages/QuizHistoryPage.test.tsx` in full, then update every assertion checking now-translated text to Vietnamese using this table (scores, filenames, dates, counts stay dynamic/unchanged):

| English (old) | Vietnamese (new) |
|---|---|
| `Loading quiz…` | `Đang tải bài đố vui…` |
| `Failed to load quiz, try again` | `Tải bài đố vui thất bại, vui lòng thử lại` |
| `Failed to generate quiz, try again` (alert text, `test_generation fails`) | `Tạo bài đố vui thất bại, vui lòng thử lại` |
| `Failed to load quiz history, try again` | `Tải lịch sử đố vui thất bại, vui lòng thử lại` |
| `Quizzes taken` | `Số bài đã làm` |
| `Average score` | `Điểm trung bình` |
| `Generate a new quiz` | `Tạo bài đố vui mới` |
| `Create quiz` (button — asserted via `screen.getByRole('button', { name: 'Create quiz' })` in 7 different tests in `QuizPage.test.tsx`) | `Tạo bài đố vui` |
| `Recent attempts` | `Các lượt làm gần đây` |
| `No quiz attempts yet` | `Chưa có lượt làm bài đố vui nào` |
| `← Back to quizzes` | `← Quay lại danh sách đố vui` |
| `Generate a quiz` (heading) | `Tạo bài đố vui` |
| `1 · Choose source documents` | `1 · Chọn tài liệu nguồn` |
| `2 · Number of questions` | `2 · Số lượng câu hỏi` |
| `Generate {n} questions` — asserted with regex, e.g. `screen.getByRole('button', { name: /Generate 8 questions/ })` and `/Generate 10 questions/` (both counts appear across tests) | `Tạo {n} câu hỏi` — update both regexes to `/Tạo 8 câu hỏi/` and `/Tạo 10 câu hỏi/` |
| `✕ Exit` | `✕ Thoát` |
| `Question {i} of {n}` | `Câu {i} trên {n}` |
| `Previous` (button, also asserted `.toBeDisabled()` on question 1) | `Trước` |
| `Next question` | `Câu tiếp theo` |
| `Finish quiz` | `Hoàn thành` |
| `` "Generated 2 of the requested 10 questions — the selected documents didn't have enough distinct content for more." `` (exact string in `screen.getByText(...)`) | `` "Đã tạo 2 trên 10 câu hỏi yêu cầu — các tài liệu đã chọn không có đủ nội dung riêng biệt để tạo thêm." `` |
| `Great work!` / `Nice effort` / `Keep practicing` | `Xuất sắc!` / `Khá tốt` / `Cố gắng thêm nhé` |
| `Retake quiz` | `Làm lại bài` |
| `Back to quizzes` (result view button) | `Quay lại danh sách đố vui` |
| `Take a quiz` | `Làm bài đố vui` |
| `Retake` (history row button) | `Làm lại` |
| `You answered X of Y questions correctly.` — was one string; now rendered from `resultBody` via `<Trans>`. The one existing assertion on this text is `screen.getByText('1', { selector: 'strong' })` (`QuizPage.test.tsx`), which only checks the `<strong>` element's content is the score — this still passes unchanged since `resultBody`'s `<strong>{{score}}</strong>` renders the same way. No edit needed for this specific assertion. | *(no change needed — see note)* |
| `` `7 / 10 — policy.pdf` `` (composed line in `QuizHistoryPage.test.tsx`, `{ exact: false }` match) | *(no change — this line has no static English words, only the score/filename/date separators, so it's left as plain JSX interpolation, not run through `t()`; do not edit this assertion)* |

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- QuizPage.test.tsx QuizHistoryPage.test.tsx`
Expected: FAIL — Vietnamese text not found

- [ ] **Step 3: Update `QuizPage.tsx`**

Replace the full file with:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { generateQuiz, getQuiz, listDocuments, listQuizAttempts, submitQuizAttempt, QuizAnswer } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const COUNT_OPTIONS = [5, 8, 10, 15]

type View = 'list' | 'config' | 'taking' | 'result'

export function QuizPage() {
  const { t } = useTranslation('quiz')
  const [view, setView] = useState<View>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Awaited<ReturnType<typeof generateQuiz>> | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<(QuizAnswer | null)[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitQuizAttempt>> | null>(null)
  const queryClient = useQueryClient()
  const selected = answers[qIndex]?.selected_option ?? null

  const navigate = useNavigate()
  const { quizId: retakeQuizId } = useParams<{ quizId?: string }>()

  function goToList() {
    if (retakeQuizId) {
      navigate('/quiz')
      return
    }
    setView('list')
  }

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

  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? []
  const stats = useMemo(() => {
    if (attempts.length === 0) return { count: 0, avg: 0 }
    const avg = Math.round(
      (attempts.reduce((sum, a) => sum + a.score / a.total_questions, 0) / attempts.length) * 100,
    )
    return { count: attempts.length, avg }
  }, [attempts])

  const documentsQuery = useQuery({
    queryKey: queryKeys.documents,
    queryFn: listDocuments,
    enabled: view === 'config',
  })
  const readyDocuments = (documentsQuery.data ?? []).filter((d) => d.status === 'ready')

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

  const submitMutation = useMutation({
    mutationFn: (vars: { quizId: string; answers: QuizAnswer[] }) =>
      submitQuizAttempt(vars.quizId, vars.answers),
    onSuccess: (attemptResult) => {
      setResult(attemptResult)
      setView('result')
      queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts })
    },
  })

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleGenerate() {
    if (selectedIds.length === 0) return
    generateMutation.mutate({ documentIds: selectedIds, numQuestions })
  }

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

  const generateError = generateMutation.isError ? t('errors.generateQuiz') : null

  if (retakeQuizId && !quiz) {
    return (
      <div className="mx-auto max-w-[680px] px-8 pb-12 pt-7">
        {retakeQuery.isError ? (
          <Alert>{t('errors.loadQuiz')}</Alert>
        ) : (
          <p className="text-sm text-muted">{t('loadingQuiz')}</p>
        )}
      </div>
    )
  }

  if (view === 'list') {
    return (
      <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
        <div className="mb-7 flex gap-4">
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">{t('stats.taken')}</div>
            <div className="text-3xl font-extrabold tracking-tight">{stats.count}</div>
          </div>
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">{t('stats.avgScore')}</div>
            <div className="text-3xl font-extrabold tracking-tight text-accent">{stats.avg}%</div>
          </div>
        </div>

        <div className="mb-7 flex items-center gap-5 rounded-2xl bg-gradient-to-r from-sidebar to-sidebar-panel p-6">
          <div className="flex-1">
            <h2 className="mb-1.5 text-lg font-extrabold text-white">{t('generateTitle')}</h2>
            <p className="text-sm leading-relaxed text-[#AEBBC2]">{t('generateBody')}</p>
          </div>
          <Button onClick={() => setView('config')}>{t('createQuiz')}</Button>
        </div>

        <div className="mb-3.5 text-xs font-bold uppercase tracking-wide text-faint">
          {t('recentAttempts')}
        </div>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">{t('noAttempts')}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {attempts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-[13px] border border-line bg-white px-5 py-4"
              >
                <div className="flex-1 text-sm font-bold">{a.document_filenames.join(', ')}</div>
                <div className="text-sm font-bold">
                  {t('scoreOf', { score: a.score, total: a.total_questions })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (view === 'config') {
    return (
      <div className="mx-auto max-w-[720px] px-8 pb-12 pt-7">
        <button onClick={() => setView('list')} className="mb-4 text-sm font-semibold text-muted">
          {t('backToQuizzes')}
        </button>
        <h2 className="mb-5 text-xl font-extrabold tracking-tight">{t('generateHeading')}</h2>
        {generateError && (
          <div className="mb-4">
            <Alert>{generateError}</Alert>
          </div>
        )}

        <div className="mb-2.5 text-xs font-bold text-muted">{t('step1')}</div>
        <div className="mb-6 flex flex-col gap-2">
          {readyDocuments.map((doc) => {
            const checked = selectedIds.includes(doc.id)
            return (
              <label
                key={doc.id}
                className={
                  checked
                    ? 'flex items-center gap-3 rounded-[11px] border-[1.5px] border-accent bg-white px-4 py-3.5'
                    : 'flex items-center gap-3 rounded-[11px] border-[1.5px] border-line bg-white px-4 py-3.5'
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDocument(doc.id)}
                  aria-label={doc.filename}
                  className="h-5 w-5 rounded border-line text-accent focus:ring-accent"
                />
                <span className="flex-1 text-sm font-semibold">{doc.filename}</span>
              </label>
            )
          })}
        </div>

        <div className="mb-2.5 text-xs font-bold text-muted">{t('step2')}</div>
        <div className="mb-8 flex gap-2">
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setNumQuestions(n)}
              className={
                numQuestions === n
                  ? 'rounded-[10px] border-[1.5px] border-accent bg-ok-bg px-5 py-2.5 text-sm font-semibold text-accent-hover'
                  : 'rounded-[10px] border-[1.5px] border-line bg-white px-5 py-2.5 text-sm font-semibold text-muted'
              }
            >
              {n}
            </button>
          ))}
        </div>

        <Button onClick={handleGenerate} className="w-full" disabled={generateMutation.isPending}>
          {t('generateButton', { count: numQuestions })}
        </Button>
      </div>
    )
  }

  if (view === 'taking' && quiz) {
    const question = quiz.questions[qIndex]
    const revealed = selected !== null
    return (
      <div className="mx-auto max-w-[680px] px-8 pb-12 pt-7">
        <div className="mb-2 flex items-center gap-3.5">
          <button onClick={goToList} className="text-sm font-semibold text-faint">
            {t('exit')}
          </button>
          <span className="flex-1" />
          <span className="text-sm font-semibold text-muted">
            {t('questionOf', { index: qIndex + 1, total: quiz.questions.length })}
          </span>
        </div>
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${Math.round(((qIndex + (revealed ? 1 : 0)) / quiz.questions.length) * 100)}%`,
            }}
          />
        </div>

        {qIndex === 0 && quiz.actual_count < quiz.requested_count && (
          <p className="mb-4 text-sm text-warn">
            {t('fewerGenerated', { actual: quiz.actual_count, requested: quiz.requested_count })}
          </p>
        )}

        <div className="rounded-[18px] border border-line bg-white p-7 shadow-sm">
          <h2 className="mb-6 text-xl font-bold leading-snug">{question.question}</h2>
          <div className="flex flex-col gap-2.5">
            {question.options.map((option, index) => {
              const isSelected = selected === index
              const style = !revealed
                ? isSelected
                  ? 'border-[1.5px] border-accent bg-ok-bg'
                  : 'border-[1.5px] border-line bg-white'
                : isSelected
                  ? 'border-[1.5px] border-accent bg-ok-bg'
                  : 'border-[1.5px] border-line bg-white opacity-60'
              return (
                <button
                  key={option}
                  onClick={() => pickOption(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[14.5px] font-medium ${style}`}
                >
                  <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-app-bg text-sm font-bold">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="flex-1">{option}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={handlePrevious} disabled={qIndex === 0}>
            {t('previous')}
          </Button>
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? t('finishQuiz') : t('nextQuestion')}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'result' && result) {
    const pct = Math.round((result.score / result.total_questions) * 100)
    return (
      <div className="mx-auto max-w-[560px] px-8 pb-12 pt-10 text-center">
        <div className="mx-auto mb-6 flex h-[118px] w-[118px] items-center justify-center rounded-full bg-app-bg">
          <span className="text-3xl font-extrabold tracking-tight">{result.score}</span>
        </div>
        <h2 className="mb-2 text-2xl font-extrabold tracking-tight">
          {pct >= 75 ? t('result.great') : pct >= 50 ? t('result.nice') : t('result.keep')}
        </h2>
        <p className="mb-6 text-[15px] text-muted">
          <Trans
            i18nKey="quiz:resultBody"
            values={{ score: result.score, total: result.total_questions }}
            components={{ strong: <strong className="text-ink" /> }}
          />
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => setView('config')}>
            {t('retakeQuiz')}
          </Button>
          <Button onClick={goToList}>{t('backToQuizzesButton')}</Button>
        </div>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 4: Update `QuizHistoryPage.tsx`**

Replace the full file with:
```tsx
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const { t } = useTranslation('quiz')
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/quiz" className="text-sm font-semibold text-accent-hover hover:underline">
          {t('takeQuiz')}
        </Link>
      </div>
      {attemptsQuery.isError && <Alert>{t('errors.loadHistory')}</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="text-sm text-muted">{t('noAttempts')}</p>
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
                {t('retake')}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- QuizPage.test.tsx QuizHistoryPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/QuizPage.tsx frontend/src/pages/QuizHistoryPage.tsx frontend/tests/pages/QuizPage.test.tsx frontend/tests/pages/QuizHistoryPage.test.tsx
git commit -m "feat: translate Quiz and Quiz History pages to Vietnamese-default"
```

---

### Task 8: Backend — language-aware Gemini prompts

**Files:**
- Modify: `backend/app/services/llm.py`
- Modify: `backend/app/routers/chat.py`
- Modify: `backend/app/routers/quiz.py`
- Test: `backend/tests/test_llm.py`
- Test: `backend/tests/test_chat.py`
- Test: `backend/tests/test_quiz_generate.py`

**Interfaces:**
- Produces: `answer_from_chunks(question, chunks, history=None, language="vi")`, `answer_with_web_search(question, history=None, language="vi")`, `generate_quiz_questions(chunks, num_questions, language="vi")` in `llm.py` — Task 9's frontend wiring assumes the backend already accepts and defaults this field, but this task's own call sites (`chat.py`, `quiz.py`) already pass it through explicitly.
- `SendMessageRequest.language: Literal["vi", "en"] = "vi"`, `GenerateQuizRequest.language: Literal["vi", "en"] = "vi"`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_llm.py` (append at the end of the file):
```python
def test_answer_from_chunks_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "answer", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_from_chunks("question", [])

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction


def test_answer_from_chunks_uses_english_instruction_when_requested(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "answer", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_from_chunks("question", [], language="en")

    _, kwargs = fake_client.models.generate_content.call_args
    assert "English" in kwargs["config"].system_instruction


def test_answer_with_web_search_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="answer")
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_with_web_search("question")

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction


def test_generate_quiz_questions_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.generate_quiz_questions([{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c"}], 5)

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction
```

Update the three existing `test_llm.py` assertions on `system_instruction` that check exact equality (they'll otherwise still pass with a suffix appended, since `==` will now fail — the prompt text is no longer exactly the bare constant):
- `test_answer_from_chunks_calls_gemini_with_context_and_dynamic_thinking`: change `assert kwargs["config"].system_instruction == llm.DOCUMENTS_SYSTEM_PROMPT` to `assert kwargs["config"].system_instruction == llm.DOCUMENTS_SYSTEM_PROMPT + " Respond in Vietnamese."`
- `test_answer_from_chunks_uses_general_knowledge_prompt_when_no_chunks`: change `assert kwargs["config"].system_instruction == llm.GENERAL_KNOWLEDGE_SYSTEM_PROMPT` to `assert kwargs["config"].system_instruction == llm.GENERAL_KNOWLEDGE_SYSTEM_PROMPT + " Respond in Vietnamese."`
- `test_generate_quiz_questions_calls_gemini_with_forced_tool_and_context`: no change needed (it only checks substrings `"10" in kwargs["config"].system_instruction`, unaffected by an appended sentence).

Update `backend/tests/test_chat.py` — the three exact-args assertions need the new `language` argument appended (default `"vi"`, since none of these test requests set it):
- `test_send_message_answers_from_general_knowledge_when_nothing_clears_threshold`: change `answer_mock.assert_called_once_with("What is the capital of France?", [], [])` to `answer_mock.assert_called_once_with("What is the capital of France?", [], [], "vi")`
- `test_send_message_with_web_search_skips_retrieval`: change `web_search_mock.assert_called_once_with("What's the weather in Paris?", [])` to `web_search_mock.assert_called_once_with("What's the weather in Paris?", [], "vi")`
- `test_send_message_excludes_other_users_chunks`: change `answer_mock.assert_called_once_with("hello", [], [])` to `answer_mock.assert_called_once_with("hello", [], [], "vi")`

Add to `backend/tests/test_chat.py` (append at the end of the file):
```python
def test_send_message_passes_requested_language_to_llm(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(return_value={"answer": "answer", "used_general_knowledge": True})
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    _, headers = _create_user()
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "hello", "language": "en"},
        headers=headers,
    )

    assert response.status_code == 201
    answer_mock.assert_called_once_with("hello", [], [], "en")
```

Add to `backend/tests/test_quiz_generate.py` (append at the end of the file):
```python
def test_generate_quiz_passes_requested_language_to_llm(monkeypatch):
    from app.routers import quiz as quiz_router

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 3)

    questions = [_valid_question(document_id, i % 3) for i in range(5)]
    generate_mock = MagicMock(return_value=questions)
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5, "language": "en"},
        headers=headers,
    )

    assert response.status_code == 201
    generate_mock.assert_called_once_with(generate_mock.call_args[0][0], 5, "en")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_llm.py tests/test_chat.py tests/test_quiz_generate.py -v`
Expected: FAIL — `language` not accepted by `answer_from_chunks`/`answer_with_web_search`/`generate_quiz_questions`; `language` not a field on `SendMessageRequest`/`GenerateQuizRequest`

- [ ] **Step 3: Update `backend/app/services/llm.py`**

Add this helper right after the two prompt constants (after line 28, before `ANSWER_TOOL`):
```python
_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}


def _language_instruction(language: str) -> str:
    return f" Respond in {_LANGUAGE_NAMES[language]}."
```

Change `answer_from_chunks` (was lines 82-108):
```python
def answer_from_chunks(
    question: str, chunks: list[dict], history: list[dict] | None = None, language: str = "vi"
) -> dict:
    if chunks:
        context = "\n\n".join(
            f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
            for c in chunks
        )
        turn_text = f"Document passages:\n\n{context}\n\nQuestion: {question}"
        system_prompt = DOCUMENTS_SYSTEM_PROMPT
    else:
        turn_text = question
        system_prompt = GENERAL_KNOWLEDGE_SYSTEM_PROMPT

    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=turn_text)])
    ]

    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt + _language_instruction(language),
            thinking_config=types.ThinkingConfig(thinking_budget=-1),
            tools=[types.Tool(function_declarations=[ANSWER_TOOL])],
            tool_config=_ANSWER_TOOL_CONFIG,
        ),
    )
    return _extract_answer(response)
```

Change `answer_with_web_search` (was lines 111-120):
```python
def answer_with_web_search(question: str, history: list[dict] | None = None, language: str = "vi") -> str:
    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=question)])
    ]
    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=_language_instruction(language).strip(),
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    return response.text
```

Change `_quiz_system_prompt` and `generate_quiz_questions` (was lines 160-198):
```python
def _quiz_system_prompt(num_questions: int, language: str = "vi") -> str:
    return (
        f"You are a quiz generator. Using ONLY the document passages provided, "
        f"generate up to {num_questions} multiple-choice questions that test "
        f"understanding of their content. Each question must have exactly 4 "
        f"options with exactly one correct answer, and must cite the passage "
        f"(source_document_id and source_chunk_index) it is based on. If the "
        f"passages cannot support {num_questions} good, clearly-grounded "
        f"questions, generate fewer rather than inventing questions not "
        f"supported by the passages. Do not ask about anything not present "
        f"in the passages."
    ) + _language_instruction(language)


def generate_quiz_questions(chunks: list[dict], num_questions: int, language: str = "vi") -> list[dict]:
    context = "\n\n".join(
        f"[Source: {c['filename']} (document_id {c['document_id']}), "
        f"passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    response = _client.models.generate_content(
        model=MODEL,
        contents=f"Document passages:\n\n{context}",
        config=types.GenerateContentConfig(
            system_instruction=_quiz_system_prompt(num_questions, language),
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            tools=[types.Tool(function_declarations=[QUIZ_TOOL])],
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode="ANY",
                    allowed_function_names=["return_quiz_questions"],
                )
            ),
        ),
    )
    for call in response.function_calls or []:
        if call.name == "return_quiz_questions":
            return call.args["questions"]
    return []
```

- [ ] **Step 4: Update `backend/app/routers/chat.py`**

Add the import (modify line 1-4 area — add `Literal` to the top):
```python
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from psycopg.types.json import Json
```

Change `SendMessageRequest` (was lines 37-39):
```python
class SendMessageRequest(BaseModel):
    content: str
    web_search: bool = False
    language: Literal["vi", "en"] = "vi"
```

Change the two call sites inside `send_message` (was lines 94-95 and 134):
```python
        if body.web_search:
            answer_text = answer_with_web_search(body.content, history, body.language)
```
```python
            result = answer_from_chunks(body.content, chunks, history, body.language)
```

- [ ] **Step 5: Update `backend/app/routers/quiz.py`**

Add the import (modify line 1-2 area):
```python
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
```

Change `GenerateQuizRequest` (was lines 18-20):
```python
class GenerateQuizRequest(BaseModel):
    document_ids: list[str]
    num_questions: int = 10
    language: Literal["vi", "en"] = "vi"
```

Change the call site inside `generate_quiz` (was line 121):
```python
            raw_questions = generate_quiz_questions(chunks, body.num_questions, body.language)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_llm.py tests/test_chat.py tests/test_quiz_generate.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite to catch any other regressions**

Run: `cd backend && pytest -v`
Expected: PASS (no other test references these three functions' exact call signatures)

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/llm.py backend/app/routers/chat.py backend/app/routers/quiz.py backend/tests/test_llm.py backend/tests/test_chat.py backend/tests/test_quiz_generate.py
git commit -m "feat: default chat and quiz LLM responses to Vietnamese, add language override"
```

---

### Task 9: Frontend → backend wiring — send active UI language with chat/quiz requests

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/pages/QuizPage.tsx`
- Test: `frontend/tests/lib/api.test.ts`
- Test: `frontend/tests/pages/ChatPage.test.tsx`
- Test: `frontend/tests/pages/QuizPage.test.tsx`

**Interfaces:**
- Consumes: backend `language` field from Task 8 (`SendMessageRequest.language`, `GenerateQuizRequest.language`); `i18n` default export from Task 1 (reads `i18n.language`, a live value: `'vi'` or `'en'`).
- Produces: `sendChatMessage(sessionId, content, webSearch, language)`, `generateQuiz(documentIds, numQuestions, language)` — final signatures; no later task calls these.

- [ ] **Step 1: Read and update the existing tests**

Read `frontend/tests/lib/api.test.ts` in full first. Find the `sendChatMessage` and `generateQuiz` test cases and update their call sites and body-shape assertions to include the new 4th argument. For example, a call like:
```ts
await sendChatMessage('session-1', 'hello', false)
```
becomes:
```ts
await sendChatMessage('session-1', 'hello', false, 'vi')
```
and any assertion on the request body (e.g. `expect(fetchMock).toHaveBeenCalledWith(..., expect.objectContaining({ body: JSON.stringify({ content: 'hello', web_search: false }) }))`) gains `language: 'vi'` in the JSON. Apply the same pattern to `generateQuiz` tests, adding `'vi'` as the 3rd argument and `language: 'vi'` in the expected request body JSON.

In `frontend/tests/pages/ChatPage.test.tsx`, every existing `expect(sendChatMessage).toHaveBeenCalledWith(...)` assertion gains a 4th argument `'vi'` (the default language in tests, since no test switches language):
- `expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'What is the refund window?', false)` becomes `expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'What is the refund window?', false, 'vi')`
- `expect(sendChatMessage).toHaveBeenCalledWith('session-1', "What's the weather in Paris?", true)` becomes `expect(sendChatMessage).toHaveBeenCalledWith('session-1', "What's the weather in Paris?", true, 'vi')`

Add one new test to `frontend/tests/pages/ChatPage.test.tsx` (append inside the `describe` block):
```tsx
  it('sends the currently selected UI language with the message', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'hi',
        citations: [],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    i18n.changeLanguage('en')
    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'hello', false, 'en')
    })
    i18n.changeLanguage('vi')
  })
```
This test asserts English text (`'Ask a question'`, `'Send'`) because it switches to English before rendering — add the import `import i18n from '../../src/i18n'` at the top of the file alongside the other imports.

In `frontend/tests/pages/QuizPage.test.tsx`, apply the same pattern: read the file, find every `expect(generateQuiz).toHaveBeenCalledWith(...)` assertion and add `'vi'` as the 3rd argument.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- api.test.ts ChatPage.test.tsx QuizPage.test.tsx`
Expected: FAIL — `sendChatMessage`/`generateQuiz` don't accept/send a 4th/3rd argument yet

- [ ] **Step 3: Update `frontend/src/lib/api.ts`**

Change `sendChatMessage` (was lines 153-165):
```ts
export async function sendChatMessage(
  sessionId: string,
  content: string,
  webSearch: boolean,
  language: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, web_search: webSearch, language }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}
```

Change `generateQuiz` (was lines 178-186):
```ts
export async function generateQuiz(
  documentIds: string[],
  numQuestions: number,
  language: string,
): Promise<Quiz> {
  const res = await apiFetch(`${API_BASE}/quiz/generate`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_ids: documentIds, num_questions: numQuestions, language }),
  })
  if (!res.ok) throw new Error('Failed to generate quiz')
  return res.json()
}
```

- [ ] **Step 4: Update `ChatPage.tsx` call site**

In `frontend/src/pages/ChatPage.tsx`, add the import:
```tsx
import i18n from '../i18n'
```
Change the mutation (was lines 22-24):
```tsx
  const sendMutation = useMutation({
    mutationFn: (vars: { sessionId: string; content: string; webSearch: boolean }) =>
      sendChatMessage(vars.sessionId, vars.content, vars.webSearch, i18n.language),
    onSuccess: ({ user_message, assistant_message }) => {
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    },
  })
```

- [ ] **Step 5: Update `QuizPage.tsx` call site**

In `frontend/src/pages/QuizPage.tsx`, add the import:
```tsx
import i18n from '../i18n'
```
Change the mutation (was lines 74-77):
```tsx
  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions, i18n.language),
    onSuccess: (generated) => startQuiz(generated),
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm test -- api.test.ts ChatPage.test.tsx QuizPage.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full frontend suite to catch any other regressions**

Run: `cd frontend && npm test`
Expected: PASS (all files)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ChatPage.tsx frontend/src/pages/QuizPage.tsx frontend/tests/lib/api.test.ts frontend/tests/pages/ChatPage.test.tsx frontend/tests/pages/QuizPage.test.tsx
git commit -m "feat: send active UI language with chat and quiz-generation requests"
```

---

## Self-Review

**Spec coverage:**
- i18n framework + Vietnamese default + English secondary → Task 1.
- Language switcher, persisted via localStorage → Task 2 (detector handles persistence).
- All 7 pages + 3 shared components translated → Tasks 2–7.
- Chat + quiz LLM responses default to Vietnamese, follow UI language → Tasks 8–9.
- Testing (frontend + backend) → a test sub-step in every task.
- Out-of-scope items (Supabase errors, dynamic content, no server-side language storage) → explicitly called out in Tasks 3 and Global Constraints, and no task adds a user-profile table.

**Placeholder scan:** no "TBD"/"TODO" in any task; every JSON/code block is complete; every translation table gives literal Vietnamese text, not a description of what to translate.

**Type consistency:** `sendChatMessage(sessionId, content, webSearch, language)` and `generateQuiz(documentIds, numQuestions, language)` signatures match between their Task 9 definition and their two call sites. Backend `answer_from_chunks(question, chunks, history=None, language="vi")` / `answer_with_web_search(question, history=None, language="vi")` / `generate_quiz_questions(chunks, num_questions, language="vi")` signatures match between Task 8's definition and its own call sites in `chat.py`/`quiz.py`, and match the assertions added to `test_chat.py`/`test_quiz_generate.py`/`test_llm.py`.
