import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { getUser, getMentorFeed } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils/cn'
import { DomainBadge } from '@/components/shared/DomainBadge'
import type { MentorFeedItem, Severity, MentorFeedType } from '@/types'

export const dynamic = 'force-dynamic'

const SEVERITY_STYLES: Record<Severity, string> = {
  info: 'border-l-zinc-700 text-zinc-300',
  warning: 'border-l-warning text-zinc-200',
  critical: 'border-l-critical text-zinc-100',
}

const TYPE_LABELS: Record<MentorFeedType, string> = {
  pattern: 'PATTERN',
  warning: 'WARNING',
  insight: 'INSIGHT',
  question: 'QUESTION',
  weekly_debrief: 'DEBRIEF',
}

function InsightCard({ item }: { item: MentorFeedItem }) {
  return (
    <div
      className={cn(
        'border-l-2 pl-4 py-3 border-b border-surface-border',
        SEVERITY_STYLES[item.severity]
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {TYPE_LABELS[item.type]}
        </span>
        {item.related_domain && (
          <DomainBadge domain={item.related_domain} />
        )}
        <span className="font-mono text-[10px] text-zinc-700 ml-auto">
          {format(new Date(item.created_at), 'MMM d, HH:mm')}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{item.content}</p>
    </div>
  )
}

export default async function MentorPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const feedItems = await getMentorFeed(user.id, 50)

  const warnings = feedItems.filter((i) => i.severity === 'critical' || i.severity === 'warning')
  const others = feedItems.filter((i) => i.severity === 'info')

  return (
    <div className="min-h-screen bg-surface text-zinc-200 font-sans">
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/cockpit" className="font-mono text-sm font-bold tracking-widest text-white">
            NORTH
          </Link>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-600">
            Mentor Log
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cockpit" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Cockpit</Link>
          <Link href="/inbox" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Inbox</Link>
          <Link href="/goals" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Goals</Link>
          <Link href="/weekly" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Week</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        {feedItems.length === 0 && (
          <p className="text-sm text-zinc-700 font-mono">
            No mentor insights yet. Start using the cockpit daily to generate data.
          </p>
        )}

        {warnings.length > 0 && (
          <section>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
              Warnings & Patterns
            </p>
            <div className="space-y-0">
              {warnings.map((item) => <InsightCard key={item.id} item={item} />)}
            </div>
          </section>
        )}

        {others.length > 0 && (
          <section>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
              Insights & Questions
            </p>
            <div className="space-y-0">
              {others.map((item) => <InsightCard key={item.id} item={item} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
