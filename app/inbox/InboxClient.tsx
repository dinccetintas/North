'use client'

import { useState } from 'react'
import Link from 'next/link'
import { InboxList } from '@/components/inbox/InboxList'
import { InboxDetail } from '@/components/inbox/InboxDetail'
import { QuickCapture } from '@/components/shared/QuickCapture'
import type { InboxItem, InboxStatus } from '@/types'

interface InboxClientProps {
  initialItems: InboxItem[]
}

export function InboxClient({ initialItems }: InboxClientProps) {
  const [items, setItems] = useState<InboxItem[]>(initialItems)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<InboxStatus | 'all'>('all')

  const selectedItem = items.find((i) => i.id === selectedId) ?? null

  function handleCapture(content: string) {
    // Optimistically add item as pending-analysis
    const optimistic: InboxItem = {
      id: `opt-${Date.now()}`,
      user_id: '',
      content,
      type: 'other',
      source_domain: 'unknown',
      alignment_score: null,
      alignment_reasoning: null,
      ai_recommendation: null,
      ai_recommendation_reason: null,
      estimated_time_minutes: null,
      conflicts_with: null,
      status: 'unreviewed',
      scheduled_week: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setItems((prev) => [optimistic, ...prev])

    // Reload after a delay to get real IDs and AI analysis
    setTimeout(async () => {
      const res = await fetch('/api/inbox-list')
      if (res.ok) {
        const data = await res.json()
        setItems(data.items)
      }
    }, 3000)
  }

  async function handleUpdate(id: string, updates: Partial<InboxItem>) {
    const res = await fetch(`/api/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (res.ok) {
      const { item } = await res.json()
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...item } : i)))
    }
  }

  return (
    <div className="h-screen flex flex-col bg-surface text-zinc-200 font-sans overflow-hidden">
      {/* Header */}
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <Link href="/cockpit" className="font-mono text-sm font-bold tracking-widest text-white">
            NORTH
          </Link>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-600">
            Inbox
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cockpit" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">
            Cockpit
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

      {/* Quick capture */}
      <div className="border-b border-surface-border shrink-0">
        <QuickCapture
          onCapture={handleCapture}
          className="border-none border-b-0 rounded-none"
        />
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: list */}
        <div className="w-80 border-r border-surface-border overflow-hidden flex flex-col shrink-0">
          <InboxList
            items={items}
            selectedId={selectedId}
            onSelect={(item) => setSelectedId(item.id)}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedItem ? (
            <InboxDetail item={selectedItem} onUpdate={handleUpdate} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-mono text-sm text-zinc-700">Select an item to review.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
