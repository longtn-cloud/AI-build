import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Input } from './Input'

describe('Input', () => {
  it('forwards its value and calls onChange with the new value', () => {
    const onChange = vi.fn()
    render(
      <div>
        <label htmlFor="name">Name</label>
        <Input id="name" value="Ada" onChange={onChange} />
      </div>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } })

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('lets a caller-supplied className override a conflicting base utility', () => {
    render(<Input aria-label="Amount" className="w-24" />)
    const el = screen.getByLabelText('Amount')

    expect(el.className).toContain('w-24')
    expect(el.className).not.toContain('w-full')
  })
})
