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
})
