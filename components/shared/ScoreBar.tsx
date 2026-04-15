import { cn } from '@/lib/utils/cn'

interface ScoreBarProps {
  score: number
  className?: string
  showLabel?: boolean
}

function scoreColor(score: number) {
  if (score >= 80) return 'bg-wealth'
  if (score >= 50) return 'bg-ventures'
  return 'bg-body'
}

export function ScoreBar({ score, className, showLabel = false }: ScoreBarProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', scoreColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
      {showLabel && (
        <span className="font-mono text-xs text-zinc-400 tabular-nums">{score}</span>
      )}
    </div>
  )
}
