'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface EveningCloseProps {
  onSubmit: (note: string) => Promise<void>
}

export function EveningClose({ onSubmit }: EveningCloseProps) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || done) return
    setSubmitting(true)
    try {
      await onSubmit(note)
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="border border-wealth-dim bg-wealth-bg p-4 text-sm text-wealth font-mono">
        Day closed. Good work.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
          What actually happened today?
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          className={cn(
            'w-full bg-surface-raised border border-surface-border text-sm text-zinc-200 placeholder-zinc-600',
            'p-3 outline-none resize-none font-sans leading-relaxed',
            'focus:border-zinc-600 transition-colors'
          )}
          placeholder="Free-form. Wins, blockers, pivots, anything worth noting..."
          disabled={submitting}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className={cn(
          'font-mono text-xs uppercase tracking-widest px-4 py-2',
          'border border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white',
          'transition-colors disabled:opacity-50'
        )}
      >
        {submitting ? 'Processing...' : 'Close day →'}
      </button>
    </form>
  )
}
