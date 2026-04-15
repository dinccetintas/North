'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { DomainBadge } from '@/components/shared/DomainBadge'
import { InboxDetail } from '@/components/inbox/InboxDetail'
import type { WeeklyPlan, InboxItem, Domain } from '@/types'

const DOMAINS: Domain[] = ['ventures', 'career', 'wealth', 'body', 'mind']

interface WeeklyClientProps {
  weekPlan: WeeklyPlan | null
  unreviewedItems: InboxItem[]
  weekStart: string
}

export function WeeklyClient({ weekPlan, unreviewedItems, weekStart }: WeeklyClientProps) {
  const [capacity, setCapacity] = useState(weekPlan?.capacity ?? 5)
  const [targets, setTargets] = useState<Record<string, string>>(
    weekPlan?.domain_targets ?? {}
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [triageItem, setTriageItem] = useState<InboxItem | null>(null)
  const [inboxItems, setInboxItems] = useState(unreviewedItems)

  async function savePlan() {
    setSaving(true)
    try {
      await fetch('/api/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart, capacity, domain_targets: targets }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleInboxUpdate(id: string, updates: Partial<InboxItem>) {
    const res = await fetch(`/api/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      setInboxItems((prev) => prev.filter((i) => i.id !== id))
      setTriageItem(null)
    }
  }

  const overloaded = capacity <= 4 && Object.values(targets).filter(Boolean).length >= 5

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">
      {/* Capacity */}
      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-3">
          Capacity this week
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={10}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="flex-1 accent-ventures"
          />
          <span className="font-mono text-xl tabular-nums text-zinc-200 w-8 text-right">
            {capacity}
          </span>
          <span className="font-mono text-xs text-zinc-600">/ 10</span>
        </div>
        <p className="font-mono text-[10px] text-zinc-700 mt-1">
          {capacity <= 3 && 'Light week. Protect recovery.'}
          {capacity >= 4 && capacity <= 6 && 'Moderate. Standard operating week.'}
          {capacity >= 7 && capacity <= 8 && 'Heavy. Watch for burnout.'}
          {capacity >= 9 && 'Max load. Something important is happening — or you\'re lying to yourself.'}
        </p>
      </section>

      {/* Overload warning */}
      {overloaded && (
        <div className="border-l-2 border-warning pl-3 py-1 text-sm text-warning">
          Low capacity ({capacity}/10) but 5 domain targets set. Consider dropping the lowest-priority domain target.
        </div>
      )}

      {/* Domain targets */}
      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
          This week&apos;s targets
        </p>
        <div className="space-y-3">
          {DOMAINS.map((domain) => (
            <div key={domain} className="flex items-start gap-3">
              <DomainBadge domain={domain} size="md" className="mt-2 shrink-0" />
              <input
                type="text"
                value={targets[domain] ?? ''}
                onChange={(e) =>
                  setTargets((prev) => ({ ...prev, [domain]: e.target.value }))
                }
                placeholder={`${domain} target...`}
                className={cn(
                  'flex-1 bg-surface-raised border border-surface-border text-sm text-zinc-200',
                  'placeholder-zinc-700 px-3 py-2 outline-none',
                  'focus:border-zinc-600 transition-colors'
                )}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Save */}
      <div>
        <button
          onClick={savePlan}
          disabled={saving}
          className={cn(
            'font-mono text-xs uppercase tracking-widest px-4 py-2 border transition-colors',
            saved
              ? 'border-wealth text-wealth'
              : 'border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white disabled:opacity-50'
          )}
        >
          {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save plan →'}
        </button>
      </div>

      {/* Inbox triage */}
      {inboxItems.length > 0 && (
        <section>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
            Inbox triage ({inboxItems.length} unreviewed)
          </p>
          <div className="space-y-2">
            {inboxItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'border border-surface-border p-3 cursor-pointer hover:bg-surface-raised transition-colors',
                  triageItem?.id === item.id && 'bg-surface-overlay border-zinc-600'
                )}
                onClick={() => setTriageItem(triageItem?.id === item.id ? null : item)}
              >
                <div className="flex items-start gap-2">
                  <DomainBadge domain={item.source_domain} />
                  {item.alignment_score !== null && (
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                      {item.alignment_score}/10
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-300 mt-1 line-clamp-2">{item.content}</p>

                {triageItem?.id === item.id && (
                  <div className="mt-3 border-t border-surface-border pt-3">
                    <InboxDetail item={item} onUpdate={handleInboxUpdate} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
