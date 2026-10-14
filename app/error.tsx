'use client'

import { useEffect } from 'react'

export default function Error({
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
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="border-l-2 border-critical pl-4 py-1">
          <p className="font-mono text-xs uppercase tracking-widest text-critical mb-1">Error</p>
          <p className="text-sm text-zinc-300">{error.message || 'Something went wrong.'}</p>
        </div>
        <button
          onClick={reset}
          className="font-mono text-xs uppercase tracking-wider px-4 py-2 border border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
