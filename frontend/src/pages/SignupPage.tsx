import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export function SignupPage() {
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
    <div className="flex min-h-screen items-center justify-center bg-felt px-4 dark:bg-felt-dark">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-parchment">
            Sign up
          </h1>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-1">
            <label
              htmlFor="signup-email"
              className="block font-mono text-xs uppercase tracking-wide text-ink/60 dark:text-parchment/60"
            >
              Email
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
              className="block font-mono text-xs uppercase tracking-wide text-ink/60 dark:text-parchment/60"
            >
              Password
            </label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            Sign up
          </Button>
          <p className="font-body text-sm text-ink/70 dark:text-parchment/70">
            Already have an account?{' '}
            <Link to="/login" className="text-brass hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
