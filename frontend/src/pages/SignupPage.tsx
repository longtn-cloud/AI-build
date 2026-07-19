import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function SignupPage() {
  const { t } = useTranslation('auth')
  const { signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { error } = await signUp(email, password)
    if (error) {
      setError(error)
      return
    }
    navigate('/documents')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('signup')}</h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="signup-email"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('email')}
            </label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="signup-password"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('password')}
            </label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            {t('signup')}
          </Button>
          <p className="text-sm text-muted">
            {t('alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-accent-hover hover:underline">
              {t('loginLink')}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
