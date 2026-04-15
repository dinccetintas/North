'use client'

import { DomainBadge } from '@/components/shared/DomainBadge'
import { cn } from '@/lib/utils/cn'
import type { DailyPriority, CompletionEntry, Domain } from '@/types'

interface PriorityCardProps {
  priority: DailyPriority
  index: number
  completion: CompletionEntry | undefined
  estimatedMinutes?: number
  onMark: (itemId: string, status: 'done' | 'partial' | 'skipped') => void
  isEvening: boolean
}

const STATUS_STYLES = {
  done: 'border-wealth-dim bg-wealth-bg',
  partial: 'border-ventures-dim bg-ventures-bg',
  skipped: 'border-zinc-800 bg-surface-raised opacity-50',
}

export function PriorityCard({
  priority,
  index,
  completion,
  estimatedMinutes,
  onMark,
  isEvening,
}: PriorityCardProps) {
  const status = completion?.status
  const isDone = status === 'done'

  return (
    <div
      className={cn(
        'border p-4 transition-all duration-200',
        status ? STATUS_STYLES[status] : 'border-surface-border bg-surface-raised'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Index */}
        <span className="font-mono text-zinc-600 text-sm tabular-nums mt-0.5 select-none">
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <DomainBadge domain={priority.domain as Domain} />
            {estimatedMinutes && (
              <span className="font-mono text-[10px] text-zinc-600 tabular-nums">
                ~{estimatedMinutes}m
              </span>
            )}
          </div>
          <p
            className={cn(
              'text-sm leading-snug',
              isDone ? 'line-through text-zinc-600' : 'text-zinc-200'
            )}
          >
            {priority.task}
          </p>
        </div>

        {/* Actions — only in evening mode */}
        {isEvening && (
          <div className="flex flex-col gap-1 shrink-0">
            {(['done', 'partial', 'skipped'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onMark(priority.source_item_id ?? `${index}`, s)}
                className={cn(
                  'font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border transition-colors',
                  status === s
                    ? s === 'done'
                      ? 'border-wealth text-wealth'
                      : s === 'partial'
                      ? 'border-ventures text-ventures'
                      : 'border-zinc-500 text-zinc-500'
                    : 'border-surface-border text-zinc-600 hover:border-zinc-500 hover:text-zinc-400'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
