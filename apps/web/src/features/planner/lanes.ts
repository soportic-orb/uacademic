/**
 * Where each class sits when several share an hour.
 *
 * Three groups can meet on Wednesday at eleven — that is what having three
 * groups means — so a cell of the grid holds a class, not *the* class. Each
 * one gets a share of the width: the lane it is in, out of the lanes that hour
 * needs. The arithmetic is here, with tests, because a class drawn on top of
 * another is a class somebody cannot see or click.
 *
 * Lanes are assigned in the order the classes start, and a class keeps its
 * lane for as long as it runs. A class that starts after another has finished
 * reuses the lane it left, so a day with one class at nine and one at eleven
 * is drawn full width twice rather than in two thin columns.
 */

export interface LaidOutSession {
  id: string
  weekday: number
  startTime: string
  endTime: string
}

export interface Lane {
  /** Which share of the width, counting from the left. */
  lane: number
  /** How many shares the hour is divided into. */
  lanes: number
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

function overlaps(a: LaidOutSession, b: LaidOutSession): boolean {
  return (
    a.weekday === b.weekday &&
    minutes(a.startTime) < minutes(b.endTime) &&
    minutes(b.startTime) < minutes(a.endTime)
  )
}

/**
 * The lane of every class of one week, by session id.
 *
 * Classes that overlap each other — directly or through a third one, as in
 * nine-to-eleven, ten-to-twelve, eleven-to-one — are one group, and the whole
 * group is divided into the same number of lanes so nothing shifts sideways
 * halfway down.
 */
export function laneLayout(sessions: readonly LaidOutSession[]): Map<string, Lane> {
  const layout = new Map<string, Lane>()

  const byDay = new Map<number, LaidOutSession[]>()
  for (const session of sessions) {
    const day = byDay.get(session.weekday)
    if (day) day.push(session)
    else byDay.set(session.weekday, [session])
  }

  for (const day of byDay.values()) {
    const ordered = [...day].sort(
      (a, b) => minutes(a.startTime) - minutes(b.startTime) || a.id.localeCompare(b.id),
    )

    let cluster: LaidOutSession[] = []
    const flush = () => {
      if (cluster.length === 0) return
      const lanes: LaidOutSession[][] = []

      for (const session of cluster) {
        // The first lane whose last class has finished by the time this one
        // starts. Failing that, a new lane.
        const free = lanes.findIndex((entry) => !entry.some((other) => overlaps(other, session)))
        const index = free === -1 ? lanes.length : free
        ;(lanes[index] ??= []).push(session)
        layout.set(session.id, { lane: index, lanes: 0 })
      }

      for (const session of cluster) {
        const current = layout.get(session.id)
        if (current) layout.set(session.id, { ...current, lanes: lanes.length })
      }

      cluster = []
    }

    let clusterEnd = 0
    for (const session of ordered) {
      // A class that starts after everything so far has finished begins a new
      // group: it shares its hour with nothing before it.
      if (cluster.length > 0 && minutes(session.startTime) >= clusterEnd) flush()

      cluster.push(session)
      clusterEnd = Math.max(clusterEnd, minutes(session.endTime))
    }
    flush()
  }

  return layout
}
