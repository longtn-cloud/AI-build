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
