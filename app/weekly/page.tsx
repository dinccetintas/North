import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { getUser, getCurrentWeekPlan, getInboxItems } from '@/lib/supabase/queries'
import { WeeklyClient } from './WeeklyClient'

export const dynamic = 'force-dynamic'

export default async function WeeklyPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })

  const [weekPlan, unreviewedItems] = await Promise.all([
    getCurrentWeekPlan(user.id),
    getInboxItems(user.id, 'unreviewed'),
  ])

  return (
    <div className="min-h-screen bg-surface text-zinc-200 font-sans">
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/cockpit" className="font-mono text-sm font-bold tracking-widest text-white">
            NORTH
          </Link>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-600">
            Week of {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cockpit" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Cockpit</Link>
          <Link href="/inbox" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Inbox</Link>
          <Link href="/goals" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Goals</Link>
          <Link href="/mentor" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Mentor</Link>
        </div>
      </header>

      <WeeklyClient
        weekPlan={weekPlan}
        unreviewedItems={unreviewedItems}
        weekStart={format(weekStart, 'yyyy-MM-dd')}
      />
    </div>
  )
}
