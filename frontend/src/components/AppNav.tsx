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
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

export function AppNav() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col border-r border-brass/30 px-5 py-8">
      <div className="mb-10 border-b border-brass/30 pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-brass">
          Reading Room
        </p>
        <p className="font-display text-lg font-semibold leading-tight text-parchment">
          Document Knowledge Assistant
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={
              location.pathname === link.to
                ? 'rounded-sm bg-brass/20 px-3 py-2 font-body text-sm font-medium text-brass'
                : 'rounded-sm px-3 py-2 font-body text-sm text-parchment/70 transition-colors hover:bg-parchment/10 hover:text-parchment'
            }
          >
            {link.label}
          </Link>
        ))}
      </div>
      <button
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="mt-6 flex items-center justify-center gap-2 rounded-sm border border-brass/30 px-3 py-2 font-mono text-xs text-parchment/70 hover:bg-parchment/10"
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </nav>
  )
}
