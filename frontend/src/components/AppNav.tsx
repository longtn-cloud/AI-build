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
