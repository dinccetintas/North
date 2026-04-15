'use client'

import { cn } from '@/lib/utils/cn'
import type { MentorFeedItem } from '@/types'

interface MentorFeedStripProps {
  items: MentorFeedItem[]
}

const severityStyles = {
  info: 'border-l-zinc-600 text-zinc-300',
  warning: 'border-l-warning text-warning',
  critical: 'border-l-critical text-critical',
}

export function MentorFeedStrip({ items }: MentorFeedStripProps) {
  if (items.length === 0) {
    return (
      <div className="border border-surface-border p-4 text-zinc-600 text-sm font-mono">
        No insights yet. Check back after your first day of tracking.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'border-l-2 pl-3 py-1 text-sm leading-relaxed',
            severityStyles[item.severity]
          )}
        >
          {item.content}
        </div>
      ))}
    </div>
  )
}
