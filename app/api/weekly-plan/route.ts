import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { week_start, capacity, domain_targets } = await req.json()

    const { data, error } = await supabase
      .from('weekly_plans')
      .upsert(
        { user_id: user.id, week_start, capacity, domain_targets },
        { onConflict: 'user_id,week_start' }
      )
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ plan: data })
  } catch (err) {
    console.error('[weekly-plan POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
