/**
 * The count beside a menu entry: white on red, in a circle.
 *
 * Hidden from assistive technology on purpose. The number alone says nothing
 * aloud — "3" beside "Class changes" is not a sentence — so the entry that
 * uses this puts the words next to the name instead.
 */
import { cn } from '../../lib/cn'

export function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null

  return (
    <span
      aria-hidden="true"
      className={cn(
        'tabular inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold leading-5 text-white',
        className,
      )}
    >
      {/* A three-digit badge is a badge that breaks the row it sits in. */}
      {count > 99 ? '99+' : count}
    </span>
  )
}
