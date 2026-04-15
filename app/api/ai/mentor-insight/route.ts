import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { generateMentorInsight } from '@/lib/ai/mentor'
import { buildUserContext, insertMentorFeedItem } from '@/lib/supabase/queries'

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { trigger } = await req.json()
    if (!trigger) {
      return NextResponse.json({ error: 'Missing trigger' }, { status: 400 })
    }

    const ctx = await buildUserContext(user.id)
    if (!ctx) return NextResponse.json({ error: 'User context not found' }, { status: 404 })

    const insight = await generateMentorInsight(ctx, trigger)

    await insertMentorFeedItem(user.id, {
      type: insight.type,
      content: insight.content,
      severity: insight.severity,
      related_domain: insight.related_domain,
    })

    return NextResponse.json({ insight })
  } catch (err) {
    console.error('[mentor-insight]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
