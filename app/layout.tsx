import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NORTH — Your Personal Operating System',
  description: 'Stay on course.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-surface text-zinc-200 font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
