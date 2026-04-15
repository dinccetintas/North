import { redirect } from 'next/navigation'
import { getUser, getInboxItems } from '@/lib/supabase/queries'
import { InboxClient } from './InboxClient'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const items = await getInboxItems(user.id)

  return <InboxClient initialItems={items} />
}
