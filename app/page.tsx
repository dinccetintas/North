import { redirect } from 'next/navigation'

// Root redirects to cockpit
export default function RootPage() {
  redirect('/cockpit')
}
