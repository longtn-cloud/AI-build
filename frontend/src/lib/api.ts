import { supabase } from './supabaseClient'

const API_BASE = import.meta.env.VITE_API_BASE_URL

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// The backend is the source of truth for token validity: a locally cached Supabase
// session can be stale (expired/revoked) even while it still looks present client-side.
// Signing out on 401 clears that stale session so ProtectedRoute redirects to /login.
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) await supabase.auth.signOut()
  return res
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
  const res = await apiFetch(`${API_BASE}/documents`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list documents')
  return res.json()
}

export async function uploadDocument(file: File): Promise<Document> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiFetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: await authHeader(),
    body: formData,
  })
  if (!res.ok) throw new Error('Failed to upload document')
  return res.json()
}

export async function renameDocument(id: string, filename: string): Promise<Document> {
  const res = await apiFetch(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) throw new Error('Failed to rename document')
  return res.json()
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete document')
}

export async function getDownloadUrl(id: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/documents/${id}/download`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to get download URL')
  const data = await res.json()
  return data.url
}

export async function getPreviewText(id: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/documents/${id}/preview`, { headers: await authHeader() })
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
  const res = await apiFetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
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
  const res = await apiFetch(`${API_BASE}/chat/sessions`, {
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
  const res = await apiFetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, web_search: webSearch }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}

export type QuizQuestion = { id: string; question: string; options: string[] }

export type Quiz = {
  id: string
  document_ids: string[]
  requested_count: number
  actual_count: number
  created_at: string
  questions: QuizQuestion[]
}

export async function generateQuiz(documentIds: string[], numQuestions: number): Promise<Quiz> {
  const res = await apiFetch(`${API_BASE}/quiz/generate`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_ids: documentIds, num_questions: numQuestions }),
  })
  if (!res.ok) throw new Error('Failed to generate quiz')
  return res.json()
}

export async function getQuiz(quizId: string): Promise<Quiz> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}`, {
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to load quiz')
  return res.json()
}

export type QuizAnswer = { question_id: string; selected_option: number }

export type QuizResult = {
  question_id: string
  question: string
  options: string[]
  selected_option: number | null
  correct_answer: number
  is_correct: boolean
  source_reference: { document_id: string; filename: string; chunk_index: number; total_chunks: number }
}

export type QuizAttemptResult = {
  id: string
  quiz_id: string
  score: number
  total_questions: number
  completed_at: string
  results: QuizResult[]
}

export async function submitQuizAttempt(quizId: string, answers: QuizAnswer[]): Promise<QuizAttemptResult> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}/attempts`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) throw new Error('Failed to submit quiz attempt')
  return res.json()
}

export type QuizAttemptSummary = {
  id: string
  quiz_id: string
  score: number
  total_questions: number
  completed_at: string
  document_filenames: string[]
}

export async function listQuizAttempts(): Promise<QuizAttemptSummary[]> {
  const res = await apiFetch(`${API_BASE}/quiz/attempts`, {
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to load quiz history')
  const data = await res.json()
  return data.attempts
}
