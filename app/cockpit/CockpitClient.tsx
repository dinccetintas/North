'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { PriorityCard } from '@/components/cockpit/PriorityCard'
import { EveningClose } from '@/components/cockpit/EveningClose'
import { RecoveryMode } from '@/components/cockpit/RecoveryMode'
import { MentorFeedStrip } from '@/components/shared/MentorFeedStrip'
import { QuickCapture } from '@/components/shared/QuickCapture'
import { cn } from '@/lib/utils/cn'
import type {
  User,
  AnnualGoal,
  DailyLog,
  MentorFeedItem,
  WeeklyPlan,
  CompletionEntry,
} from '@/types'

interface CockpitClientProps {
  user: User
  goals: AnnualGoal[]
  todayLog: DailyLog | null
  mentorItems: MentorFeedItem[]
  unreviewedCount: number
  weekPlan: WeeklyPlan | null
  inRecovery: boolean
}

function isEvening(): boolean {
  return new Date().getHours() >= 18
}

export function CockpitClient({
  user,
  goals: _goals,
  todayLog,
  mentorItems,
  unreviewedCount,
  weekPlan: _weekPlan,
  inRecovery,
}: CockpitClientProps) {
  const [eveningMode, setEveningMode] = useState(isEvening())
  const [completions, setCompletions] = useState<CompletionEntry[]>(
    todayLog?.completed ?? []
  )
  const [captureCount, setCaptureCount] = useState(unreviewedCount)

  const today = format(new Date(), 'EEEE, MMMM d')
  const priorities = todayLog?.top_3 ?? []
  const morningQuestion = mentorItems.find((m) => m.type === 'question')
  const otherInsights = mentorItems.filter((m) => m.type !== 'question')

  // Show insights: morning question first, then up to 1 other
  const feedItems: MentorFeedItem[] = [
    ...(morningQuestion ? [morningQuestion] : []),
    ...(otherInsights.slice(0, 1)),
  ]

  function handleMark(itemId: string, status: 'done' | 'partial' | 'skipped') {
    setCompletions((prev) => {
      const existing = prev.findIndex((c) => c.item_id === itemId)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = { item_id: itemId, status }
        return next
      }
      return [...prev, { item_id: itemId, status }]
    })

    // Persist
    fetch(`/api/daily-log`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: [...completions, { item_id: itemId, status }] }),
    }).catch(() => {})
  }

  async function handleEveningClose(note: string) {
    const doneCount = completions.filter((c) => c.status === 'done').length
    const totalCount = priorities.length || 3
    const score = Math.round((doneCount / totalCount) * 100)

    await fetch('/api/daily-log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completed: completions,
        evening_note: note,
        score,
      }),
    })

    // Trigger mentor insight based on score
    const trigger =
      score < 40
        ? `Daily score was only ${score}/100 — 3rd low-scoring day`
        : `User completed day with score ${score}/100`

    fetch('/api/ai/mentor-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger }),
    }).catch(() => {})
  }

  // Recovery mode: strip to 1 task
  const singleRecoveryTask = priorities[0]?.task ?? null

  return (
    <div className="min-h-screen bg-surface text-zinc-200 font-sans">
      {/* Header bar */}
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-mono text-sm font-bold tracking-widest text-white">
            NORTH
          </span>
          <span className="font-mono text-xs text-zinc-600 uppercase tracking-wider">
            {today}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Evening mode toggle */}
          <button
            onClick={() => setEveningMode((v) => !v)}
            className={cn(
              'font-mono text-[10px] uppercase tracking-widest px-2 py-1 border transition-colors',
              eveningMode
                ? 'border-ventures-dim text-ventures'
                : 'border-surface-border text-zinc-600 hover:text-zinc-400'
            )}
          >
            {eveningMode ? 'Evening' : 'Morning'}
          </button>

          {/* Inbox badge */}
          <Link
            href="/inbox"
            className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
          >
            Inbox
            {captureCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-ventures text-black text-[10px] font-bold">
                {captureCount > 9 ? '9+' : captureCount}
              </span>
            )}
          </Link>

          <Link href="/goals" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">
            Goals
          </Link>
          <Link href="/weekly" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">
            Week
          </Link>
          <Link href="/mentor" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">
            Mentor
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Recovery Mode — overrides everything */}
        {inRecovery ? (
          <RecoveryMode singleTask={singleRecoveryTask} />
        ) : (
          <>
            {/* ── Zone A: Mentor Feed Strip ── */}
            {feedItems.length > 0 && (
              <section className="animate-fade-in">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-3">
                  Mentor
                </p>
                <MentorFeedStrip items={feedItems} />
              </section>
            )}

            {/* ── Zone B: Today's Priorities ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  {eveningMode ? "Today's Close" : "Today's 3"}
                </p>
                {eveningMode && (
                  <span className="font-mono text-[10px] text-zinc-600">
                    {completions.filter((c) => c.status === 'done').length}/
                    {priorities.length} done
                  </span>
                )}
              </div>

              {priorities.length === 0 ? (
                <div className="border border-surface-border p-4 text-sm text-zinc-600">
                  No priorities set.{' '}
                  <Link href="/weekly" className="text-zinc-400 underline underline-offset-2">
                    Open weekly plan
                  </Link>{' '}
                  to set this week&apos;s targets.
                </div>
              ) : (
                <div className="space-y-2">
                  {priorities.map((p, i) => (
                    <PriorityCard
                      key={i}
                      priority={p}
                      index={i}
                      completion={completions.find(
                        (c) => c.item_id === (p.source_item_id ?? String(i))
                      )}
                      onMark={handleMark}
                      isEvening={eveningMode}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── Zone C: Evening Close (only in evening mode) ── */}
            {eveningMode && (
              <section className="animate-slide-up">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-3">
                  Close
                </p>
                <EveningClose onSubmit={handleEveningClose} />
              </section>
            )}

            {/* ── Zone C: Quick Capture (always) ── */}
            <section>
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-3">
                Capture
              </p>
              <QuickCapture
                onCapture={() => setCaptureCount((n) => n + 1)}
              />
              <p className="font-mono text-[10px] text-zinc-700 mt-1.5 pl-1">
                Everything lands in inbox. AI triages alignment automatically.
              </p>
            </section>
          </>
        )}

        {/* Footer */}
        <footer className="pt-4 border-t border-surface-border">
          <p className="font-mono text-[10px] text-zinc-700">
            {user.identity_statement ?? 'Set your identity statement in Goals →'}
          </p>
        </footer>
      </main>
    </div>
  )
}
