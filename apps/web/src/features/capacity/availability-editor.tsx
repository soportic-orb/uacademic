/**
 * Weekly availability editor.
 *
 * The grid is painted by dragging, and every drag has an exact keyboard
 * equivalent (R8): arrows move, Space paints, Shift+arrows paint a rectangle,
 * 1–4 pick the level. Both paths call the same pure helpers from
 * `@uacademic/shared`, so they cannot diverge — and neither of them decides
 * what a level means, which is the domain's job.
 */
import type {
  AvailabilityGrid,
  AvailabilityLevel,
  AvailabilityResponseDto,
  Weekday,
} from '@uacademic/shared'
import {
  AVAILABILITY_LEVELS,
  availabilityHoursByLevel,
  buildAvailabilityGrid,
  cellsInRectangle,
  formatHours,
  gridToEntries,
  paintCells,
} from '@uacademic/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useSaveAvailability } from './queries'

/** A symbol per level, so the grid never relies on color alone (R8). */
const LEVEL_SYMBOL: Record<AvailabilityLevel, string> = {
  preferred: '★',
  available: '●',
  avoid: '▲',
  unavailable: '×',
}

const LEVEL_STYLE: Record<AvailabilityLevel, string> = {
  preferred: 'bg-availability-preferred text-availability-preferred-text',
  available: 'bg-availability-available text-availability-available-text',
  avoid: 'bg-availability-avoid text-availability-avoid-text',
  unavailable: 'bg-availability-unavailable text-availability-unavailable-text',
}

interface Position {
  day: number
  slot: number
}

export function AvailabilityEditor({
  teacherId,
  data,
}: {
  teacherId: string
  data: AvailabilityResponseDto
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const save = useSaveAvailability(teacherId)

  const baseGrid = useMemo(
    () =>
      buildAvailabilityGrid(
        {
          dayStart: data.grid.dayStart,
          dayEnd: data.grid.dayEnd,
          slotMinutes: data.grid.slotMinutes,
          weekdays: data.grid.weekdays,
        },
        data.entries,
      ),
    [data],
  )

  const [grid, setGrid] = useState<AvailabilityGrid>(baseGrid)
  const [level, setLevel] = useState<AvailabilityLevel>('preferred')
  const [focus, setFocus] = useState<Position>({ day: 0, slot: 0 })
  const [dirty, setDirty] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  // A drag (or a shift-selection) paints from a snapshot, so shrinking the
  // rectangle un-paints what leaving it should not keep.
  const stroke = useRef<{ anchor: Position; base: AvailabilityGrid } | null>(null)
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    setGrid(baseGrid)
    setDirty(false)
  }, [baseGrid])

  useEffect(() => {
    const stop = () => {
      stroke.current = null
    }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const entries = useMemo(() => gridToEntries(grid), [grid])
  const hoursByLevel = availabilityHoursByLevel(entries)

  const cellAt = (position: Position) => grid.rows[position.day]?.cells[position.slot]

  const cellLabel = (weekday: Weekday, start: string, end: string, cellLevel: AvailabilityLevel) =>
    t('teachers.availability.cellLabel', {
      weekday: t(`weekday.${weekday}`),
      start,
      end,
      level: t(`availabilityLevel.${cellLevel}`),
    })

  const paint = (from: Position, to: Position, base: AvailabilityGrid) => {
    const origin = cellAt(from)
    const target = grid.rows[to.day]?.cells[to.slot]
    if (!origin || !target) return

    const cells = cellsInRectangle(
      base,
      { weekday: origin.weekday, start: origin.start },
      { weekday: target.weekday, start: target.start },
    )
    setGrid(paintCells(base, cells, level))
    setDirty(true)
    setAnnouncement(t('teachers.availability.painted', { count: cells.length }))
  }

  const startStroke = (position: Position) => {
    if (!data.editable) return
    const base = grid
    stroke.current = { anchor: position, base }
    paint(position, position, base)
  }

  const extendStroke = (position: Position) => {
    const current = stroke.current
    if (!current || !data.editable) return
    paint(current.anchor, position, current.base)
  }

  const focusCell = (position: Position) => {
    setFocus(position)
    cellRefs.current.get(`${position.day}|${position.slot}`)?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, position: Position) => {
    const lastDay = grid.rows.length - 1
    const lastSlot = grid.slots.length - 1

    const move = (day: number, slot: number) => {
      const next = {
        day: Math.min(Math.max(day, 0), lastDay),
        slot: Math.min(Math.max(slot, 0), lastSlot),
      }
      event.preventDefault()

      if (event.shiftKey && data.editable) {
        // Shift+arrow is the keyboard drag: the anchor is where the selection
        // started, exactly as the pointer anchor is where the drag started.
        stroke.current ??= { anchor: position, base: grid }
        focusCell(next)
        paint(stroke.current.anchor, next, stroke.current.base)
        return
      }

      stroke.current = null
      focusCell(next)
    }

    switch (event.key) {
      case 'ArrowRight':
        return move(position.day + 1, position.slot)
      case 'ArrowLeft':
        return move(position.day - 1, position.slot)
      case 'ArrowDown':
        return move(position.day, position.slot + 1)
      case 'ArrowUp':
        return move(position.day, position.slot - 1)
      case 'Home':
        return move(position.day, 0)
      case 'End':
        return move(position.day, lastSlot)
      case ' ':
      case 'Enter':
        event.preventDefault()
        if (data.editable) {
          stroke.current = null
          paint(position, position, grid)
        }
        return
      case '1':
      case '2':
      case '3':
      case '4': {
        const picked = AVAILABILITY_LEVELS[Number(event.key) - 1]
        if (picked) {
          event.preventDefault()
          setLevel(picked)
          setAnnouncement(t(`availabilityLevel.${picked}`))
        }
        return
      }
      default:
    }
  }

  const submit = () => {
    save.mutate(
      { entries: gridToEntries(grid) },
      {
        onSuccess: () => {
          setDirty(false)
          toast.success('teachers.availability.saved')
        },
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('teachers.availability.title')}
        description={
          data.editable ? t('teachers.availability.subtitle') : t('teachers.availability.readOnly')
        }
        action={
          data.editable ? (
            <div className="flex items-center gap-2">
              {dirty ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGrid(baseGrid)
                    setDirty(false)
                  }}
                >
                  {t('common.discard')}
                </Button>
              ) : null}
              <Button onClick={submit} disabled={!dirty || save.isPending}>
                {t('teachers.availability.save')}
              </Button>
            </div>
          ) : null
        }
      />

      <CardBody className="space-y-4">
        {data.editable ? (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-sm font-medium text-text">
              {t('teachers.availability.paintWith')}
            </legend>
            {AVAILABILITY_LEVELS.map((option) => (
              <label
                key={option}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm',
                  LEVEL_STYLE[option],
                  level === option ? 'border-primary ring-2 ring-ring' : 'border-border',
                )}
                title={t(`availabilityLevelHint.${option}`)}
              >
                <input
                  type="radio"
                  name="availability-level"
                  value={option}
                  checked={level === option}
                  onChange={() => setLevel(option)}
                  className="size-4 accent-primary"
                />
                <span aria-hidden="true">{LEVEL_SYMBOL[option]}</span>
                <span>{t(`availabilityLevel.${option}`)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="overflow-x-auto">
          <table
            className="w-full min-w-160 border-separate border-spacing-0.5 text-xs"
            role="grid"
            aria-label={t('teachers.availability.gridLabel')}
          >
            <caption className="sr-only">{t('teachers.availability.gridLabel')}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-20 py-1 text-left font-medium text-text-muted">
                  {t('common.hoursShort')}
                </th>
                {grid.weekdays.map((weekday) => (
                  <th key={weekday} scope="col" className="py-1 font-medium text-text-muted">
                    <span className="hidden sm:inline">{t(`weekday.${weekday}`)}</span>
                    <span className="sm:hidden">{t(`weekdayShort.${weekday}`)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.slots.map((slot, slotIndex) => (
                <tr key={slot.start}>
                  <th
                    scope="row"
                    className="tabular py-1 pr-2 text-right font-normal text-text-muted"
                  >
                    {slot.start}
                  </th>
                  {grid.weekdays.map((weekday, dayIndex) => {
                    const cell = grid.rows[dayIndex]?.cells[slotIndex]
                    if (!cell) return null
                    const isFocused = focus.day === dayIndex && focus.slot === slotIndex

                    return (
                      <td key={weekday} className="p-0">
                        <button
                          type="button"
                          ref={(node) => {
                            const key = `${dayIndex}|${slotIndex}`
                            if (node) cellRefs.current.set(key, node)
                            else cellRefs.current.delete(key)
                          }}
                          tabIndex={isFocused ? 0 : -1}
                          disabled={!data.editable}
                          aria-label={cellLabel(cell.weekday, cell.start, cell.end, cell.level)}
                          aria-pressed={cell.level !== 'unavailable'}
                          onFocus={() => setFocus({ day: dayIndex, slot: slotIndex })}
                          onKeyDown={(event) =>
                            onKeyDown(event, { day: dayIndex, slot: slotIndex })
                          }
                          onPointerDown={(event) => {
                            event.preventDefault()
                            focusCell({ day: dayIndex, slot: slotIndex })
                            startStroke({ day: dayIndex, slot: slotIndex })
                          }}
                          onPointerEnter={() => extendStroke({ day: dayIndex, slot: slotIndex })}
                          className={cn(
                            'flex h-7 w-full items-center justify-center rounded-sm border border-transparent transition-colors',
                            LEVEL_STYLE[cell.level],
                            data.editable && 'hover:border-primary',
                            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                          )}
                        >
                          <span aria-hidden="true">{LEVEL_SYMBOL[cell.level]}</span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-text">{t('teachers.availability.legend')}</h3>
            <ul className="mt-2 space-y-1 text-sm text-text-muted">
              {AVAILABILITY_LEVELS.map((option) => (
                <li key={option} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex size-5 items-center justify-center rounded-sm',
                        LEVEL_STYLE[option],
                      )}
                    >
                      {LEVEL_SYMBOL[option]}
                    </span>
                    {t(`availabilityLevel.${option}`)}
                  </span>
                  <span className="tabular">
                    {`${formatHours(locale, hoursByLevel[option])} ${t('common.hoursShort')}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text">
              {t('teachers.availability.keyboardTitle')}
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              {t('teachers.availability.keyboardHint')}
            </p>
            {dirty ? (
              <p className="mt-2 text-sm font-medium text-warning">
                {t('teachers.availability.unsaved')}
              </p>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
