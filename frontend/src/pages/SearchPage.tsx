import { FormEvent, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { search } from '../lib/api'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const searchMutation = useMutation({ mutationFn: (q: string) => search(q) })
  const results = searchMutation.data ?? null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    searchMutation.mutate(query)
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-parchment">Search</h1>
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor="search-input"
            className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
          >
            Search your documents
          </label>
          <Input id="search-input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {searchMutation.isError && <Alert>Search failed, try again</Alert>}
      {searchMutation.isPending && (
        <p className="font-mono text-sm text-parchment/60">Searching...</p>
      )}
      {results !== null && !searchMutation.isPending && results.length === 0 && (
        <p className="font-mono text-sm text-parchment/60">No results found</p>
      )}
      {results !== null && !searchMutation.isPending && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={`${r.document_id}-${r.chunk_index}`}>
              <Card className="space-y-2">
                <CitationStub>
                  {r.filename} — passage {r.chunk_index + 1} of {r.total_chunks}
                </CitationStub>
                <p className="font-body text-ink dark:text-parchment">{r.content}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
