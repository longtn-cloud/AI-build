import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import authEn from './locales/en/auth.json'
import chatEn from './locales/en/chat.json'
import commonEn from './locales/en/common.json'
import documentsEn from './locales/en/documents.json'
import quizEn from './locales/en/quiz.json'
import searchEn from './locales/en/search.json'
import teamsEn from './locales/en/teams.json'
import authVi from './locales/vi/auth.json'
import chatVi from './locales/vi/chat.json'
import commonVi from './locales/vi/common.json'
import documentsVi from './locales/vi/documents.json'
import quizVi from './locales/vi/quiz.json'
import searchVi from './locales/vi/search.json'
import teamsVi from './locales/vi/teams.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      vi: {
        common: commonVi,
        auth: authVi,
        documents: documentsVi,
        search: searchVi,
        chat: chatVi,
        quiz: quizVi,
        teams: teamsVi,
      },
      en: {
        common: commonEn,
        auth: authEn,
        documents: documentsEn,
        search: searchEn,
        chat: chatEn,
        quiz: quizEn,
        teams: teamsEn,
      },
    },
    fallbackLng: 'vi',
    defaultNS: 'common',
    ns: ['common', 'auth', 'documents', 'search', 'chat', 'quiz', 'teams'],
    detection: { order: ['localStorage'], caches: ['localStorage'] },
    interpolation: { escapeValue: false },
  })

export default i18n
