import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listTeams: vi.fn(),
}))

import { listTeams } from '../../src/lib/api'
import { ShareTeamsModal } from '../../src/components/ShareTeamsModal'

describe('ShareTeamsModal', () => {
  it('shows a checked checkbox for already-shared teams and unchecked for others', async () => {
    ;(listTeams as any).mockResolvedValue([
      { id: 't1', name: 'Engineering', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'Design', role: 'member', created_at: '2026-01-01T00:00:00Z' },
    ])

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={['t1']} onShare={vi.fn()} onUnshare={vi.fn()} onClose={vi.fn()} />,
    )

    await waitFor(() => screen.getByText('Engineering'))
    expect(screen.getByLabelText('Engineering')).toBeChecked()
    expect(screen.getByLabelText('Design')).not.toBeChecked()
  })

  it('calls onShare when an unchecked team is clicked, onUnshare when a checked one is', async () => {
    ;(listTeams as any).mockResolvedValue([
      { id: 't1', name: 'Engineering', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'Design', role: 'member', created_at: '2026-01-01T00:00:00Z' },
    ])
    const onShare = vi.fn()
    const onUnshare = vi.fn()

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={['t1']} onShare={onShare} onUnshare={onUnshare} onClose={vi.fn()} />,
    )
    await waitFor(() => screen.getByText('Engineering'))

    fireEvent.click(screen.getByLabelText('Design'))
    expect(onShare).toHaveBeenCalledWith('t2')

    fireEvent.click(screen.getByLabelText('Engineering'))
    expect(onUnshare).toHaveBeenCalledWith('t1')
  })

  it('calls onClose when the close button is clicked', async () => {
    ;(listTeams as any).mockResolvedValue([])
    const onClose = vi.fn()

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={[]} onShare={vi.fn()} onUnshare={vi.fn()} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalled()
  })
})
