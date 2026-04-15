import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { generateWeeklyDebrief } from '@/lib/ai/mentor'
import { buildUserContext, insertMentorFeedItem } from '@/lib/supabase/queries'

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const weekData = await req.json()

    const ctx = await buildUserContext(user.id)
    if (!ctx) return NextResponse.json({ error: 'User context not found' }, { status: 404 })

    const debrief = await generateWeeklyDebrief(ctx, weekData)

    await insertMentorFeedItem(user.id, {
      type: 'weekly_debrief',
      content: debrief.mentor_note,
      severity: 'info',
      related_domain: null,
    })

    return NextResponse.json({ debrief })
  } catch (err) {
    console.error('[weekly-debrief]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
