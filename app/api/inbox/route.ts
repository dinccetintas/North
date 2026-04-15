import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { insertInboxItem } from '@/lib/supabase/queries'

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { content } = await req.json()
    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const item = await insertInboxItem(user.id, content.trim())
    if (!item) {
      return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
    }

    // Trigger async AI analysis (fire and forget — don't await)
    fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/ai/analyze-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') ?? '' },
      body: JSON.stringify({ itemId: item.id, content: item.content }),
    }).catch(() => {
      // Analysis is best-effort; item is saved regardless
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    console.error('[inbox POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
