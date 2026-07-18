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
    return true
  })

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-12 pt-7">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-3 rounded-[13px] border border-line bg-white py-1 pl-4 pr-1 shadow-sm"
      >
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
