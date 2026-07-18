import { InputHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={twMerge(
        'w-full rounded-[10px] border border-line bg-white px-3 py-2 font-sans text-sm text-ink placeholder-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        className,
      )}
      {...props}
    />
  )
}
