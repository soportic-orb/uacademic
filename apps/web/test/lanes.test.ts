/**
 * Where each class sits when several share an hour. A class drawn on top of
 * another is a class somebody cannot see or click, so this is worth pinning
 * down away from the grid that uses it.
 */
import { describe, expect, it } from 'vitest'

import { laneLayout } from '../src/features/planner/lanes'

const at = (id: string, startTime: string, endTime: string, weekday = 3) => ({
  id,
  weekday,
  startTime,
  endTime,
})

describe('sharing an hour', () => {
  it('gives a class on its own the whole width', () => {
    expect(laneLayout([at('a', '11:00', '13:00')]).get('a')).toEqual({ lane: 0, lanes: 1 })
  })

  it('divides the hour between the groups that share it', () => {
    const layout = laneLayout([
      at('a', '11:00', '13:00'),
      at('b', '11:00', '13:00'),
      at('c', '11:00', '13:00'),
    ])

    expect(layout.get('a')).toEqual({ lane: 0, lanes: 3 })
    expect(layout.get('b')).toEqual({ lane: 1, lanes: 3 })
    expect(layout.get('c')).toEqual({ lane: 2, lanes: 3 })
  })

  it('keeps the same number of lanes through a chain of overlaps', () => {
    // Nine to eleven, ten to twelve, eleven to one: the first and the last do
    // not meet, but the middle one meets both, so the three share the width
    // rather than shifting sideways halfway down the morning.
    const layout = laneLayout([
      at('a', '09:00', '11:00'),
      at('b', '10:00', '12:00'),
      at('c', '11:00', '13:00'),
    ])

    expect(layout.get('a')?.lanes).toBe(2)
    expect(layout.get('b')?.lanes).toBe(2)
    // The first lane is free again by eleven, so the third class reuses it.
    expect(layout.get('c')).toEqual({ lane: 0, lanes: 2 })
  })

  it('gives the width back once the hour is over', () => {
    const layout = laneLayout([
      at('a', '09:00', '10:00'),
      at('b', '09:00', '10:00'),
      at('c', '11:00', '12:00'),
    ])

    expect(layout.get('a')?.lanes).toBe(2)
    // Nothing else at eleven: the whole column.
    expect(layout.get('c')).toEqual({ lane: 0, lanes: 1 })
  })

  it('keeps the days apart', () => {
    const layout = laneLayout([at('a', '11:00', '12:00', 1), at('b', '11:00', '12:00', 2)])

    expect(layout.get('a')).toEqual({ lane: 0, lanes: 1 })
    expect(layout.get('b')).toEqual({ lane: 0, lanes: 1 })
  })
})
