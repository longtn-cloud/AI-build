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
export type DocumentListItem = Omit<Document, 'extracted_text' | 'storage_path'> & {
  shared_team_ids: string[]
}

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

export type SearchResponse = {
  results: SearchResult[]
  has_more: boolean
}

export type SearchFileType = 'pdf' | 'docx' | 'text'

export type SearchOptions = {
  fileType?: SearchFileType
  recent?: boolean
  offset?: number
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`
  if (options.fileType) url += `&file_type=${encodeURIComponent(options.fileType)}`
  if (options.recent) url += '&recent=true'
  if (options.offset) url += `&offset=${options.offset}`
  const res = await apiFetch(url, { headers: await authHeader() })
  if (!res.ok) throw new Error('Search failed')
  return res.json()
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
  used_general_knowledge: boolean
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
  language: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, web_search: webSearch, language }),
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

export async function generateQuiz(
  documentIds: string[],
  numQuestions: number,
  language: string,
): Promise<Quiz> {
  const res = await apiFetch(`${API_BASE}/quiz/generate`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_ids: documentIds, num_questions: numQuestions, language }),
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
  shared_team_ids: string[]
}

export async function listQuizAttempts(): Promise<QuizAttemptSummary[]> {
  const res = await apiFetch(`${API_BASE}/quiz/attempts`, {
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to load quiz history')
  const data = await res.json()
  return data.attempts
}

export type Team = {
  id: string
  name: string
  role: 'admin' | 'member'
  created_at: string
}

export async function createTeam(name: string): Promise<Team> {
  const res = await apiFetch(`${API_BASE}/teams`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create team')
  return res.json()
}

export async function listTeams(): Promise<Team[]> {
  const res = await apiFetch(`${API_BASE}/teams`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list teams')
  return res.json()
}

export type TeamMember = {
  user_id: string
  email: string
  role: 'admin' | 'member'
  added_at: string
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list team members')
  return res.json()
}

export type UserSearchResult = { user_id: string; email: string }

export async function searchTeamMembers(teamId: string, query: string): Promise<UserSearchResult[]> {
  const res = await apiFetch(
    `${API_BASE}/teams/${teamId}/members/search?q=${encodeURIComponent(query)}`,
    { headers: await authHeader() },
  )
  if (!res.ok) throw new Error('Failed to search users')
  return res.json()
}

export async function addTeamMember(teamId: string, userId: string): Promise<TeamMember> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  })
  if (!res.ok) throw new Error('Failed to add team member')
  return res.json()
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to remove team member')
}

export async function shareDocument(documentId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${documentId}/share`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId }),
  })
  if (!res.ok) throw new Error('Failed to share document')
}

export async function unshareDocument(documentId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${documentId}/share/${teamId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to unshare document')
}

export async function listSharedDocuments(): Promise<DocumentListItem[]> {
  const res = await apiFetch(`${API_BASE}/documents/shared`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list shared documents')
  return res.json()
}

export async function shareQuiz(quizId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}/share`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId }),
  })
  if (!res.ok) throw new Error('Failed to share quiz')
}

export async function unshareQuiz(quizId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}/share/${teamId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to unshare quiz')
}

export type SharedQuiz = { id: string; document_ids: string[]; created_at: string }

export async function listSharedQuizzes(): Promise<SharedQuiz[]> {
  const res = await apiFetch(`${API_BASE}/quiz/shared`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list shared quizzes')
  const data = await res.json()
  return data.quizzes
}
