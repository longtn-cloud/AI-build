import { ButtonHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brass text-ink hover:bg-brass/90 disabled:bg-brass/40 disabled:text-ink/50',
  secondary:
    'border border-rule text-ink hover:bg-parchment/70 disabled:text-ink/40 dark:border-rule-dark dark:text-parchment dark:hover:bg-parchment-dark/60',
  danger: 'bg-oxblood text-parchment hover:bg-oxblood/90 disabled:bg-oxblood/40',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={twMerge(
        'rounded-sm px-3 py-2 font-body text-sm font-medium tracking-tight transition-colors disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    />
  )
}
