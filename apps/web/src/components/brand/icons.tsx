/**
 * Icons this product draws itself.
 *
 * Everything else comes from lucide, and a one-off drawn by hand needs a
 * reason. This one has it: the planner is a calendar with a class placed on
 * it, and no icon in the set says that — the calendars all say "dates", which
 * is the screen next door.
 *
 * Drawn on lucide's own terms — a 24 × 24 box, no fill, `currentColor`, round
 * caps and joins — so it sits in a row of them without looking borrowed, and
 * takes its size from the class the caller gives it like the rest.
 */
import type { SVGProps } from 'react'

export function CalendarDot(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12.5 21h-6.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v5" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M4 11h16" />
      <path d="M16 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    </svg>
  )
}
