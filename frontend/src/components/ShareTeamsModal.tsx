import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { listTeams } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ShareTeamsModalProps = {
  sharedTeamIds: string[]
  onShare: (teamId: string) => void
  onUnshare: (teamId: string) => void
  onClose: () => void
}

export function ShareTeamsModal({ sharedTeamIds, onShare, onUnshare, onClose }: ShareTeamsModalProps) {
  const { t } = useTranslation('common')
  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: listTeams })
  const teams = teamsQuery.data ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-[360px]">
        <h3 className="mb-3 text-base font-bold">{t('share.title')}</h3>
        <div className="flex flex-col gap-2">
          {teams.map((team) => {
            const isShared = sharedTeamIds.includes(team.id)
            return (
              <label key={team.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={team.name}
                  checked={isShared}
                  onChange={() => (isShared ? onUnshare(team.id) : onShare(team.id))}
                />
                {team.name}
              </label>
            )
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('share.close')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
