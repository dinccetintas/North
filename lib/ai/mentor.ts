import Anthropic from '@anthropic-ai/sdk'
import type {
  UserContext,
  InboxAnalysis,
  MorningQuestion,
  MentorInsight,
  WeeklyDebrief,
} from '@/types'
import {
  buildMentorSystemPrompt,
  buildInboxAnalysisPrompt,
  buildMorningQuestionPrompt,
  buildMentorInsightPrompt,
  buildWeeklyDebriefPrompt,
} from './prompts'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const MODEL = 'claude-sonnet-4-6'

function parseJSON<T>(raw: string): T {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  return JSON.parse(cleaned) as T
}

// ─────────────────────────────────────────────
// analyzeInboxItem
// ─────────────────────────────────────────────

export async function analyzeInboxItem(
  content: string,
  ctx: UserContext
): Promise<InboxAnalysis> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: buildMentorSystemPrompt(ctx),
    messages: [
      {
        role: 'user',
        content: buildInboxAnalysisPrompt(content),
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseJSON<InboxAnalysis>(text)
}

// ─────────────────────────────────────────────
// generateMorningQuestion
// ─────────────────────────────────────────────

export async function generateMorningQuestion(
  ctx: UserContext
): Promise<MorningQuestion> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 128,
    system: buildMentorSystemPrompt(ctx),
    messages: [
      {
        role: 'user',
        content: buildMorningQuestionPrompt(),
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseJSON<MorningQuestion>(text)
}

// ─────────────────────────────────────────────
// generateMentorInsight
// ─────────────────────────────────────────────

export async function generateMentorInsight(
  ctx: UserContext,
  trigger: string
): Promise<MentorInsight> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: buildMentorSystemPrompt(ctx),
    messages: [
      {
        role: 'user',
        content: buildMentorInsightPrompt(trigger),
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseJSON<MentorInsight>(text)
}

// ─────────────────────────────────────────────
// generateWeeklyDebrief
// ─────────────────────────────────────────────

export async function generateWeeklyDebrief(
  ctx: UserContext,
  weekData: Parameters<typeof buildWeeklyDebriefPrompt>[0]
): Promise<WeeklyDebrief> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildMentorSystemPrompt(ctx),
    messages: [
      {
        role: 'user',
        content: buildWeeklyDebriefPrompt(weekData),
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseJSON<WeeklyDebrief>(text)
}
