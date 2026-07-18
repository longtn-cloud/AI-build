import { InputHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={twMerge(
        'w-full rounded-sm border border-rule bg-parchment px-3 py-2 font-body text-sm text-ink placeholder-ink/40 focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass dark:border-rule-dark dark:bg-parchment-dark dark:text-parchment dark:placeholder-parchment/40',
        className,
      )}
      {...props}
    />
  )
}
