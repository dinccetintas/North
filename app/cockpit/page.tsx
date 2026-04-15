import { redirect } from 'next/navigation'
import { getUser, getAnnualGoals, getTodayLog, getLatestMentorInsights, getUnreviewedCount, getCurrentWeekPlan, getRecentScores } from '@/lib/supabase/queries'
import { CockpitClient } from './CockpitClient'

export const dynamic = 'force-dynamic'

export default async function CockpitPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [goals, todayLog, mentorItems, unreviewedCount, weekPlan, recentScores] =
    await Promise.all([
      getAnnualGoals(user.id),
      getTodayLog(user.id),
      getLatestMentorInsights(user.id, 2),
      getUnreviewedCount(user.id),
      getCurrentWeekPlan(user.id),
      getRecentScores(user.id, 7),
    ])

  // Detect recovery mode: 2+ missed days (score < 40 or null for 2 consecutive days)
  const missedDays = recentScores.filter((s) => s < 40).length
  const inRecovery = todayLog?.recovery_mode || missedDays >= 2

  return (
    <CockpitClient
      user={user}
      goals={goals}
      todayLog={todayLog}
      mentorItems={mentorItems}
      unreviewedCount={unreviewedCount}
      weekPlan={weekPlan}
      inRecovery={inRecovery}
    />
  )
}
