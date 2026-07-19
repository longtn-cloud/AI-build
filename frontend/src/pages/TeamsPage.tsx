import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import {
  Team,
  addTeamMember,
  createTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  searchTeamMembers,
} from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function TeamsPage() {
  const { t } = useTranslation('teams')
  const [name, setName] = useState('')
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()

  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: listTeams })
  const teams = teamsQuery.data ?? []

  const membersQuery = useQuery({
    queryKey: queryKeys.teamMembers(selectedTeam?.id ?? ''),
    queryFn: () => listTeamMembers(selectedTeam!.id),
    enabled: !!selectedTeam,
  })
  const members = membersQuery.data ?? []

  const searchQuery = useQuery({
    queryKey: ['memberSearch', selectedTeam?.id, search],
    queryFn: () => searchTeamMembers(selectedTeam!.id, search),
    enabled: !!selectedTeam && search.trim().length > 0,
  })
  const searchResults = searchQuery.data ?? []

  const createMutation = useMutation({
    mutationFn: (teamName: string) => createTeam(teamName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teams })
      setName('')
    },
  })

  const addMutation = useMutation({
    mutationFn: (userId: string) => addTeamMember(selectedTeam!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(selectedTeam!.id) })
      setSearch('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTeamMember(selectedTeam!.id, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(selectedTeam!.id) }),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    createMutation.mutate(name)
  }

  return (
    <div className="px-8 pb-12 pt-7">
      {teamsQuery.isError && <Alert>{t('errors.loadTeams')}</Alert>}

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('createPlaceholder')} />
        <Button type="submit" disabled={createMutation.isPending}>
          {t('createTeam')}
        </Button>
      </form>

      <div className="flex gap-6">
        <div className="flex flex-col gap-2.5">
          {teams.map((team) => (
            <Card key={team.id} onClick={() => setSelectedTeam(team)} className="cursor-pointer">
              <div className="font-bold">{team.name}</div>
              <div className="text-xs text-muted">{t(`roles.${team.role}`)}</div>
            </Card>
          ))}
        </div>

        {selectedTeam && (
          <div className="flex-1">
            <h2 className="mb-3 text-lg font-bold">{selectedTeam.name}</h2>

            {selectedTeam.role === 'admin' && (
              <div className="mb-4">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                />
                {searchResults.map((result) => (
                  <div key={result.user_id} className="mt-2 flex items-center justify-between">
                    <span>{result.email}</span>
                    <Button variant="secondary" onClick={() => addMutation.mutate(result.user_id)}>
                      {t('addMember')}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between">
                  <span>
                    <span>{member.email}</span> — {t(`roles.${member.role}`)}
                  </span>
                  {selectedTeam.role === 'admin' && member.role !== 'admin' && (
                    <Button variant="danger" onClick={() => removeMutation.mutate(member.user_id)}>
                      {t('removeMember')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
