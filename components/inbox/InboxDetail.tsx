'use client'

import { useState } from 'react'
import { DomainBadge } from '@/components/shared/DomainBadge'
import { ScoreBar } from '@/components/shared/ScoreBar'
import { cn } from '@/lib/utils/cn'
import type { InboxItem } from '@/types'

interface InboxDetailProps {
  item: InboxItem
  onUpdate: (id: string, updates: Partial<InboxItem>) => Promise<void>
}

const REC_LABELS = {
  do_this_week: { label: 'Do this week', style: 'border-wealth text-wealth' },
  queue: { label: 'Queue for later', style: 'border-ventures text-ventures' },
  archive: { label: 'Archive', style: 'border-zinc-600 text-zinc-400' },
}

export function InboxDetail({ item, onUpdate }: InboxDetailProps) {
  const [acting, setActing] = useState<string | null>(null)

  async function act(status: 'scheduled' | 'triaged' | 'archived') {
    setActing(status)
    try {
      await onUpdate(item.id, { status })
    } finally {
      setActing(null)
    }
  }

  const isAnalyzing = item.alignment_score === null

  return (
    <div className="p-5 space-y-5 animate-fade-in">
      {/* Content */}
      <div>
        <p className="text-base text-zinc-100 leading-relaxed">{item.content}</p>
        <div className="flex items-center gap-2 mt-2">
          <DomainBadge domain={item.source_domain} size="md" />
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
            {item.type}
          </span>
          {item.estimated_time_minutes && (
            <span className="font-mono text-[10px] text-zinc-600">
              ~{item.estimated_time_minutes}m
            </span>
          )}
        </div>
      </div>

      {/* AI Analysis */}
      {isAnalyzing ? (
        <div className="border border-surface-border p-4 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 animate-pulse">
            AI analyzing alignment...
          </div>
          <div className="h-1 bg-surface-border rounded overflow-hidden">
            <div className="h-full bg-zinc-700 animate-pulse w-1/2" />
          </div>
        </div>
      ) : (
        <div className="border border-surface-border p-4 space-y-3">
          {/* Score */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                Alignment
              </span>
              <span className="font-mono text-sm tabular-nums text-zinc-300">
                {item.alignment_score}/10
              </span>
            </div>
            <ScoreBar score={(item.alignment_score ?? 0) * 10} />
          </div>

          {/* Reasoning */}
          {item.alignment_reasoning && (
            <p className="text-xs text-zinc-400 leading-relaxed border-l border-surface-border pl-3">
              {item.alignment_reasoning}
            </p>
          )}

          {/* Conflicts */}
          {item.conflicts_with && (
            <div className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-body uppercase tracking-wider shrink-0">
                Conflicts
              </span>
              <p className="text-xs text-zinc-400">{item.conflicts_with}</p>
            </div>
          )}

          {/* Recommendation */}
          {item.ai_recommendation && (
            <div className="pt-2 border-t border-surface-border">
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'font-mono text-[10px] px-1.5 py-0.5 border shrink-0',
                    REC_LABELS[item.ai_recommendation].style
                  )}
                >
                  {REC_LABELS[item.ai_recommendation].label}
                </span>
              </div>
              {item.ai_recommendation_reason && (
                <p className="text-xs text-zinc-500 mt-1.5 pl-0.5">
                  {item.ai_recommendation_reason}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => act('scheduled')}
          disabled={!!acting || item.status === 'scheduled'}
          className={cn(
            'font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors',
            item.status === 'scheduled'
              ? 'border-wealth text-wealth'
              : 'border-surface-border text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 disabled:opacity-40'
          )}
        >
          {acting === 'scheduled' ? '...' : 'Schedule this week'}
        </button>
        <button
          onClick={() => act('triaged')}
          disabled={!!acting || item.status === 'triaged'}
          className={cn(
            'font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors',
            item.status === 'triaged'
              ? 'border-ventures text-ventures'
              : 'border-surface-border text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 disabled:opacity-40'
          )}
        >
          {acting === 'triaged' ? '...' : 'Queue for later'}
        </button>
        <button
          onClick={() => act('archived')}
          disabled={!!acting || item.status === 'archived'}
          className={cn(
            'font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors',
            item.status === 'archived'
              ? 'border-zinc-500 text-zinc-500'
              : 'border-surface-border text-zinc-700 hover:border-zinc-600 hover:text-zinc-500 disabled:opacity-40'
          )}
        >
          {acting === 'archived' ? '...' : 'Archive'}
        </button>
      </div>
    </div>
  )
}
