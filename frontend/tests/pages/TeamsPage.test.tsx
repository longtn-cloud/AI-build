import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  searchTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
}))

import {
  addTeamMember,
  createTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  searchTeamMembers,
} from '../../src/lib/api'
import { TeamsPage } from '../../src/pages/TeamsPage'

const adminTeam = { id: 't1', name: 'Engineering', role: 'admin' as const, created_at: '2026-01-01T00:00:00Z' }
const memberTeam = { id: 't2', name: 'Design', role: 'member' as const, created_at: '2026-01-01T00:00:00Z' }

describe('TeamsPage', () => {
  it('renders the list of teams', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])

    renderWithQueryClient(<TeamsPage />)

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument()
    })
  })

  it('creates a team and refreshes the list', async () => {
    ;(listTeams as any).mockResolvedValue([])
    ;(createTeam as any).mockResolvedValue(adminTeam)

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('Tên nhóm mới'), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo nhóm' }))

    await waitFor(() => {
      expect(createTeam).toHaveBeenCalledWith('Engineering')
    })
    await waitFor(() => {
      expect(listTeams).toHaveBeenCalledTimes(2)
    })
  })

  it('shows the member search box only for an admin, and lists members on selection', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam, memberTeam])
    ;(listTeamMembers as any).mockResolvedValue([
      { user_id: 'u1', email: 'admin@example.com', role: 'admin', added_at: '2026-01-01T00:00:00Z' },
    ])
    ;(searchTeamMembers as any).mockResolvedValue([])

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))

    fireEvent.click(screen.getByText('Engineering'))
    await waitFor(() => {
      expect(screen.getByText('admin@example.com', { exact: false })).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('Tìm theo email…')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Design'))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Tìm theo email…')).not.toBeInTheDocument()
    })
  })

  it('adds a member found via search', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])
    ;(listTeamMembers as any).mockResolvedValue([])
    ;(searchTeamMembers as any).mockResolvedValue([{ user_id: 'u2', email: 'colleague@example.com' }])
    ;(addTeamMember as any).mockResolvedValue({
      user_id: 'u2',
      email: 'colleague@example.com',
      role: 'member',
      added_at: '2026-01-01T00:00:00Z',
    })

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))
    fireEvent.click(screen.getByText('Engineering'))

    fireEvent.change(screen.getByPlaceholderText('Tìm theo email…'), { target: { value: 'colleague' } })
    await waitFor(() => screen.getByText('colleague@example.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }))

    await waitFor(() => {
      expect(addTeamMember).toHaveBeenCalledWith('t1', 'u2')
    })
  })

  it('removes a member as admin', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])
    ;(listTeamMembers as any).mockResolvedValue([
      { user_id: 'u1', email: 'admin@example.com', role: 'admin', added_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u2', email: 'colleague@example.com', role: 'member', added_at: '2026-01-01T00:00:00Z' },
    ])
    ;(removeTeamMember as any).mockResolvedValue(undefined)

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))
    fireEvent.click(screen.getByText('Engineering'))
    await waitFor(() => screen.getByText('colleague@example.com'))

    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }))

    await waitFor(() => {
      expect(removeTeamMember).toHaveBeenCalledWith('t1', 'u2')
    })
  })
})
