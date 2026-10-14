'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ backgroundColor: '#0a0a0a', color: '#e4e4e7', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ maxWidth: 400, padding: '0 24px' }}>
          <div style={{ borderLeft: '2px solid #ef4444', paddingLeft: 16, paddingTop: 4, paddingBottom: 4, marginBottom: 16 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ef4444', marginBottom: 4 }}>Critical Error</p>
            <p style={{ fontSize: 14, color: '#d4d4d8' }}>{error.message || 'Something went wrong.'}</p>
          </div>
          <button
            onClick={reset}
            style={{ fontFamily: 'monospace', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '8px 16px', border: '1px solid #52525b', color: '#d4d4d8', background: 'transparent', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
