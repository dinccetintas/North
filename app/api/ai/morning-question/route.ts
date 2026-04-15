import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { generateMorningQuestion } from '@/lib/ai/mentor'
import { buildUserContext, insertMentorFeedItem } from '@/lib/supabase/queries'

export async function POST() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ctx = await buildUserContext(user.id)
    if (!ctx) return NextResponse.json({ error: 'User context not found' }, { status: 404 })

    const result = await generateMorningQuestion(ctx)

    await insertMentorFeedItem(user.id, {
      type: 'question',
      content: result.question,
      severity: 'info',
      related_domain: null,
    })

    return NextResponse.json({ question: result.question })
  } catch (err) {
    console.error('[morning-question]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
