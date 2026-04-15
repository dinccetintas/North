// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export type Domain =
  | 'ventures'
  | 'career'
  | 'wealth'
  | 'body'
  | 'mind'
  | 'unknown'

export type InboxItemType =
  | 'idea'
  | 'task'
  | 'article'
  | 'investment'
  | 'reading'
  | 'other'

export type InboxStatus =
  | 'unreviewed'
  | 'triaged'
  | 'scheduled'
  | 'archived'
  | 'done'

export type AIRecommendation = 'do_this_week' | 'queue' | 'archive'

export type MentorFeedType =
  | 'pattern'
  | 'warning'
  | 'insight'
  | 'question'
  | 'weekly_debrief'

export type Severity = 'info' | 'warning' | 'critical'

// ─────────────────────────────────────────────
// DATABASE TYPES
// ─────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string | null
  identity_statement: string | null
  created_at: string
}

export interface AnnualGoal {
  id: string
  user_id: string
  domain: Domain
  title: string
  target_metric: string
  target_date: string
  current_progress: number
  year: number
  created_at: string
  updated_at: string
}

export interface WeeklyPlan {
  id: string
  user_id: string
  week_start: string
  capacity: number
  domain_targets: Record<string, string>
  mentor_note: string | null
  created_at: string
}

export interface DailyPriority {
  domain: Domain
  task: string
  source_item_id: string | null
}

export interface CompletionEntry {
  item_id: string
  status: 'done' | 'partial' | 'skipped'
}

export interface DailyLog {
  id: string
  user_id: string
  date: string
  top_3: DailyPriority[]
  morning_question: string | null
  completed: CompletionEntry[]
  evening_note: string | null
  score: number | null
  recovery_mode: boolean
  created_at: string
  updated_at: string
}

export interface InboxItem {
  id: string
  user_id: string
  content: string
  type: InboxItemType
  source_domain: Domain
  alignment_score: number | null
  alignment_reasoning: string | null
  ai_recommendation: AIRecommendation | null
  ai_recommendation_reason: string | null
  estimated_time_minutes: number | null
  conflicts_with: string | null
  status: InboxStatus
  scheduled_week: string | null
  created_at: string
  updated_at: string
}

export interface MentorFeedItem {
  id: string
  user_id: string
  type: MentorFeedType
  content: string
  severity: Severity
  related_domain: Domain | null
  is_read: boolean
  created_at: string
}

// ─────────────────────────────────────────────
// AI RESPONSE TYPES
// ─────────────────────────────────────────────

export interface InboxAnalysis {
  alignment_score: number
  alignment_reasoning: string
  ai_recommendation: AIRecommendation
  ai_recommendation_reason: string
  estimated_time_minutes: number
  conflicts_with: string | null
  source_domain: Domain
  type: InboxItemType
}

export interface MorningQuestion {
  question: string
}

export interface MentorInsight {
  type: MentorFeedType
  content: string
  severity: Severity
  related_domain: Domain | null
}

export interface WeeklyDebrief {
  domain_scores: Record<Domain, number>
  pattern_observed: string
  recommendation: string
  carry_forward_items: string[]
  mentor_note: string
}

// ─────────────────────────────────────────────
// UI HELPER TYPES
// ─────────────────────────────────────────────

export interface UserContext {
  user: User
  goals: AnnualGoal[]
  current_week: WeeklyPlan | null
  recent_scores: number[]
  inbox_summary: {
    unreviewed: number
    total: number
  }
}

export type DomainColor = {
  label: string
  text: string
  bg: string
  border: string
  badge: string
}

export const DOMAIN_STYLES: Record<Domain, DomainColor> = {
  ventures: {
    label: 'Ventures',
    text: 'text-ventures',
    bg: 'bg-ventures-bg',
    border: 'border-ventures-dim',
    badge: 'bg-ventures-dim text-ventures',
  },
  career: {
    label: 'Career',
    text: 'text-career',
    bg: 'bg-career-bg',
    border: 'border-career-dim',
    badge: 'bg-career-dim text-career',
  },
  wealth: {
    label: 'Wealth',
    text: 'text-wealth',
    bg: 'bg-wealth-bg',
    border: 'border-wealth-dim',
    badge: 'bg-wealth-dim text-wealth',
  },
  body: {
    label: 'Body',
    text: 'text-body',
    bg: 'bg-body-bg',
    border: 'border-body-dim',
    badge: 'bg-body-dim text-body',
  },
  mind: {
    label: 'Mind',
    text: 'text-mind',
    bg: 'bg-mind-bg',
    border: 'border-mind-dim',
    badge: 'bg-mind-dim text-mind',
  },
  unknown: {
    label: 'Unknown',
    text: 'text-zinc-400',
    bg: 'bg-zinc-900',
    border: 'border-zinc-700',
    badge: 'bg-zinc-800 text-zinc-400',
  },
}
