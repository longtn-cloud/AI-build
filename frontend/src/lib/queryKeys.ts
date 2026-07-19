export const queryKeys = {
  documents: ['documents'] as const,
  sharedDocuments: ['sharedDocuments'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
  quiz: (quizId: string) => ['quiz', quizId] as const,
  teams: ['teams'] as const,
  teamMembers: (teamId: string) => ['teamMembers', teamId] as const,
  sharedQuizzes: ['sharedQuizzes'] as const,
}
