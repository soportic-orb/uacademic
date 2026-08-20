import { formatDate } from '@uacademic/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { currentLocale } from '../../i18n'
import { addDays, mondayOf } from './week-dates'

/**
 * Moving through the year, one week at a time.
 *
 * The grid stays a week — a timetable repeats weekly, and a month laid out as
 * a month has no room for an hour axis — but which week it is now matters:
 * teaching runs from one date to another, some weeks are holidays, and a
 * coordinator planning in February should not have to hold "which week is
 * this?" in their head.
 */
export function WeekNavigator({
  weekStart,
  onChange,
}: {
  weekStart: Date
  onChange: (weekStart: Date) => void
}) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const weekEnd = addDays(weekStart, 6)

  // "3 – 9 de març de 2027", or the two months when the week straddles them.
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
  const label = sameMonth
    ? formatDate(locale, weekStart, { month: 'long', year: 'numeric' })
    : `${formatDate(locale, weekStart, { month: 'short' })} – ${formatDate(locale, weekEnd, {
        month: 'short',
        year: 'numeric',
      })}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('planner.week.previous')}
        onClick={() => onChange(addDays(weekStart, -7))}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>

      <span className="min-w-40 text-center text-sm font-medium text-text">{label}</span>

      <Button
        variant="ghost"
        size="icon"
        aria-label={t('planner.week.next')}
        onClick={() => onChange(addDays(weekStart, 7))}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>

      <Button variant="secondary" onClick={() => onChange(mondayOf(new Date()))}>
        {t('planner.week.today')}
      </Button>
    </div>
  )
}
