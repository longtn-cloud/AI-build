export const queryKeys = {
  documents: ['documents'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
  quiz: (quizId: string) => ['quiz', quizId] as const,
}
