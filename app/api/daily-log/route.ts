import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { format } from 'date-fns'

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const updates = await req.json()
    const today = format(new Date(), 'yyyy-MM-dd')

    const { data, error } = await supabase
      .from('daily_logs')
      .upsert(
        { ...updates, user_id: user.id, date: today },
        { onConflict: 'user_id,date' }
      )
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ log: data })
  } catch (err) {
    console.error('[daily-log PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
