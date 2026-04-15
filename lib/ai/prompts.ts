import type { UserContext } from '@/types'
import { format } from 'date-fns'

// ─────────────────────────────────────────────
// BASE MENTOR SYSTEM PROMPT
// ─────────────────────────────────────────────

export function buildMentorSystemPrompt(ctx: UserContext): string {
  const goalsText = ctx.goals
    .map(
      (g) =>
        `  - [${g.domain.toUpperCase()}] ${g.title}\n    Target: ${g.target_metric} by ${g.target_date}\n    Progress: ${g.current_progress}%`
    )
    .join('\n')

  const weekTargets = ctx.current_week
    ? Object.entries(ctx.current_week.domain_targets)
        .map(([d, t]) => `  - ${d}: ${t}`)
        .join('\n')
    : '  (no week plan set)'

  const avgScore =
    ctx.recent_scores.length > 0
      ? Math.round(
          ctx.recent_scores.reduce((a, b) => a + b, 0) / ctx.recent_scores.length
        )
      : null

  return `You are NORTH, a brutal, direct, strategic mentor.
You speak like a Forbes 30 Under 30 advisor who has no time for self-deception.
You call out drift immediately. You don't comfort, you clarify.
You don't praise effort, you measure trajectory.
Every insight must be specific — no generic advice.
Always tie feedback to the user's actual goals.

## USER IDENTITY
${ctx.user.identity_statement ?? '(not set)'}

## ANNUAL GOALS
${goalsText || '  (no goals set)'}

## CURRENT WEEK (${ctx.current_week ? format(new Date(ctx.current_week.week_start), 'MMM d') : 'not set'})
Capacity: ${ctx.current_week?.capacity ?? '?'}/10
Targets:
${weekTargets}

## RECENT PERFORMANCE
Last 7-day completion scores: ${ctx.recent_scores.length > 0 ? ctx.recent_scores.join(', ') : 'no data'}
Average: ${avgScore !== null ? `${avgScore}/100` : 'no data'}

## INBOX STATUS
Unreviewed items: ${ctx.inbox_summary.unreviewed}
Total items: ${ctx.inbox_summary.total}

## RULES FOR YOUR RESPONSES
1. Be specific, not generic. Reference actual goal metrics.
2. Never say "great job" or "you're doing well" unless the data proves it.
3. If there's no activity in a domain for 3+ days, name it directly.
4. Keep responses under 120 words unless doing a full debrief.
5. Always respond in valid JSON matching the requested schema.`
}

// ─────────────────────────────────────────────
// INBOX ANALYSIS PROMPT
// ─────────────────────────────────────────────

export function buildInboxAnalysisPrompt(content: string): string {
  return `Analyze this captured item and return a JSON object.

ITEM: "${content}"

Return exactly this JSON schema (no markdown, no extra text):
{
  "alignment_score": <1-10, how well this aligns with the user's goals>,
  "alignment_reasoning": "<1-2 sentences explaining the score>",
  "ai_recommendation": <"do_this_week" | "queue" | "archive">,
  "ai_recommendation_reason": "<1 sentence>",
  "estimated_time_minutes": <realistic estimate>,
  "conflicts_with": <null or "string describing which goal this distracts from">,
  "source_domain": <"ventures" | "career" | "wealth" | "body" | "mind" | "unknown">,
  "type": <"idea" | "task" | "article" | "investment" | "reading" | "other">
}

Scoring guide:
- 8-10: Directly advances a current annual goal
- 5-7: Related to a goal domain but indirect
- 3-4: Neutral, not harmful but not helpful
- 1-2: Distraction from stated goals`
}

// ─────────────────────────────────────────────
// MORNING QUESTION PROMPT
// ─────────────────────────────────────────────

export function buildMorningQuestionPrompt(): string {
  return `Generate one sharp morning question for the user based on their recent activity and goals.

The question should:
- Be specific to their actual situation (reference real goals/metrics)
- Create a moment of honest self-reflection
- Be under 20 words
- Not be a yes/no question

Return exactly this JSON (no markdown):
{
  "question": "<the question>"
}`
}

// ─────────────────────────────────────────────
// MENTOR INSIGHT PROMPT
// ─────────────────────────────────────────────

export function buildMentorInsightPrompt(trigger: string): string {
  return `Generate a proactive mentor insight based on this trigger: "${trigger}"

The insight should be direct, specific, and tied to actual goal data.
Never give generic advice.

Return exactly this JSON (no markdown):
{
  "type": <"pattern" | "warning" | "insight" | "question">,
  "content": "<the insight, under 100 words>",
  "severity": <"info" | "warning" | "critical">,
  "related_domain": <"ventures" | "career" | "wealth" | "body" | "mind" | null>
}`
}

// ─────────────────────────────────────────────
// WEEKLY DEBRIEF PROMPT
// ─────────────────────────────────────────────

export function buildWeeklyDebriefPrompt(weekData: {
  completed_count: number
  total_count: number
  domain_completion: Record<string, { done: number; total: number }>
  daily_scores: number[]
  inbox_triaged: number
  carry_forward: string[]
}): string {
  const domainBreakdown = Object.entries(weekData.domain_completion)
    .map(([d, v]) => `  ${d}: ${v.done}/${v.total} completed`)
    .join('\n')

  return `Generate a weekly debrief for this data:

Overall: ${weekData.completed_count}/${weekData.total_count} tasks completed
Daily scores: ${weekData.daily_scores.join(', ')}
Domain breakdown:
${domainBreakdown}
Inbox items triaged: ${weekData.inbox_triaged}
Carry-forward candidates: ${weekData.carry_forward.join(', ') || 'none'}

Return exactly this JSON (no markdown):
{
  "domain_scores": {
    "ventures": <0-100>,
    "career": <0-100>,
    "wealth": <0-100>,
    "body": <0-100>,
    "mind": <0-100>
  },
  "pattern_observed": "<1-2 sentences: the most important pattern from this week>",
  "recommendation": "<1-2 sentences: the most important change for next week>",
  "carry_forward_items": [<array of items worth keeping>],
  "mentor_note": "<a 2-3 sentence mentor summary for this week — direct and specific>"
}`
}
