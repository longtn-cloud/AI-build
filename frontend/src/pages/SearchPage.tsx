import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { search, SearchFileType, SearchResult } from '../lib/api'

const FILE_TYPES: { id: SearchFileType | ''; label: string }[] = [
  { id: '', label: 'All types' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'DOCX' },
  { id: 'text', label: 'Text' },
]

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

      <div className="my-4 flex flex-wrap items-center gap-2">
        {FILE_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleFileTypeChange(t.id)}
            className={
              fileType === t.id
                ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
            }
          >
            {t.label}
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
          Recent
        </button>
      </div>

      {searchMutation.isError && <Alert>Search failed, try again</Alert>}
      {searchMutation.isPending && <p className="text-sm text-muted">Searching...</p>}
      {results !== null && !searchMutation.isPending && groups.length === 0 && (
        <p className="text-sm text-muted">No results found</p>
      )}
      {groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.document_id}>
              <Card className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-muted">{group.filename}</span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs font-semibold text-muted">
                    {Math.round(group.score * 100)}% match
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.passages.slice(0, visiblePerGroup).map((passage) => (
                    <li key={passage.chunk_index}>
                      <p className="text-xs text-faint">
                        passage {passage.chunk_index + 1} of {passage.total_chunks}
                      </p>
                      <p className="text-[14.5px] leading-relaxed text-ink">
                        {highlight(passage.content, query)}
                      </p>
                    </li>
                  ))}
                </ul>
                {group.passages.length > visiblePerGroup && (
                  <p className="text-xs text-faint">
                    +{group.passages.length - visiblePerGroup} more passages in this document
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
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
