import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CitationStub } from '../../../src/components/ui/CitationStub'

describe('CitationStub', () => {
  it('renders its children as the visible citation text', () => {
    render(<CitationStub>report.pdf — passage 3 of 5</CitationStub>)

    expect(screen.getByText('report.pdf — passage 3 of 5')).toBeInTheDocument()
  })
})
