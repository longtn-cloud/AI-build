# DigiAgent Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire frontend from the current "vintage reading room" theme (felt/parchment/brass, serif fonts, dark-mode toggle) to the "DigiAgent" look (dark green sidebar, `Plus Jakarta Sans`, green accent, single light theme), restructuring Documents/Chat/Quiz to richer UX patterns, with no backend changes.

**Architecture:** Token-first rebrand. Replace Tailwind theme tokens and fonts once, restyle the shared `ui/` primitives once, then work outward through shell → pages, keeping every page's existing data fetching/mutations/handlers intact and only changing JSX structure/classNames. Dark mode is deleted, not adapted.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS (utility classes + `tailwind-merge`, no CSS variables), React Query, React Router, Vitest + Testing Library.

## Global Constraints

- Colors: sidebar `#26333D` (hover panel `#2F3E49`), accent `#3DA94B` (hover `#2E8F3B`), app bg `#F5F7F8`, card border `#E5EAEC`, primary text `#1D2831`, secondary text `#6C7781` / muted `#8B969D`, danger `#C0392B`, danger bg `#FBEAE8`, warning `#E0A62E` / `#B4791A`, warning bg `#FBF2E1`, success bg `#EAF6EC`, info-blue `#3161B4` / info bg `#ECF2FB`.
- Fonts: `Plus Jakarta Sans` (all UI text — one `font-sans` family, no separate display/body), `JetBrains Mono` (extension badges, scores, mono labels — one `font-mono` family).
- No dark mode anywhere: no `dark:` variants, no `ThemeContext`, no theme toggle.
- No invented data: no storage/quota widget, no file size/page count on documents, no fake upload percentages, no quiz difficulty picker (backend doesn't support any of these — see spec `docs/superpowers/specs/2026-07-18-digiagent-rebrand-design.md`).
- Every page keeps its existing API calls, mutation names, and handler logic from `frontend/src/lib/api.ts` unchanged.
- Verification gate for every task: `cd frontend && npx tsc --noEmit && npm test -- --run <affected test file(s)>`; full suite (`npm test -- --run`) must pass at the end of the plan.

---

### Task 1: Design tokens, fonts, and dark-mode removal from global setup

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.tsx`
- Delete: `frontend/src/contexts/ThemeContext.tsx`
- Delete: `frontend/tests/contexts/ThemeContext.test.tsx`

**Interfaces:**
- Produces: Tailwind color tokens `sidebar` (`DEFAULT: '#26333D'`, `panel: '#2F3E49'`), `accent` (`DEFAULT: '#3DA94B'`, `hover: '#2E8F3B'`), `app-bg: '#F5F7F8'`, `line: '#E5EAEC'`, `ink: '#1D2831'`, `muted: '#6C7781'`, `faint: '#8B969D'`, `danger: '#C0392B'`, `danger-bg: '#FBEAE8'`, `warn: '#B4791A'`, `warn-bg: '#FBF2E1'`, `ok-bg: '#EAF6EC'`, `info: '#3161B4'`, `info-bg: '#ECF2FB'`. Font families `sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif']`, `mono: ['"JetBrains Mono"', 'monospace']`. These names are consumed by every later task.

- [ ] **Step 1: Replace `tailwind.config.js` tokens**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#26333D', panel: '#2F3E49' },
        accent: { DEFAULT: '#3DA94B', hover: '#2E8F3B' },
        'app-bg': '#F5F7F8',
        line: '#E5EAEC',
        ink: '#1D2831',
        muted: '#6C7781',
        faint: '#8B969D',
        danger: { DEFAULT: '#C0392B', bg: '#FBEAE8' },
        warn: { DEFAULT: '#B4791A', bg: '#FBF2E1' },
        ok: { bg: '#EAF6EC' },
        info: { DEFAULT: '#3161B4', bg: '#ECF2FB' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        stamp: {
          '0%': { transform: 'scale(1.35) rotate(-5deg)', opacity: '0' },
          '60%': { transform: 'scale(0.97) rotate(1deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        stamp: 'stamp 280ms ease-out',
        'fade-up': 'fade-up 300ms ease both',
      },
    },
  },
  plugins: [],
}
```

Note: `darkMode: 'class'` is removed (no dark mode). The `stamp` keyframe/animation is kept as-is since `CitationStub` still uses it (Task 2); `fade-up` is added for the card/message entrance animation used in later tasks.

- [ ] **Step 2: Replace `frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-app-bg font-sans text-ink antialiased;
  }
}
```

- [ ] **Step 3: Replace font links in `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>DigiAgent</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Remove `ThemeProvider` from `frontend/src/main.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: Delete the theme files**

```bash
git rm frontend/src/contexts/ThemeContext.tsx frontend/tests/contexts/ThemeContext.test.tsx
```

- [ ] **Step 6: Verify the app still typechecks (component-level errors from other files referencing `ThemeContext` are expected and fixed in Task 3 — just confirm these two deletions and config changes introduce no *new* unrelated errors)**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `AppNav.tsx` (`Cannot find module '../contexts/ThemeContext'`) and its test — both fixed in Task 3.

- [ ] **Step 7: Commit**

```bash
git add frontend/tailwind.config.js frontend/src/index.css frontend/index.html frontend/src/main.tsx
git commit -m "feat: replace theme tokens/fonts with DigiAgent palette, remove dark mode"
```

---

### Task 2: Restyle shared `ui/` primitives

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx`
- Modify: `frontend/src/components/ui/Card.tsx`
- Modify: `frontend/src/components/ui/Badge.tsx`
- Modify: `frontend/src/components/ui/Input.tsx`
- Modify: `frontend/src/components/ui/Alert.tsx`
- Modify: `frontend/src/components/ui/CitationStub.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`accent`, `sidebar`, `line`, `ink`, `muted`, `danger`, `warn`, `ok`, `info`).
- Produces: same exported component names/props as before (`Button({variant, className, ...rest})`, `Card({className, ...props})`, `Badge({variant, children})` with variants `'gray'|'blue'|'green'|'red'|'amber'`, `Input({className, ...props})`, `Alert({children})`, `CitationStub({children})`) — no signature changes, so every page (Task 3–8) keeps compiling against these unchanged.

- [ ] **Step 1: Restyle `Button.tsx`**

```tsx
import { ButtonHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  secondary: 'border border-line text-muted hover:bg-app-bg disabled:text-faint',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={twMerge(
        'rounded-[10px] px-3 py-2 font-sans text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    />
  )
}
```

- [ ] **Step 2: Restyle `Card.tsx`**

```tsx
import { HTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-[14px] border border-line bg-white p-4 text-ink shadow-sm',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 3: Restyle `Badge.tsx`**

```tsx
import { ReactNode } from 'react'

type BadgeVariant = 'gray' | 'blue' | 'green' | 'red' | 'amber'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gray: 'border-line bg-app-bg text-muted',
  blue: 'border-info/30 bg-info-bg text-info',
  green: 'border-accent/30 bg-ok-bg text-accent-hover',
  red: 'border-danger/30 bg-danger-bg text-danger',
  amber: 'border-warn/30 bg-warn-bg text-warn',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 4: Restyle `Input.tsx`**

```tsx
import { InputHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={twMerge(
        'w-full rounded-[10px] border border-line bg-white px-3 py-2 font-sans text-sm text-ink placeholder-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 5: Restyle `Alert.tsx`**

```tsx
import { ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2 font-sans text-sm text-danger"
    >
      {children}
    </p>
  )
}
```

- [ ] **Step 6: Restyle `CitationStub.tsx`**

```tsx
import { ReactNode } from 'react'

export function CitationStub({ children }: { children: ReactNode }) {
  return (
    <span className="motion-safe:animate-stamp inline-flex items-center gap-1.5 rounded-lg border border-l-[3px] border-line border-l-accent bg-[#FBFDFB] px-2.5 py-1.5 font-mono text-xs text-muted">
      <span aria-hidden="true" className="text-accent-hover">
        ✓
      </span>
      <span>{children}</span>
    </span>
  )
}
```

- [ ] **Step 7: Run the ui primitive tests**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/components/ui`
Expected: PASS — all 6 files' existing tests (`Alert`, `Badge`, `Button`, `Card`, `CitationStub`, `Input`) query by role/text/className-override, none of which changed shape.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui
git commit -m "feat: restyle shared ui primitives to DigiAgent tokens"
```

---

### Task 3: Restyle `AppNav` and `AppShell`, remove theme toggle, add live doc count + real user

**Files:**
- Modify: `frontend/src/components/AppNav.tsx`
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/tests/components/AppNav.test.tsx`
- Modify: `frontend/tests/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `AuthContext` (`session.user.email`, `signOut()`), `useQuery({queryKey: queryKeys.documents, queryFn: listDocuments})` from `../lib/api` + `../lib/queryKeys` (already used identically in `DocumentsPage`), `useLocation()`/`Link` from `react-router-dom`.
- Produces: `AppNav` renders nav links with `aria-label`/role `link` and accessible names `'Documents'`, `'Search'`, `'AI Assistant'` (renamed from `'Chat'`), `'Quiz'`, `'Quiz History'` — later tasks/tests must use `'AI Assistant'` as the Chat link's name. `AppShell({children})` unchanged prop signature; internally derives a page title/subtitle from `useLocation().pathname`.

- [ ] **Step 1: Update `AppNav.test.tsx` (remove theme-toggle assertion, rename Chat link, add doc-count + email assertions)**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

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
import { renderWithQueryClient } from '../test-utils'

function renderAppNav() {
  return renderWithQueryClient(
    <MemoryRouter>
      <AppNav />
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  it('renders links to Documents, Search, AI Assistant, Quiz, and Quiz History', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'AI Assistant' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Quiz' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Quiz History' })).toHaveAttribute(
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
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npm test -- --run tests/components/AppNav.test.tsx`
Expected: FAIL (`AppNav` still imports deleted `ThemeContext`, no doc count, no email, `'Chat'` not `'AI Assistant'`).

- [ ] **Step 3: Rewrite `AppNav.tsx`**

```tsx
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../contexts/AuthContext'
import { listDocuments } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const LINKS = [
  { to: '/documents', label: 'Documents', badge: true },
  { to: '/search', label: 'Search' },
  { to: '/chat', label: 'AI Assistant' },
  { to: '/quiz', label: 'Quiz' },
  { to: '/quiz/history', label: 'Quiz History' },
]

export function AppNav() {
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
            DigiAgent
          </div>
          <div className="mt-[3px] text-[10px] font-semibold tracking-wide text-accent">
            Knowledge Base
          </div>
        </div>
      </div>

      <Link
        to="/documents"
        className="mb-[18px] flex items-center justify-center gap-2 rounded-[10px] bg-accent py-3 font-sans text-sm font-bold text-white hover:bg-accent-hover"
      >
        Upload documents
      </Link>

      <div className="flex flex-col gap-[3px]">
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={
              location.pathname === link.to
                ? 'flex items-center gap-3 rounded-[9px] bg-accent px-3 py-[11px] text-sm font-semibold text-white'
                : 'flex items-center gap-3 rounded-[9px] px-3 py-[11px] text-sm font-semibold text-[#AEBBC2] hover:bg-white/5'
            }
          >
            <span className="flex-1 text-left">{link.label}</span>
            {link.badge && docCount > 0 && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-bold text-[#6BD47C]">
                {docCount}
              </span>
            )}
          </Link>
        ))}
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
          aria-label="Sign out"
          className="flex-shrink-0 text-[11px] font-semibold text-[#7C8992] hover:text-white"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd frontend && npm test -- --run tests/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Update `AppShell.test.tsx` (wrap in the same mocks `AppNav` now needs)**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user: { email: 'sarah@example.com' } }, signOut: vi.fn() }),
}))

import { AppShell } from '../../src/components/AppShell'
import { renderWithQueryClient } from '../test-utils'

describe('AppShell', () => {
  it('renders the nav and its children', () => {
    renderWithQueryClient(
      <MemoryRouter>
        <AppShell>
          <p>Page content</p>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it, confirm it fails (still imports the old `ThemeProvider` wrapper implicitly via old `AppShell`, or simply needs the new mocks wired to a not-yet-updated component)**

Run: `cd frontend && npm test -- --run tests/components/AppShell.test.tsx`
Expected: FAIL until Step 7 lands.

- [ ] **Step 7: Rewrite `AppShell.tsx` with a per-route header + top search**

```tsx
import { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { AppNav } from './AppNav'

const PAGE_INFO: Record<string, [string, string]> = {
  '/documents': ['Documents', 'Your indexed knowledge base'],
  '/search': ['Search', 'Find passages across every document'],
  '/chat': ['AI Assistant', 'Grounded answers from your documents'],
  '/quiz': ['Quizzes', 'Test yourself on your material'],
  '/quiz/history': ['Quiz History', 'Every attempt you have taken'],
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [title, subtitle] = PAGE_INFO[location.pathname] ?? ['DigiAgent', '']

  function handleTopSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
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
              aria-label="Search your documents"
              placeholder="Search your documents…"
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

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/components/AppNav.test.tsx tests/components/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/AppNav.tsx frontend/src/components/AppShell.tsx frontend/tests/components/AppNav.test.tsx frontend/tests/components/AppShell.test.tsx
git commit -m "feat: restyle AppNav/AppShell, add live doc count and real user, drop theme toggle"
```

---

### Task 4: Restyle `ProtectedRoute`, `PreviewModal`, `LoginPage`, `SignupPage` (presentation-only, no behavior change)

**Files:**
- Modify: `frontend/src/components/ProtectedRoute.tsx`
- Modify: `frontend/src/components/PreviewModal.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/SignupPage.tsx`

**Interfaces:**
- No new consumes/produces — same props/exports as today. `LoginPage`/`SignupPage.test.tsx` (only `LoginPage.test.tsx` exists) query by label text (`'Email'`, `'Password'`) and button name (`'Log in'`) — these labels are preserved.

- [ ] **Step 1: Restyle `ProtectedRoute.tsx`**

```tsx
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <p className="flex min-h-screen items-center justify-center bg-app-bg font-sans text-sm text-muted">
        Loading...
      </p>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Restyle `PreviewModal.tsx`**

```tsx
import { useEffect, useState } from 'react'

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
  const [content, setContent] = useState<{ kind: 'pdf' | 'text'; value: string } | null>(null)

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
      const text = await response.text()
      if (!cancelled) setContent({ kind: 'text', value: text })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-ink/60 p-4">
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-[14px] border border-line bg-white p-4">
        <div className="mb-2 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {content?.kind === 'pdf' && (
          <iframe title="Document preview" src={content.value} width="100%" height="600" />
        )}
        {content?.kind === 'text' && (
          <pre className="whitespace-pre-wrap font-mono text-sm text-ink">{content.value}</pre>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Restyle `LoginPage.tsx`**

```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
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
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Log in</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Email
            </label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            Log in
          </Button>
          <p className="text-sm text-muted">
            No account?{' '}
            <Link to="/signup" className="text-accent-hover hover:underline">
              Sign up
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Restyle `SignupPage.tsx`** (identical structure to `LoginPage`, swap copy/handler)

```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function SignupPage() {
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
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Sign up</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="signup-email"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Email
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
              Password
            </label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            Sign up
          </Button>
          <p className="text-sm text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent-hover hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Run affected tests**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/components/PreviewModal.test.tsx tests/pages/LoginPage.test.tsx tests/App.test.tsx`
Expected: PASS — none of these tests assert classNames; they query by title/text/label/role, all preserved.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ProtectedRoute.tsx frontend/src/components/PreviewModal.tsx frontend/src/pages/LoginPage.tsx frontend/src/pages/SignupPage.tsx
git commit -m "feat: restyle ProtectedRoute, PreviewModal, Login, Signup"
```

---

### Task 5: Restyle `DocumentsPage` as a card grid with empty state and filters

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Modify: `frontend/tests/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: unchanged `listDocuments`, `uploadDocument`, `renameDocument`, `deleteDocument`, `getDownloadUrl` from `../lib/api`; same `queryKeys.documents`.
- Produces: same accessible names as today (`'Upload document'` label on the file input, button names `'Preview'`/`'Download'`/`'Rename'`/`'Delete'`, filename text) so existing test assertions on those keep matching; status pill text changes from `'(processing)'`/`'(ready)'` to `'Processing…'`/`'Indexed'`/`'Uploading…'`/`'Failed'` — test updated accordingly.

- [ ] **Step 1: Update `DocumentsPage.test.tsx` status-text assertions (only the two lines that assert old parenthesized status text; everything else in the file is unchanged from what's on disk)**

Replace:
```tsx
      expect(screen.getByText('(processing)')).toBeInTheDocument()
```
with:
```tsx
      expect(screen.getByText('Processing…')).toBeInTheDocument()
```
and replace:
```tsx
      expect(screen.getByText('(ready)')).toBeInTheDocument()
```
with:
```tsx
      expect(screen.getByText('Indexed')).toBeInTheDocument()
```
Every other test in the file (upload via input, upload via drop, rename, delete, download, no-poll-when-ready) is left exactly as-is — all query by label/role/filename text, none of which change.

- [ ] **Step 2: Run it, confirm the two updated assertions fail against the current component**

Run: `cd frontend && npm test -- --run tests/pages/DocumentsPage.test.tsx`
Expected: FAIL on the two status-text lines (component still renders `(processing)`/`(ready)`).

- [ ] **Step 3: Rewrite `DocumentsPage.tsx`**

```tsx
import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

const STATUS_LABEL: Record<DocumentListItem['status'], string> = {
  uploading: 'Uploading…',
  processing: 'Processing…',
  ready: 'Indexed',
  failed: 'Failed',
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Docs' },
  { id: 'other', label: 'Text' },
] as const

function matchesFilter(fileType: string, filter: (typeof FILTERS)[number]['id']) {
  if (filter === 'all') return true
  if (filter === 'pdf') return fileType === 'pdf'
  if (filter === 'docx') return fileType === 'docx'
  return fileType !== 'pdf' && fileType !== 'docx'
}

export function DocumentsPage() {
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
    onError: () => setError('Failed to upload document'),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameDocument(id, filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError('Failed to rename document'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError('Failed to delete document'),
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
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    renameMutation.mutate({ id: doc.id, filename: newName })
  }

  function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    deleteMutation.mutate(doc.id)
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  const displayError = documentsQuery.isError ? 'Failed to load documents' : error

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
        <label htmlFor="upload-input" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
          Upload document
        </label>
        <p className="mb-2 text-sm text-muted">Drag a file here, or click to browse</p>
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
          <h2 className="mb-2 text-xl font-extrabold tracking-tight">Build your knowledge base</h2>
          <p className="mb-6 max-w-[400px] text-[15px] leading-relaxed text-muted">
            Upload PDFs, Word docs, text or Markdown files. We&apos;ll index every passage so you
            can search, ask, and quiz — all grounded in your own material.
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
                  {f.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="text-sm text-muted">{documents.length} documents</span>
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
                      Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
                </div>
                <div className="flex gap-1.5 border-t border-[#EEF2F3] pt-3">
                  {doc.status === 'ready' && (
                    <>
                      <Button variant="secondary" onClick={() => setPreviewing(doc)}>
                        Preview
                      </Button>
                      <Button variant="secondary" onClick={() => handleDownload(doc)}>
                        Download
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" onClick={() => handleRename(doc)}>
                    Rename
                  </Button>
                  <Button variant="danger" onClick={() => handleDelete(doc)}>
                    Delete
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

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/pages/DocumentsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/tests/pages/DocumentsPage.test.tsx
git commit -m "feat: restyle DocumentsPage as a card grid with empty state and filters"
```

---

### Task 6: Restyle `SearchPage` with scope chips and term highlighting, wire up top-search handoff

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`
- Modify: `frontend/tests/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: unchanged `search(query)` from `../lib/api`; new: `useLocation()` to read `state?.query` set by `AppShell`'s top search (Task 3).
- Produces: same label `'Search your documents'` and button name `'Search'` so existing tests keep matching; result text `"{filename} — passage {n} of {m}"` unchanged.

- [ ] **Step 1: Add one new test to `SearchPage.test.tsx` for the top-search handoff (append to the existing `describe` block, leave all other tests as-is)**

```tsx
  it('pre-fills and runs the query passed via router location state', async () => {
    ;(search as any).mockResolvedValue([
      {
        document_id: '1',
        filename: 'report.pdf',
        chunk_index: 0,
        total_chunks: 2,
        content: 'annual revenue summary',
        score: 0.7,
      },
    ])

    render(
      <MemoryRouter initialEntries={[{ pathname: '/search', state: { query: 'revenue' } }]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <SearchPage />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue')
    })
    expect(screen.getByLabelText('Search your documents')).toHaveValue('revenue')
  })
```

This new test needs `MemoryRouter`, `QueryClient`, `QueryClientProvider` imports added to the top of the file alongside the existing ones.

- [ ] **Step 2: Run it, confirm the new test fails**

Run: `cd frontend && npm test -- --run tests/pages/SearchPage.test.tsx`
Expected: FAIL (component doesn't yet read `location.state`, doesn't auto-run).

- [ ] **Step 3: Rewrite `SearchPage.tsx`**

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { search } from '../lib/api'

const SCOPES = [
  { id: 'all', label: 'All documents' },
  { id: 'pdf', label: 'PDFs only' },
  { id: 'recent', label: 'Recent' },
] as const

function highlight(content: string, query: string) {
  if (!query.trim()) return content
  const index = content.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return content
  const before = content.slice(0, index)
  const match = content.slice(index, index + query.length)
  const after = content.slice(index + query.length)
  return (
    <>
      {before}
      <mark className="rounded bg-[#FFF1B8] px-0.5 font-semibold text-ink">{match}</mark>
      {after}
    </>
  )
}

export function SearchPage() {
  const location = useLocation()
  const initialQuery = (location.state as { query?: string } | null)?.query ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [scope, setScope] = useState<(typeof SCOPES)[number]['id']>('all')
  const searchMutation = useMutation({ mutationFn: (q: string) => search(q) })
  const results = searchMutation.data ?? null

  useEffect(() => {
    if (initialQuery) searchMutation.mutate(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    searchMutation.mutate(query)
  }

  const scoped = (results ?? []).filter((r) => {
    if (scope === 'pdf') return r.filename.toLowerCase().endsWith('.pdf')
    if (scope === 'recent') return true
    return true
  })

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-12 pt-7">
      <form onSubmit={handleSubmit} className="flex items-center gap-3 rounded-[13px] border border-line bg-white py-1 pl-4 pr-1 shadow-sm">
        <div className="flex-1">
          <label htmlFor="search-input" className="sr-only">
            Search your documents
          </label>
          <Input
            id="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all your documents…"
            className="border-none bg-transparent py-3 shadow-none focus:ring-0"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <div className="my-4 flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={
              scope === s.id
                ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {searchMutation.isError && <Alert>Search failed, try again</Alert>}
      {searchMutation.isPending && <p className="text-sm text-muted">Searching...</p>}
      {results !== null && !searchMutation.isPending && scoped.length === 0 && (
        <p className="text-sm text-muted">No results found</p>
      )}
      {results !== null && !searchMutation.isPending && scoped.length > 0 && (
        <ul className="space-y-3">
          {scoped.map((r) => (
            <li key={`${r.document_id}-${r.chunk_index}`}>
              <Card className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-faint">
                  <span className="font-mono font-bold text-muted">
                    {r.filename} — passage {r.chunk_index + 1} of {r.total_chunks}
                  </span>
                </div>
                <p className="text-[14.5px] leading-relaxed text-ink">
                  {highlight(r.content, query)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/pages/SearchPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx frontend/tests/pages/SearchPage.test.tsx
git commit -m "feat: restyle SearchPage with scope chips, term highlighting, top-search handoff"
```

---

### Task 7: Restyle `ChatPage` as a message-bubble thread

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

No test changes: `ChatPage.test.tsx` queries by label (`'Ask a question'`), button name (`'Send'`), checkbox label (`'Search the web for this message'`), and message/citation text — none of which change.

**Interfaces:**
- Consumes: unchanged `createChatSession`, `sendChatMessage` from `../lib/api`.
- Produces: same labels/roles as listed above.

- [ ] **Step 1: Rewrite `ChatPage.tsx`**

```tsx
import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function ChatPage() {
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
          {sendMutation.isError && <Alert>Failed to send message, try again</Alert>}
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
                  {message.used_web_search && (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">Web</Badge>
                    </div>
                  )}
                  {message.citations.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {message.citations.map((citation) => (
                        <div
                          key={`${citation.document_id}-${citation.chunk_index}`}
                          className="rounded-lg border border-line border-l-[3px] border-l-accent bg-[#FBFDFB] px-3.5 py-3"
                        >
                          <span className="text-xs font-bold text-sidebar">
                            {citation.filename} — passage {citation.chunk_index + 1} of{' '}
                            {citation.total_chunks}
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
            <label htmlFor="chat-input" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Ask a question
            </label>
            <Input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question grounded in your documents…"
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
              Search the web for this message
            </label>
            <Button type="submit" disabled={sendMutation.isPending}>
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/pages/ChatPage.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: restyle ChatPage as a message-bubble thread"
```

---

### Task 8: Restructure `QuizPage` into list / config / taking / result views

**Files:**
- Modify: `frontend/src/pages/QuizPage.tsx`
- Modify: `frontend/tests/pages/QuizPage.test.tsx`

**Interfaces:**
- Consumes: unchanged `listDocuments`, `generateQuiz(documentIds, numQuestions)`, `submitQuizAttempt(quizId, answers)`, `listQuizAttempts` from `../lib/api`.
- Produces: a `view` state machine (`'list' | 'config' | 'taking' | 'result'`). Config no longer has a free-number `Input` — question count is one of the chips `5|8|10|15`. Taking is one-question-at-a-time: clicking an option immediately reveals correct/incorrect (same as today's instant feedback, but only one question visible instead of all). `submitQuizAttempt` still fires once, after the last question's answer is picked. Final score text stays `"{score} / {total_questions}"` so it keeps matching existing assertions where unchanged.

- [ ] **Step 1: Rewrite `QuizPage.test.tsx` for the new step-by-step flow**

```tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  listQuizAttempts: vi.fn(),
  generateQuiz: vi.fn(),
  submitQuizAttempt: vi.fn(),
}))

import {
  generateQuiz,
  listDocuments,
  listQuizAttempts,
  submitQuizAttempt,
} from '../../src/lib/api'
import { QuizPage } from '../../src/pages/QuizPage'

function renderQuizPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <QuizPage />
    </MemoryRouter>,
  )
}

const READY_DOCUMENT = {
  id: 'doc-1',
  user_id: 'user-1',
  filename: 'policy.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  error_reason: null,
  uploaded_at: '2026-07-18T00:00:00Z',
}

const QUIZ = {
  id: 'quiz-1',
  document_ids: ['doc-1'],
  requested_count: 2,
  actual_count: 2,
  created_at: '2026-07-18T00:00:00Z',
  questions: [
    {
      id: 'q-1',
      question: 'What is the refund window?',
      options: ['7 days', '30 days', '60 days', '90 days'],
    },
    { id: 'q-2', question: 'What is covered?', options: ['A', 'B', 'C', 'D'] },
  ],
}

const RESULT = {
  id: 'attempt-1',
  quiz_id: 'quiz-1',
  score: 1,
  total_questions: 2,
  completed_at: '2026-07-18T00:01:00Z',
  results: [
    {
      question_id: 'q-1',
      question: 'What is the refund window?',
      options: ['7 days', '30 days', '60 days', '90 days'],
      selected_option: 1,
      correct_answer: 1,
      is_correct: true,
      source_reference: {
        document_id: 'doc-1',
        filename: 'policy.pdf',
        chunk_index: 1,
        total_chunks: 3,
      },
    },
    {
      question_id: 'q-2',
      question: 'What is covered?',
      options: ['A', 'B', 'C', 'D'],
      selected_option: 0,
      correct_answer: 2,
      is_correct: false,
      source_reference: {
        document_id: 'doc-1',
        filename: 'policy.pdf',
        chunk_index: 2,
        total_chunks: 3,
      },
    },
  ],
}

describe('QuizPage', () => {
  it('shows the quiz list view by default with a Create quiz action', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])

    renderQuizPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create quiz' })).toBeInTheDocument()
    })
  })

  it('goes to config, lists ready documents as selectable checkboxes', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))

    await waitFor(() => {
      expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument()
    })
  })

  it('walks through config -> one question at a time -> result, submitting once at the end', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue(RESULT)

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: '8' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate 8 questions/ }))

    await waitFor(() => {
      expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    })
    expect(generateQuiz).toHaveBeenCalledWith(['doc-1'], 8)
    expect(screen.queryByText('What is covered?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('30 days'))
    expect(submitQuizAttempt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))

    await waitFor(() => {
      expect(screen.getByText('What is covered?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish quiz' }))

    await waitFor(() => {
      expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument()
    })
    expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
      { question_id: 'q-1', selected_option: 1 },
      { question_id: 'q-2', selected_option: 0 },
    ])
  })

  it('shows a degraded-count message in config when generation returns fewer questions than requested', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue({ ...QUIZ, requested_count: 10, actual_count: 2 })

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Generated 2 of the requested 10 questions — the selected documents didn't have enough distinct content for more.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('shows an error message when generation fails', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockRejectedValue(new Error('Failed to generate quiz'))

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate quiz, try again')
    })
  })

  it('does not generate when no documents are selected', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    expect(generateQuiz).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd frontend && npm test -- --run tests/pages/QuizPage.test.tsx`
Expected: FAIL (current component has no `view` state machine, no `'Create quiz'` button, question-count is a free `Input` not chips, all questions render on one page).

- [ ] **Step 3: Rewrite `QuizPage.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { generateQuiz, listDocuments, listQuizAttempts, submitQuizAttempt } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const COUNT_OPTIONS = [5, 8, 10, 15]

type View = 'list' | 'config' | 'taking' | 'result'

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

  const submitMutation = useMutation({
    mutationFn: (vars: { quizId: string; answers: typeof answers }) =>
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

  const generateError = generateMutation.isError ? 'Failed to generate quiz, try again' : null

  if (view === 'list') {
    return (
      <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
        <div className="mb-7 flex gap-4">
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">Quizzes taken</div>
            <div className="text-3xl font-extrabold tracking-tight">{stats.count}</div>
          </div>
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">Average score</div>
            <div className="text-3xl font-extrabold tracking-tight text-accent">{stats.avg}%</div>
          </div>
        </div>

        <div className="mb-7 flex items-center gap-5 rounded-2xl bg-gradient-to-r from-sidebar to-sidebar-panel p-6">
          <div className="flex-1">
            <h2 className="mb-1.5 text-lg font-extrabold text-white">Generate a new quiz</h2>
            <p className="text-sm leading-relaxed text-[#AEBBC2]">
              Pick one or more documents and we&apos;ll build multiple-choice questions grounded
              strictly in their content.
            </p>
          </div>
          <Button onClick={() => setView('config')}>Create quiz</Button>
        </div>

        <div className="mb-3.5 text-xs font-bold uppercase tracking-wide text-faint">
          Recent attempts
        </div>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">No quiz attempts yet</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {attempts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-[13px] border border-line bg-white px-5 py-4"
              >
                <div className="flex-1 text-sm font-bold">{a.document_filenames.join(', ')}</div>
                <div className="text-sm font-bold">
                  {a.score} / {a.total_questions}
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
          ← Back to quizzes
        </button>
        <h2 className="mb-5 text-xl font-extrabold tracking-tight">Generate a quiz</h2>
        {generateError && (
          <div className="mb-4">
            <Alert>{generateError}</Alert>
          </div>
        )}
        {generateMutation.isSuccess === false && quiz && quiz.actual_count < quiz.requested_count && (
          <p className="mb-4 text-sm text-warn">
            Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
            selected documents didn&apos;t have enough distinct content for more.
          </p>
        )}

        <div className="mb-2.5 text-xs font-bold text-muted">1 · Choose source documents</div>
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

        <div className="mb-2.5 text-xs font-bold text-muted">2 · Number of questions</div>
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
          Generate {numQuestions} questions
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
          <button onClick={() => setView('list')} className="text-sm font-semibold text-faint">
            ✕ Exit
          </button>
          <span className="flex-1" />
          <span className="text-sm font-semibold text-muted">
            Question {qIndex + 1} of {quiz.questions.length}
          </span>
        </div>
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.round(((qIndex + (revealed ? 1 : 0)) / quiz.questions.length) * 100)}%` }}
          />
        </div>

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

        <div className="mt-5 flex justify-end">
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? 'Finish quiz' : 'Next question'}
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
          <span className="text-3xl font-extrabold tracking-tight">
            <strong>{result.score}</strong>
          </span>
        </div>
        <h2 className="mb-2 text-2xl font-extrabold tracking-tight">
          {pct >= 75 ? 'Great work!' : pct >= 50 ? 'Nice effort' : 'Keep practicing'}
        </h2>
        <p className="mb-6 text-[15px] text-muted">
          You answered <strong className="text-ink">{result.score}</strong> of{' '}
          {result.total_questions} questions correctly.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => setView('config')}>
            Retake quiz
          </Button>
          <Button onClick={() => setView('list')}>Back to quizzes</Button>
        </div>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/pages/QuizPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Add the `sidebar-panel` token used above (missed in Task 1)**

In `frontend/tailwind.config.js`, change `sidebar: { DEFAULT: '#26333D', panel: '#2F3E49' }` usage: Tailwind nested keys expose `bg-sidebar` and `bg-sidebar-panel` automatically from that object — no config change needed, just confirm `bg-gradient-to-r from-sidebar to-sidebar-panel` compiles.

Run: `cd frontend && npx tsc --noEmit` (Tailwind class validity isn't caught by `tsc`; visually confirm via `npm run dev` per Task 10's manual check).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/QuizPage.tsx frontend/tests/pages/QuizPage.test.tsx
git commit -m "feat: restructure QuizPage into list/config/taking/result flashcard flow"
```

---

### Task 9: Restyle `QuizHistoryPage`

**Files:**
- Modify: `frontend/src/pages/QuizHistoryPage.tsx`

No test changes: `QuizHistoryPage.test.tsx` asserts `screen.getByText('7 / 10 — policy.pdf', { exact: false })`, `'No quiz attempts yet'`, and the alert text — all preserved verbatim.

- [ ] **Step 1: Rewrite `QuizHistoryPage.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null

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
            <Card key={a.id} className="text-sm">
              {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
              {a.completed_at}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run it, confirm it passes**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run tests/pages/QuizHistoryPage.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QuizHistoryPage.tsx
git commit -m "feat: restyle QuizHistoryPage"
```

---

### Task 10: Full-suite verification and manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: PASS, 0 failures.

- [ ] **Step 2: Start the dev server and manually click through every view**

Run: `cd frontend && npm run dev` (or repo-root `npm run dev` for both servers)
Manually verify in a browser: Login/Signup render with new tokens; Documents shows the card grid, empty state (with zero docs), upload dropzone, filters; Search returns highlighted results and the top-search box in the header hands off correctly; Chat renders bubbles and citations; Quiz flows list → config → one-question-at-a-time → result and back; Quiz History lists past attempts; sidebar shows live doc count and the signed-in email with no theme toggle anywhere.

- [ ] **Step 3: Fix any visual issues found, then commit**

```bash
git add -A
git commit -m "fix: address issues found during manual smoke check"
```

(Only if issues were found and fixed — skip if Step 2 finds nothing to change.)

---

## Self-Review Notes

- **Spec coverage:** tokens/fonts (Task 1), ui primitives (Task 2), shell/nav incl. live doc count + real user + dropped storage widget (Task 3), Login/Signup/PreviewModal/ProtectedRoute (Task 4), Documents card grid + empty state + filters + no fake file size (Task 5), Search scope chips + highlighting (Task 6), Chat bubbles (Task 7), Quiz 4-view restructure + no difficulty step + chip-based count (Task 8), Quiz History restyle (Task 9), full verification (Task 10) — every spec section has a task.
- **Dark mode removal:** covered by Task 1 (config/CSS/main.tsx/ThemeContext deletion) and Task 3 (AppNav toggle removal); no `dark:` class appears in any rewritten file above.
- **Data-honesty adjustments:** storage widget dropped (Task 3 has no storage bar), file size/page count dropped (Task 5's card only shows filename/extension/status/date), upload percentage replaced with status labels (Task 5's `STATUS_LABEL`), quiz difficulty dropped (Task 8 has no difficulty step), nav badge uses real `docCount` (Task 3).
