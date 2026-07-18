import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from '../../../src/components/ui/Badge'

describe('Badge', () => {
  it('renders its label text', () => {
    render(<Badge variant="green">ready</Badge>)

    expect(screen.getByText('ready')).toBeInTheDocument()
  })
})
