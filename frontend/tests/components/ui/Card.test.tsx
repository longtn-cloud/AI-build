import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card } from '../../../src/components/ui/Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>Hello</Card>)

    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('lets a caller-supplied className override a conflicting base utility', () => {
    render(<Card className="bg-red-500">Hi</Card>)
    const el = screen.getByText('Hi')

    expect(el.className).toContain('bg-red-500')
    expect(el.className).not.toContain('bg-white')
  })
})
