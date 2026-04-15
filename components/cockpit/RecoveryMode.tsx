interface RecoveryModeProps {
  singleTask: string | null
}

export function RecoveryMode({ singleTask }: RecoveryModeProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="border-l-2 border-critical pl-4 py-1">
        <p className="font-mono text-xs uppercase tracking-widest text-critical mb-1">
          Recovery Mode
        </p>
        <p className="text-sm text-zinc-300">
          You drifted. That&apos;s normal. Here&apos;s your one task today.
        </p>
      </div>

      {singleTask && (
        <div className="border border-surface-border bg-surface-raised p-4">
          <p className="text-sm text-zinc-200">{singleTask}</p>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        One task. That&apos;s it. Complete it, then come back tomorrow.
      </p>
    </div>
  )
}
