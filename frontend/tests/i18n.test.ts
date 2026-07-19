import { describe, expect, it } from 'vitest'

import i18n from '../src/i18n'

describe('i18n', () => {
  it('defaults to Vietnamese when nothing is in localStorage', () => {
    expect(i18n.language).toBe('vi')
    expect(i18n.t('common:appName')).toBe('DigiAgent')
    expect(i18n.t('common:signOut')).toBe('Đăng xuất')
  })

  it('has matching English translations for the same keys', () => {
    expect(i18n.getFixedT('en', 'common')('signOut')).toBe('Sign out')
  })

  it('has a teams namespace with matching English and Vietnamese keys', () => {
    expect(i18n.getFixedT('vi', 'teams')('createTeam')).toBe('Tạo nhóm')
    expect(i18n.getFixedT('en', 'teams')('createTeam')).toBe('Create team')
  })
})
