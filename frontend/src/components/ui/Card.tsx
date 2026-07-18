import { HTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
        className,
      )}
      {...props}
    />
  )
}
