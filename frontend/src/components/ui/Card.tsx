import { HTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-[14px] border border-line bg-white p-4 text-ink shadow-sm',
        className,
      )}
      {...props}
    />
  )
}
