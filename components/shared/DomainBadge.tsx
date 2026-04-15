import { DOMAIN_STYLES, type Domain } from '@/types'
import { cn } from '@/lib/utils/cn'

interface DomainBadgeProps {
  domain: Domain
  className?: string
  size?: 'sm' | 'md'
}

export function DomainBadge({ domain, className, size = 'sm' }: DomainBadgeProps) {
  const style = DOMAIN_STYLES[domain]
  return (
    <span
      className={cn(
        'inline-flex items-center font-mono uppercase tracking-widest font-medium',
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
        style.badge,
        className
      )}
    >
      {style.label}
    </span>
  )
}
