import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { analyzeInboxItem } from '@/lib/ai/mentor'
import { buildUserContext, updateInboxItem } from '@/lib/supabase/queries'

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { itemId, content } = await req.json()
    if (!itemId || !content) {
      return NextResponse.json({ error: 'Missing itemId or content' }, { status: 400 })
    }

    const ctx = await buildUserContext(user.id)
    if (!ctx) return NextResponse.json({ error: 'User context not found' }, { status: 404 })

    const analysis = await analyzeInboxItem(content, ctx)

    await updateInboxItem(itemId, {
      alignment_score: analysis.alignment_score,
      alignment_reasoning: analysis.alignment_reasoning,
      ai_recommendation: analysis.ai_recommendation,
      ai_recommendation_reason: analysis.ai_recommendation_reason,
      estimated_time_minutes: analysis.estimated_time_minutes,
      conflicts_with: analysis.conflicts_with ?? undefined,
      source_domain: analysis.source_domain,
      type: analysis.type,
      status: 'triaged',
    })

    return NextResponse.json({ success: true, analysis })
  } catch (err) {
    console.error('[analyze-inbox]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
