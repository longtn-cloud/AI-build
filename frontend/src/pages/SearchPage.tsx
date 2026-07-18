import { FormEvent, useState } from 'react'

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
    <div>
      <h1>Search</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="search-input">Search your documents</label>
        <input id="search-input" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading && <p>Searching...</p>}
      {results !== null && !loading && results.length === 0 && <p>No results found</p>}
      {results !== null && !loading && results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={`${r.document_id}-${r.chunk_index}`}>
              <span>
                {r.filename} — passage {r.chunk_index + 1} of {r.total_chunks}
              </span>
              <p>{r.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
