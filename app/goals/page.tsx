import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser, getAnnualGoals } from '@/lib/supabase/queries'
import { DomainBadge } from '@/components/shared/DomainBadge'
import { ScoreBar } from '@/components/shared/ScoreBar'
import { DOMAIN_STYLES } from '@/types'

export const dynamic = 'force-dynamic'

export default async function GoalsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const goals = await getAnnualGoals(user.id)
  const currentYear = new Date().getFullYear()

  return (
    <div className="min-h-screen bg-surface text-zinc-200 font-sans">
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/cockpit" className="font-mono text-sm font-bold tracking-widest text-white">
            NORTH
          </Link>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-600">
            Goals {currentYear}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cockpit" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Cockpit</Link>
          <Link href="/inbox" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Inbox</Link>
          <Link href="/weekly" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Week</Link>
          <Link href="/mentor" className="font-mono text-xs text-zinc-600 hover:text-zinc-400">Mentor</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        {/* Identity statement */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-3">
            Identity
          </p>
          <blockquote className="border-l-2 border-zinc-600 pl-4 py-1">
            <p className="text-zinc-300 text-base leading-relaxed italic">
              {user.identity_statement ?? (
                <span className="text-zinc-700">
                  No identity statement set. Add one via Supabase or the profile editor.
                </span>
              )}
            </p>
          </blockquote>
        </section>

        {/* Goals */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
            Annual Goals
          </p>

          {goals.length === 0 ? (
            <div className="border border-surface-border p-6 text-sm text-zinc-600">
              No goals set for {currentYear}. Add them via the Supabase dashboard or a future settings editor.
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => {
                const style = DOMAIN_STYLES[goal.domain]
                return (
                  <div
                    key={goal.id}
                    className={`border p-5 space-y-3 ${style.border} ${style.bg}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <DomainBadge domain={goal.domain} size="md" />
                        </div>
                        <h2 className="text-sm font-medium text-zinc-100">{goal.title}</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Target: {goal.target_metric}
                        </p>
                      </div>
                      <span className={`font-mono text-2xl font-bold tabular-nums ${style.text}`}>
                        {goal.current_progress}%
                      </span>
                    </div>

                    <div>
                      <ScoreBar score={goal.current_progress} showLabel={false} />
                      <p className="font-mono text-[10px] text-zinc-700 mt-1">
                        Target date: {goal.target_date}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
