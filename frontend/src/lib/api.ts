import { supabase } from './supabaseClient'

const API_BASE = import.meta.env.VITE_API_BASE_URL

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export type Document = {
  id: string
  user_id: string
  filename: string
  file_type: string
  storage_path: string
  status: DocumentStatus
  error_reason: string | null
  extracted_text: string | null
  uploaded_at: string
}

// The list endpoint omits extracted_text and storage_path (not used by the list UI) to
// avoid shipping every document's full extracted text on every list call.
export type DocumentListItem = Omit<Document, 'extracted_text' | 'storage_path'>

export async function listDocuments(): Promise<DocumentListItem[]> {
  const res = await fetch(`${API_BASE}/documents`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list documents')
  return res.json()
}

export async function uploadDocument(file: File): Promise<Document> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: await authHeader(),
    body: formData,
  })
  if (!res.ok) throw new Error('Failed to upload document')
  return res.json()
}

export async function renameDocument(id: string, filename: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) throw new Error('Failed to rename document')
  return res.json()
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete document')
}

export async function getDownloadUrl(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/documents/${id}/download`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to get download URL')
  const data = await res.json()
  return data.url
}

export async function getPreviewText(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/documents/${id}/preview`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to get preview')
  const data = await res.json()
  return data.text
}

export type SearchResult = {
  document_id: string
  filename: string
  chunk_index: number
  total_chunks: number
  content: string
  score: number
}

export async function search(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Search failed')
  const data = await res.json()
  return data.results
}

export type ChatSession = {
  id: string
  title: string
  created_at: string
}

export type ChatCitation = {
  document_id: string
  filename: string
  chunk_index: number
  total_chunks: number
  score: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: ChatCitation[]
  used_web_search: boolean
  created_at: string
}

export async function createChatSession(): Promise<ChatSession> {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to create chat session')
  return res.json()
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  webSearch: boolean,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, web_search: webSearch }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}
