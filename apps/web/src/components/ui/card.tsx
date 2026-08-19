import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'

/** Radius 12 px, weight in the border, shadow barely there (CLAUDE.md §4). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-border bg-surface shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  /** Sits before the title: an avatar, a status dot — whatever identifies it. */
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 p-6 pb-0', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />
}
