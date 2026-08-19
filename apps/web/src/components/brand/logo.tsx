import { cn } from '../../lib/cn'

/**
 * The UAcademic lockup: the cap, the mark, and the word.
 *
 * The mark is an SVG so it stays sharp at any size and takes its colour from
 * the design tokens — the corporate blue lightens in dark mode along with
 * everything else, which an exported bitmap never would. The word is HTML
 * rather than SVG text on purpose: type inside an SVG is laid out with
 * whatever font happens to be available, so a viewBox that fits on one machine
 * clips the last letter on another.
 *
 * Size comes from the font size, so one class scales the whole lockup and its
 * proportions cannot drift: `<Logo className="text-2xl" />`.
 */
export function Logo({
  variant = 'full',
  className,
  title,
}: {
  variant?: 'mark' | 'full'
  className?: string
  /** Given where the logo is the only naming of the application (R8). */
  title?: string
}) {
  const labelled = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true }

  const mark = (
    <svg viewBox="0 0 40 40" className="h-[1.35em] w-[1.35em] shrink-0" fill="none">
      <rect width="40" height="40" rx="10" className="fill-primary" />
      <path
        d="M13 11v11.2a7 7 0 0 0 14 0V11"
        className="stroke-primary-contrast"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
    </svg>
  )

  if (variant === 'mark') {
    return (
      <span className={cn('inline-flex text-xl', className)} {...labelled}>
        {mark}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-2 text-xl', className)} {...labelled}>
      {/* The cap: a rhombus seen in perspective, its band, and the tassel. */}
      <svg viewBox="0 0 32 32" className="h-[1.2em] w-[1.2em] shrink-0" fill="none">
        <g
          className="stroke-primary"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M3 13.5 15.5 7 28 13.5 15.5 20z" />
          <path d="M8.6 16.4v6c0 2.1 3.1 3.6 6.9 3.6s6.9-1.5 6.9-3.6v-6" />
          <path d="M28 13.5v10.4" />
        </g>
      </svg>

      {mark}

      {/*
        The one literal in the application that must never be translated: it
        is the name, not text. The reader-facing name comes from `title`,
        which is a key like everything else (R1).
      */}
      {/* eslint-disable-next-line i18next/no-literal-string -- brand wordmark */}
      <span className="font-semibold tracking-tight text-primary">Academic</span>
    </span>
  )
}
