import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type {
  User,
  AnnualGoal,
  WeeklyPlan,
  DailyLog,
  InboxItem,
  MentorFeedItem,
  UserContext,
} from '@/types'
import { startOfWeek, subDays, format } from 'date-fns'

function serverClient() {
  return createServerComponentClient({ cookies })
}

// ─────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────

export async function getUser(): Promise<User | null> {
  const supabase = serverClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()

  return data as User | null
}

// ─────────────────────────────────────────────
// GOALS
// ─────────────────────────────────────────────

export async function getAnnualGoals(userId: string): Promise<AnnualGoal[]> {
  const supabase = serverClient()
  const currentYear = new Date().getFullYear()

  const { data } = await supabase
    .from('annual_goals')
    .select('*')
    .eq('user_id', userId)
    .eq('year', currentYear)
    .order('domain')

  return (data as AnnualGoal[]) ?? []
}

export async function updateGoalProgress(
  goalId: string,
  progress: number
): Promise<void> {
  const supabase = serverClient()
  await supabase
    .from('annual_goals')
    .update({ current_progress: progress })
    .eq('id', goalId)
}

// ─────────────────────────────────────────────
// WEEKLY PLANS
// ─────────────────────────────────────────────

export async function getCurrentWeekPlan(userId: string): Promise<WeeklyPlan | null> {
  const supabase = serverClient()
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single()

  return (data as WeeklyPlan) ?? null
}

// ─────────────────────────────────────────────
// DAILY LOGS
// ─────────────────────────────────────────────

export async function getTodayLog(userId: string): Promise<DailyLog | null> {
  const supabase = serverClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single()

  return (data as DailyLog) ?? null
}

export async function getRecentScores(userId: string, days = 7): Promise<number[]> {
  const supabase = serverClient()
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd')

  const { data } = await supabase
    .from('daily_logs')
    .select('score')
    .eq('user_id', userId)
    .gte('date', since)
    .not('score', 'is', null)
    .order('date', { ascending: false })

  return (data ?? []).map((d: { score: number }) => d.score)
}

export async function upsertDailyLog(
  userId: string,
  log: Partial<DailyLog>
): Promise<DailyLog | null> {
  const supabase = serverClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data } = await supabase
    .from('daily_logs')
    .upsert({ ...log, user_id: userId, date: today }, { onConflict: 'user_id,date' })
    .select()
    .single()

  return (data as DailyLog) ?? null
}

// ─────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────

export async function getInboxItems(
  userId: string,
  status?: string
): Promise<InboxItem[]> {
  const supabase = serverClient()

  let query = supabase
    .from('inbox')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data } = await query
  return (data as InboxItem[]) ?? []
}

export async function getUnreviewedCount(userId: string): Promise<number> {
  const supabase = serverClient()
  const { count } = await supabase
    .from('inbox')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'unreviewed')

  return count ?? 0
}

export async function insertInboxItem(
  userId: string,
  content: string
): Promise<InboxItem | null> {
  const supabase = serverClient()
  const { data } = await supabase
    .from('inbox')
    .insert({ user_id: userId, content, status: 'unreviewed' })
    .select()
    .single()

  return (data as InboxItem) ?? null
}

export async function updateInboxItem(
  itemId: string,
  updates: Partial<InboxItem>
): Promise<void> {
  const supabase = serverClient()
  await supabase.from('inbox').update(updates).eq('id', itemId)
}

// ─────────────────────────────────────────────
// MENTOR FEED
// ─────────────────────────────────────────────

export async function getMentorFeed(
  userId: string,
  limit = 20
): Promise<MentorFeedItem[]> {
  const supabase = serverClient()
  const { data } = await supabase
    .from('mentor_feed')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data as MentorFeedItem[]) ?? []
}

export async function getLatestMentorInsights(
  userId: string,
  limit = 2
): Promise<MentorFeedItem[]> {
  const supabase = serverClient()
  const { data } = await supabase
    .from('mentor_feed')
    .select('*')
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data as MentorFeedItem[]) ?? []
}

export async function insertMentorFeedItem(
  userId: string,
  item: Omit<MentorFeedItem, 'id' | 'user_id' | 'is_read' | 'created_at'>
): Promise<void> {
  const supabase = serverClient()
  await supabase.from('mentor_feed').insert({ ...item, user_id: userId })
}

export async function markFeedItemRead(itemId: string): Promise<void> {
  const supabase = serverClient()
  await supabase.from('mentor_feed').update({ is_read: true }).eq('id', itemId)
}

// ─────────────────────────────────────────────
// USER CONTEXT (composite — for AI calls)
// ─────────────────────────────────────────────

export async function buildUserContext(userId: string): Promise<UserContext | null> {
  const [user, goals, currentWeek, recentScores, unreviewedCount, totalInbox] =
    await Promise.all([
      getUser(),
      getAnnualGoals(userId),
      getCurrentWeekPlan(userId),
      getRecentScores(userId),
      getUnreviewedCount(userId),
      getInboxItems(userId).then((items) => items.length),
    ])

  if (!user) return null

  return {
    user,
    goals,
    current_week: currentWeek,
    recent_scores: recentScores,
    inbox_summary: {
      unreviewed: unreviewedCount,
      total: totalInbox,
    },
  }
}
