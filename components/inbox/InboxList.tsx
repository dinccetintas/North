'use client'

import { cn } from '@/lib/utils/cn'
import { DomainBadge } from '@/components/shared/DomainBadge'
import { format } from 'date-fns'
import type { InboxItem, InboxStatus } from '@/types'

interface InboxListProps {
  items: InboxItem[]
  selectedId: string | null
  onSelect: (item: InboxItem) => void
  filter: InboxStatus | 'all'
  onFilterChange: (f: InboxStatus | 'all') => void
}

const STATUS_TABS: { value: InboxStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'archived', label: 'Archived' },
  { value: 'done', label: 'Done' },
]

const SCORE_BADGE = (score: number) => {
  if (score >= 7) return 'text-wealth bg-wealth-bg border-wealth-dim'
  if (score >= 5) return 'text-ventures bg-ventures-bg border-ventures-dim'
  if (score >= 3) return 'text-zinc-400 bg-zinc-900 border-zinc-700'
  return 'text-body bg-body-bg border-body-dim'
}

export function InboxList({ items, selectedId, onSelect, filter, onFilterChange }: InboxListProps) {
  const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter)

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 p-3 border-b border-surface-border">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === 'all'
            ? items.length
            : items.filter((i) => i.status === tab.value).length
          return (
            <button
              key={tab.value}
              onClick={() => onFilterChange(tab.value)}
              className={cn(
                'font-mono text-[10px] uppercase tracking-wider px-2 py-1 border transition-colors',
                filter === tab.value
                  ? 'border-zinc-400 text-zinc-200'
                  : 'border-surface-border text-zinc-600 hover:text-zinc-400'
              )}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1 text-zinc-700">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-zinc-700 font-mono text-center">
            Empty.
          </div>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className={cn(
                'w-full text-left border-b border-surface-border p-3 transition-colors',
                selectedId === item.id
                  ? 'bg-surface-overlay'
                  : 'hover:bg-surface-raised'
              )}
            >
              {/* Top row */}
              <div className="flex items-start gap-2 mb-1">
                <DomainBadge domain={item.source_domain} className="shrink-0 mt-0.5" />
                {item.alignment_score !== null && (
                  <span
                    className={cn(
                      'font-mono text-[10px] px-1.5 py-0.5 border tabular-nums shrink-0',
                      SCORE_BADGE(item.alignment_score)
                    )}
                  >
                    {item.alignment_score}/10
                  </span>
                )}
                {item.alignment_score === null && (
                  <span className="font-mono text-[10px] text-zinc-700 border border-zinc-800 px-1.5 py-0.5 animate-pulse">
                    analyzing
                  </span>
                )}
              </div>

              {/* Content */}
              <p className="text-sm text-zinc-300 leading-snug line-clamp-2">
                {item.content}
              </p>

              {/* Meta */}
              <p className="font-mono text-[10px] text-zinc-700 mt-1">
                {format(new Date(item.created_at), 'MMM d, HH:mm')}
                {item.estimated_time_minutes && (
                  <span className="ml-2">~{item.estimated_time_minutes}m</span>
                )}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
