'use client'

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createBrowserClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || loading) return

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/cockpit`,
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <h1 className="font-mono text-2xl font-bold tracking-widest text-white">
            NORTH
          </h1>
          <p className="font-mono text-xs text-zinc-600 uppercase tracking-wider">
            Stay on course.
          </p>
        </div>

        {sent ? (
          <div className="border border-wealth-dim bg-wealth-bg p-5 space-y-2">
            <p className="font-mono text-xs uppercase tracking-widest text-wealth">
              Link sent
            </p>
            <p className="text-sm text-zinc-300">
              Check <span className="text-zinc-100">{email}</span> for a magic link.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                className={cn(
                  'w-full bg-surface-raised border border-surface-border text-sm text-zinc-200',
                  'placeholder-zinc-700 px-3 py-2.5 outline-none',
                  'focus:border-zinc-500 transition-colors'
                )}
              />
            </div>

            {error && (
              <p className="font-mono text-xs text-critical">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className={cn(
                'w-full font-mono text-xs uppercase tracking-widest py-2.5 border',
                'transition-colors',
                'border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white',
                'disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              {loading ? 'Sending...' : 'Send magic link →'}
            </button>
          </form>
        )}

        <p className="text-center font-mono text-[10px] text-zinc-800">
          Personal access only.
        </p>
      </div>
    </div>
  )
}
