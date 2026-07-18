import { FormEvent, useState } from 'react'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
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
      {error && <Alert>{error}</Alert>}
      {loading && <p className="font-mono text-sm text-parchment/60">Searching...</p>}
      {results !== null && !loading && results.length === 0 && (
        <p className="font-mono text-sm text-parchment/60">No results found</p>
      )}
      {results !== null && !loading && results.length > 0 && (
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
