import { CalendarView } from '../features/calendar/calendar-view'
import { OfflineBanner } from '../features/pwa/offline-banner'

/**
 * The teacher's own timetable, in the four views the product asks for — and
 * the one screen that still answers with no network, from the copy the service
 * worker keeps.
 */
export function CalendarPage() {
  return (
    <div className="space-y-4">
      <OfflineBanner scope="calendar" />
      <CalendarView />
    </div>
  )
}
