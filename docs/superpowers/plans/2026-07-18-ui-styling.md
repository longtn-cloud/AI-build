# UI Styling Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a Tailwind CSS-based visual design (neutral grays, indigo accent, light/dark theme toggle) across every existing frontend page, with a small shared component layer, without changing any page's behavior, copy, or accessible structure.

**Architecture:** Tailwind CSS (v3, `darkMode: 'class'`) is added to the Vite build. A `ThemeContext` manages the light/dark class on `<html>`, persisted to `localStorage`. A small set of stateless UI primitives (`Button`, `Input`, `Card`, `Badge`, `Alert`) in `src/components/ui/` are used to restyle every page. A new `AppShell` component consolidates the navbar + content layout and replaces the current per-route repetition of `<AppNav />`, which also fixes two pre-existing bugs: `AppNav` is missing links to `/chat` and `/quiz/history`, and the `/chat` route doesn't render `AppNav` at all.

**Tech Stack:** Same as existing frontend — React 18 / Vite / TypeScript / React Router / Vitest + Testing Library. New: `tailwindcss`, `postcss`, `autoprefixer` (dev dependencies only — no headless UI library, no CSS-in-JS, no icon package).

## Global Constraints

- Pure presentational change. No new routes, no new backend calls, no changes to any page's state/handlers/business logic beyond what's explicitly called out (removing `ChatPage`'s redundant hardcoded nav link; adding two links to `AppNav`).
- **Every existing test's `getByRole`/`getByLabelText`/`getByText` query must keep matching identical visible text, labels, and roles.** Only these test files change: `AppNav.test.tsx` (extended, not rewritten) — everything else that already has a test file must pass completely unmodified.
- Tailwind v3, `darkMode: 'class'` strategy — dark-mode pairing is done with `dark:` utility variants directly in each component's `className`, never CSS custom properties.
- Accent color is Tailwind's `indigo-*` palette; neutral surfaces are `gray-*`. Status colors: `blue` (processing), `green` (ready), `red` (failed/danger/incorrect), `gray` (uploading), `amber` (web-search badge, degraded-count banner).
- Theme preference persists to `localStorage` under the key `"theme"` (`"light"` or `"dark"`); with no stored value, it follows `window.matchMedia('(prefers-color-scheme: dark)')`.
- UI primitives in `src/components/ui/` are thin, stateless, prop-forwarding wrappers — no new business logic, no new required props beyond styling variants.
- The shared `Input` primitive is for text/email/password/number-style fields only. Checkboxes and radio buttons keep plain native `<input>` elements with inline utility classes directly — forcing every input type through one wrapper isn't worth the complexity here.

---

### Task 1: Install and configure Tailwind CSS

**Files:**
- Modify: `frontend/package.json` (via `npm install`, not hand-edited)
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/index.css`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: a working Tailwind build — every subsequent task's `className` utilities render correctly. No new exported functions/types.

- [ ] **Step 1: Install Tailwind and its build dependencies**

Run: `cd frontend && npm install --save-dev tailwindcss@^3.4.13 postcss@^8.4.47 autoprefixer@^10.4.20`

This updates `package.json` and `package-lock.json` in place.

- [ ] **Step 2: Create the Tailwind config**

Create `frontend/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

- [ ] **Step 3: Create the PostCSS config**

Create `frontend/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 4: Create the Tailwind entry stylesheet**

Create `frontend/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Import the stylesheet in the app entry point**

Modify `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 6: Verify nothing broke**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; `10 test files, 44 tests`, all passing (unchanged from before this task — nothing consumes Tailwind classes yet).

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tailwind.config.js frontend/postcss.config.js frontend/src/index.css frontend/src/main.tsx
git commit -m "chore: add Tailwind CSS build pipeline"
```

---

### Task 2: Theme context (light/dark toggle)

**Files:**
- Create: `frontend/src/contexts/ThemeContext.tsx`
- Test: `frontend/src/contexts/ThemeContext.test.tsx`
- Modify: `frontend/src/test-setup.ts`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: `ThemeProvider` (React component, wraps children) and `useTheme(): { theme: 'light' | 'dark', toggleTheme: () => void }`, both exported from `frontend/src/contexts/ThemeContext.tsx`. Task 4's `AppNav` consumes `useTheme` for its toggle button.

- [ ] **Step 1: Add a `matchMedia` polyfill to the test environment**

jsdom does not implement `window.matchMedia`. Modify `frontend/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/contexts/ThemeContext.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme } from './ThemeContext'

function Consumer() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span>{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeContext', () => {
  it('defaults to light when no stored preference and the system prefers light', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('light')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('defaults to dark when no stored preference and the system prefers dark', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('dark')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('an explicit stored preference overrides the system setting', () => {
    localStorage.setItem('theme', 'dark')
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('dark')).toBeInTheDocument()
  })

  it('toggling flips the theme, the html class, and persists to localStorage', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))

    expect(screen.getByText('dark')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/contexts/ThemeContext.test.tsx`
Expected: FAIL — `./ThemeContext` module does not exist.

- [ ] **Step 4: Create the theme context**

Create `frontend/src/contexts/ThemeContext.tsx`:

```tsx
import { ReactNode, createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/contexts/ThemeContext.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Wire `ThemeProvider` into the app entry point**

Modify `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
```

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 11 test files, 48 tests, all passing (44 existing + 4 new `ThemeContext` tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/contexts/ThemeContext.tsx frontend/src/contexts/ThemeContext.test.tsx frontend/src/test-setup.ts frontend/src/main.tsx
git commit -m "feat: add light/dark theme context"
```

---

### Task 3: Shared UI primitives

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Test: `frontend/src/components/ui/Button.test.tsx`
- Create: `frontend/src/components/ui/Input.tsx`
- Test: `frontend/src/components/ui/Input.test.tsx`
- Create: `frontend/src/components/ui/Card.tsx`
- Test: `frontend/src/components/ui/Card.test.tsx`
- Create: `frontend/src/components/ui/Badge.tsx`
- Test: `frontend/src/components/ui/Badge.test.tsx`
- Create: `frontend/src/components/ui/Alert.tsx`
- Test: `frontend/src/components/ui/Alert.test.tsx`

**Interfaces:**
- Produces:
  - `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' })` — default variant `'primary'`. Renders a native `<button>`, forwarding all other props untouched.
  - `Input(props: InputHTMLAttributes<HTMLInputElement>)` — renders a native `<input>`, forwarding all props untouched.
  - `Card(props: HTMLAttributes<HTMLDivElement>)` — renders a styled `<div>`, forwarding all props (including `className`, merged) untouched.
  - `Badge({ variant: 'gray' | 'blue' | 'green' | 'red' | 'amber', children: ReactNode })` — renders a `<span>` with the children as-is.
  - `Alert({ children: ReactNode })` — renders `<p role="alert">{children}</p>`.
- Consumed by every page task (4 through 12) below.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ui/Button.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
  it('renders its children and responds to clicks', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
```

Create `frontend/src/components/ui/Input.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Input } from './Input'

describe('Input', () => {
  it('forwards its value and calls onChange with the new value', () => {
    const onChange = vi.fn()
    render(
      <div>
        <label htmlFor="name">Name</label>
        <Input id="name" value="Ada" onChange={onChange} />
      </div>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } })

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
```

Create `frontend/src/components/ui/Card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card } from './Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>Hello</Card>)

    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

Create `frontend/src/components/ui/Badge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its label text', () => {
    render(<Badge variant="green">ready</Badge>)

    expect(screen.getByText('ready')).toBeInTheDocument()
  })
})
```

Create `frontend/src/components/ui/Alert.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Alert } from './Alert'

describe('Alert', () => {
  it('renders its children with an alert role', () => {
    render(<Alert>Something went wrong</Alert>)

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ui`
Expected: FAIL — none of the five modules exist yet.

- [ ] **Step 3: Create the primitives**

Create `frontend/src/components/ui/Button.tsx`:

```tsx
import { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-900',
  secondary:
    'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  )
}
```

Create `frontend/src/components/ui/Input.tsx`:

```tsx
import { InputHTMLAttributes } from 'react'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 ${className}`}
      {...props}
    />
  )
}
```

Create `frontend/src/components/ui/Card.tsx`:

```tsx
import { HTMLAttributes } from 'react'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`}
      {...props}
    />
  )
}
```

Create `frontend/src/components/ui/Badge.tsx`:

```tsx
import { ReactNode } from 'react'

type BadgeVariant = 'gray' | 'blue' | 'green' | 'red' | 'amber'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  )
}
```

Create `frontend/src/components/ui/Alert.tsx`:

```tsx
import { ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {children}
    </p>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ui`
Expected: 6 passed (2 Button + 1 Input + 1 Card + 1 Badge + 1 Alert).

- [ ] **Step 5: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 16 test files, 54 tests, all passing (48 existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui
git commit -m "feat: add shared Button, Input, Card, Badge, and Alert UI primitives"
```

---

### Task 4: AppNav — missing links, active-link styling, theme toggle

**Files:**
- Modify: `frontend/src/components/AppNav.tsx`
- Modify: `frontend/src/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` (Task 2).
- Produces: `AppNav` now renders links to all five sections (`/documents`, `/search`, `/chat`, `/quiz`, `/quiz/history`) plus a theme toggle button. Consumed by Task 5's `AppShell`.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/components/AppNav.test.tsx` in full:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from '../contexts/ThemeContext'
import { AppNav } from './AppNav'

function renderAppNav() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AppNav />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  it('renders links to Documents, Search, Chat, Quiz, and Quiz History', () => {
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Quiz' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Quiz History' })).toHaveAttribute(
      'href',
      '/quiz/history',
    )
  })

  it('renders a theme toggle button', () => {
    renderAppNav()

    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/AppNav.test.tsx`
Expected: FAIL — no links to Chat/Quiz History exist yet, and there's no theme toggle button.

- [ ] **Step 3: Rewrite AppNav**

Replace `frontend/src/components/AppNav.tsx` in full:

```tsx
import { Link, useLocation } from 'react-router-dom'

import { useTheme } from '../contexts/ThemeContext'

const LINKS = [
  { to: '/documents', label: 'Documents' },
  { to: '/search', label: 'Search' },
  { to: '/chat', label: 'Chat' },
  { to: '/quiz', label: 'Quiz' },
  { to: '/quiz/history', label: 'Quiz History' },
]

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

export function AppNav() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  return (
    <nav className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <div className="flex gap-4">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={
                location.pathname === link.to
                  ? 'text-sm font-medium text-indigo-600 dark:text-indigo-400'
                  : 'text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/AppNav.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 16 test files, 55 tests, all passing (54 existing + net 1 new — `AppNav.test.tsx` went from 1 test to 2).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AppNav.tsx frontend/src/components/AppNav.test.tsx
git commit -m "feat: add missing nav links and a theme toggle to AppNav"
```

---

### Task 5: AppShell and routing

**Files:**
- Create: `frontend/src/components/AppShell.tsx`
- Test: `frontend/src/components/AppShell.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ProtectedRoute.tsx`

**Interfaces:**
- Consumes: `AppNav` (Task 4).
- Produces: `AppShell({ children: ReactNode })` — renders `AppNav` followed by a centered content container. Used by every protected route in `App.tsx`, including `/chat`, fixing its missing-nav bug.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/AppShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from '../contexts/ThemeContext'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders the nav and its children', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AppShell>
            <p>Page content</p>
          </AppShell>
        </ThemeProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/AppShell.test.tsx`
Expected: FAIL — `./AppShell` module does not exist.

- [ ] **Step 3: Create AppShell**

Create `frontend/src/components/AppShell.tsx`:

```tsx
import { ReactNode } from 'react'

import { AppNav } from './AppNav'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/AppShell.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Wire AppShell into every protected route**

Replace `frontend/src/App.tsx` in full:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { ChatPage } from './pages/ChatPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { LoginPage } from './pages/LoginPage'
import { QuizHistoryPage } from './pages/QuizHistoryPage'
import { QuizPage } from './pages/QuizPage'
import { SearchPage } from './pages/SearchPage'
import { SignupPage } from './pages/SignupPage'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/documents"
          element={
            <ProtectedRoute>
              <AppShell>
                <DocumentsPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/search"
          element={
            <ProtectedRoute>
              <AppShell>
                <SearchPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quiz"
          element={
            <ProtectedRoute>
              <AppShell>
                <QuizPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quiz/history"
          element={
            <ProtectedRoute>
              <AppShell>
                <QuizHistoryPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <AppShell>
                <ChatPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  )
}
```

- [ ] **Step 6: Style ProtectedRoute's loading state**

Replace `frontend/src/components/ProtectedRoute.tsx` in full:

```tsx
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <p className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</p>
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing (55 existing + 1 new `AppShell` test). `App.test.tsx`'s unauthenticated-redirect test is unaffected — `ProtectedRoute` returns `<Navigate>` before `AppShell` ever renders.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/AppShell.test.tsx frontend/src/App.tsx frontend/src/components/ProtectedRoute.tsx
git commit -m "feat: add AppShell and wire it into every protected route"
```

---

### Task 6: Restyle Login and Signup pages

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/SignupPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Button`, `Card`, `Input` (Task 3).
- No new tests — `LoginPage.test.tsx` is the existing regression check. There is no `SignupPage.test.tsx` in the codebase today; that pre-existing gap is out of scope here.

- [ ] **Step 1: Restyle LoginPage**

Replace `frontend/src/pages/LoginPage.tsx` in full:

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Log in</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No account?{' '}
            <Link to="/signup" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Sign up
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Restyle SignupPage**

Replace `frontend/src/pages/SignupPage.tsx` in full:

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Sign up</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="signup-email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Log in
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing (no count change — `LoginPage.test.tsx` must pass unmodified).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/SignupPage.tsx
git commit -m "style: restyle Login and Signup pages with Tailwind"
```

---

### Task 7: Restyle Documents page

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Badge`, `Button`, `Card` (Task 3).
- No new tests — `DocumentsPage.test.tsx` is the existing regression check, including its literal `'(processing)'` / `'(ready)'` text assertions.

- [ ] **Step 1: Restyle DocumentsPage**

Replace `frontend/src/pages/DocumentsPage.tsx` in full:

```tsx
import { ChangeEvent, useEffect, useState } from 'react'

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

const STATUS_VARIANT = {
  uploading: 'gray',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
} as const

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)

  async function refresh() {
    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch {
      setError('Failed to load documents')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === 'uploading' || d.status === 'processing',
    )
    if (!hasPending) return
    const intervalId = setInterval(refresh, 3000)
    return () => clearInterval(intervalId)
  }, [documents])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    } finally {
      event.target.value = ''
    }
  }

  async function handleRename(doc: DocumentListItem) {
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    try {
      await renameDocument(doc.id, newName)
      await refresh()
    } catch {
      setError('Failed to rename document')
    }
  }

  async function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    try {
      await deleteDocument(doc.id)
      await refresh()
    } catch {
      setError('Failed to delete document')
    }
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Your Documents</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label
          htmlFor="upload-input"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Upload document
        </label>
        <input
          id="upload-input"
          type="file"
          onChange={handleUpload}
          className="block text-sm text-gray-700 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-gray-300 dark:file:bg-indigo-950 dark:file:text-indigo-300"
        />
      </div>
      <ul className="space-y-3">
        {documents.map((doc) => (
          <li key={doc.id}>
            <Card className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {doc.filename}
                </span>
                <Badge variant={STATUS_VARIANT[doc.status]}>({doc.status})</Badge>
              </div>
              <div className="flex gap-2">
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
          </li>
        ))}
      </ul>
      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing — including `DocumentsPage.test.tsx`'s polling test and its exact `'(processing)'`/`'(ready)'` text assertions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx
git commit -m "style: restyle Documents page with Tailwind"
```

---

### Task 8: Restyle Search page

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Button`, `Card`, `Input` (Task 3).
- No new tests — `SearchPage.test.tsx` is the existing regression check.

- [ ] **Step 1: Restyle SearchPage**

Replace `frontend/src/pages/SearchPage.tsx` in full:

```tsx
import { FormEvent, useState } from 'react'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { search, SearchResult } from '../lib/api'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const found = await search(query)
      setResults(found)
    } catch {
      setError('Search failed, try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Search</h1>
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor="search-input"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Search your documents
          </label>
          <Input id="search-input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Searching...</p>}
      {results !== null && !loading && results.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No results found</p>
      )}
      {results !== null && !loading && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={`${r.document_id}-${r.chunk_index}`}>
              <Card>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {r.filename} — passage {r.chunk_index + 1} of {r.total_chunks}
                </p>
                <p className="mt-1 text-gray-900 dark:text-gray-100">{r.content}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx
git commit -m "style: restyle Search page with Tailwind"
```

---

### Task 9: Restyle Chat page

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Badge`, `Button`, `Card`, `Input` (Task 3).
- No new tests — `ChatPage.test.tsx` is the existing regression check.

- [ ] **Step 1: Restyle ChatPage and remove its now-redundant hardcoded nav link**

Replace `frontend/src/pages/ChatPage.tsx` in full (note: the `Link`-based `<Link to="/documents">Documents</Link>` from the original is removed — `AppShell`, wired in Task 5, now renders navigation for every protected page including this one):

```tsx
import { FormEvent, useEffect, useState } from 'react'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'

export function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    createChatSession().then((session) => setSessionId(session.id))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || !sessionId) return
    setSending(true)
    setError(null)
    try {
      const { user_message, assistant_message } = await sendChatMessage(sessionId, input, webSearch)
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    } catch {
      setError('Failed to send message, try again')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Chat</h1>
      {error && <Alert>{error}</Alert>}
      <ul className="space-y-3">
        {messages.map((message) => (
          <li key={message.id}>
            <Card
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-lg bg-indigo-50 dark:bg-indigo-950'
                  : 'max-w-lg'
              }
            >
              <p className="text-gray-900 dark:text-gray-100">{message.content}</p>
              {message.used_web_search && (
                <div className="mt-2">
                  <Badge variant="amber">Web</Badge>
                </div>
              )}
              {message.citations.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                  {message.citations.map((citation) => (
                    <li key={`${citation.document_id}-${citation.chunk_index}`}>
                      {citation.filename} — passage {citation.chunk_index + 1} of{' '}
                      {citation.total_chunks}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="chat-input"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Ask a question
          </label>
          <Input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Search the web for this message
          </label>
          <Button type="submit" disabled={sending}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing — including `ChatPage.test.tsx`'s web-search-badge and citation-text assertions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "style: restyle Chat page with Tailwind and drop its redundant nav link"
```

---

### Task 10: Restyle Quiz page

**Files:**
- Modify: `frontend/src/pages/QuizPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Button`, `Card`, `Input` (Task 3).
- No new tests — `QuizPage.test.tsx` is the existing regression check, including its `getByLabelText`/`getAllByLabelText` queries against checkbox/radio option text.

- [ ] **Step 1: Restyle QuizPage**

Replace `frontend/src/pages/QuizPage.tsx` in full:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import {
  DocumentListItem,
  Quiz,
  QuizAttemptResult,
  generateQuiz,
  listDocuments,
  submitQuizAttempt,
} from '../lib/api'

export function QuizPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<QuizAttemptResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listDocuments().then(setDocuments)
  }, [])

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const generated = await generateQuiz(selectedIds, numQuestions)
      setQuiz(generated)
      setAnswers({})
      setResult(null)
    } catch {
      setError('Failed to generate quiz, try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quiz) return
    setLoading(true)
    setError(null)
    try {
      const submittedAnswers = quiz.questions
        .filter((q) => q.id in answers)
        .map((q) => ({ question_id: q.id, selected_option: answers[q.id] }))
      const scored = await submitQuizAttempt(quiz.id, submittedAnswers)
      setResult(scored)
    } catch {
      setError('Failed to submit quiz, try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Quiz</h1>
        <Link
          to="/quiz/history"
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Past attempts
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}

      {!quiz && (
        <form onSubmit={handleGenerate} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Select documents
            </legend>
            {documents
              .filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-2 rounded-md border border-gray-200 p-3 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {doc.filename}
                </label>
              ))}
          </fieldset>
          <div>
            <label
              htmlFor="num-questions"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Number of questions
            </label>
            <Input
              id="num-questions"
              type="number"
              min={5}
              max={20}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button type="submit" disabled={loading}>
            Generate Quiz
          </Button>
        </form>
      )}

      {quiz && !result && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {quiz.actual_count < quiz.requested_count && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
              selected documents didn't have enough distinct content for more.
            </p>
          )}
          {quiz.questions.map((q) => (
            <Card key={q.id}>
              <fieldset className="space-y-2">
                <legend className="font-medium text-gray-900 dark:text-gray-100">
                  {q.question}
                </legend>
                {q.options.map((option, index) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={index}
                      checked={answers[q.id] === index}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: index }))}
                      className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            </Card>
          ))}
          <Button type="submit" disabled={loading}>
            Submit
          </Button>
        </form>
      )}

      {result && (
        <Card className="space-y-4">
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {result.score} / {result.total_questions}
          </p>
          <ul className="space-y-3">
            {result.results.map((r) => (
              <li
                key={r.question_id}
                className={
                  r.is_correct
                    ? 'rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950'
                    : 'rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950'
                }
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">{r.question}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  your answer: {r.selected_option === null ? '(none)' : r.options[r.selected_option]}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  correct answer: {r.options[r.correct_answer]}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {r.source_reference.filename} — passage {r.source_reference.chunk_index + 1} of{' '}
                  {r.source_reference.total_chunks}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing — including the degraded-count banner text and the exact `getByLabelText('policy.pdf')` / `getAllByLabelText('30 days')` queries.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QuizPage.tsx
git commit -m "style: restyle Quiz page with Tailwind"
```

---

### Task 11: Restyle Quiz History page

**Files:**
- Modify: `frontend/src/pages/QuizHistoryPage.tsx`

**Interfaces:**
- Consumes: `Alert`, `Card` (Task 3).
- No new tests — `QuizHistoryPage.test.tsx` is the existing regression check.

- [ ] **Step 1: Restyle QuizHistoryPage**

Replace `frontend/src/pages/QuizHistoryPage.tsx` in full:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { QuizAttemptSummary, listQuizAttempts } from '../lib/api'

export function QuizHistoryPage() {
  const [attempts, setAttempts] = useState<QuizAttemptSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listQuizAttempts()
      .then(setAttempts)
      .catch(() => setError('Failed to load quiz history, try again'))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Past Quiz Attempts
        </h1>
        <Link to="/quiz" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Take a quiz
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No quiz attempts yet</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <ul className="space-y-3">
          {attempts.map((a) => (
            <li key={a.id}>
              <Card className="text-sm text-gray-900 dark:text-gray-100">
                {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
                {a.completed_at}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing — including the `{ exact: false }` joined-text assertion.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QuizHistoryPage.tsx
git commit -m "style: restyle Quiz History page with Tailwind"
```

---

### Task 12: Restyle PreviewModal and final verification

**Files:**
- Modify: `frontend/src/components/PreviewModal.tsx`

**Interfaces:**
- Consumes: `Button` (Task 3).
- No new tests — `PreviewModal.test.tsx` is the existing regression check.

- [ ] **Step 1: Restyle PreviewModal**

Replace `frontend/src/components/PreviewModal.tsx` in full:

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
    <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 dark:bg-gray-900">
        <div className="mb-2 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {content?.kind === 'pdf' && (
          <iframe title="Document preview" src={content.value} width="100%" height="600" />
        )}
        {content?.kind === 'text' && (
          <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">
            {content.value}
          </pre>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run the full suite (final verification for the whole styling pass)**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 17 test files, 56 tests, all passing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PreviewModal.tsx
git commit -m "style: restyle PreviewModal with Tailwind"
```

---

## Manual End-to-End Verification (after all tasks complete)

1. Start the backend (`cd backend && uvicorn app.main:app --reload`) and frontend (`cd frontend && npm run dev`) against a real Supabase project (per Foundation's manual verification steps).
2. Log in, and confirm the navbar now shows all five links (Documents, Search, Chat, Quiz, Quiz History) with the current page highlighted in indigo.
3. Click the theme toggle: confirm every page (including modals) switches to a legible dark palette, and that reloading the page keeps the chosen theme.
4. Visit `/chat` directly (e.g. by typing the URL) and confirm the navbar now renders there too — this is the bug this plan fixes.
5. Upload a document, confirm the status badge updates colors as it moves uploading → processing → ready.
6. Run a search, ask a chat question (with and without the web-search checkbox), and generate/take a quiz — confirm all existing functionality still works, just restyled, and that the quiz's correct/incorrect rows are color-coded after submission.
