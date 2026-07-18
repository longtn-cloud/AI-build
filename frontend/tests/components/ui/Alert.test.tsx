import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Alert } from '../../../src/components/ui/Alert'

describe('Alert', () => {
  it('renders its children with an alert role', () => {
    render(<Alert>Something went wrong</Alert>)

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
