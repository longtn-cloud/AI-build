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
