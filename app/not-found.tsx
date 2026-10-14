import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="border-l-2 border-zinc-700 pl-4 py-1">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-600 mb-1">404</p>
          <p className="text-sm text-zinc-300">Page not found.</p>
        </div>
        <Link
          href="/cockpit"
          className="inline-block font-mono text-xs uppercase tracking-wider px-4 py-2 border border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white transition-colors"
        >
          ← Back to cockpit
        </Link>
      </div>
    </div>
  )
}
