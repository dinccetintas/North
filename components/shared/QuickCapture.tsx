'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface QuickCaptureProps {
  onCapture?: (content: string) => void
  placeholder?: string
  className?: string
}

export function QuickCapture({
  onCapture,
  placeholder = 'Capture a thought...',
  className,
}: QuickCaptureProps) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [flash, setFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || loading) return

    setLoading(true)
    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      })

      if (res.ok) {
        setValue('')
        setFlash(true)
        setTimeout(() => setFlash(false), 600)
        onCapture?.(trimmed)
      }
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex items-center gap-2 border border-surface-border bg-surface-raised px-3 py-2 transition-colors',
        flash && 'border-wealth-dim',
        className
      )}
    >
      <span className="text-zinc-600 font-mono text-xs select-none">→</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={loading}
        className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none font-sans"
      />
      {loading && (
        <span className="text-zinc-600 font-mono text-xs animate-pulse">saving</span>
      )}
    </form>
  )
}
