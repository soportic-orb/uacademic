/**
 * The parameters that are tables rather than figures.
 *
 * Contractual categories, recognised reductions, exam periods, holidays and
 * the days the center teaches are lists, and until now they were the one part
 * of the configuration nobody could touch by hand: a center whose regulation
 * the extraction could not read had no way to name its own categories.
 *
 * They are edited as what they are — a row per entry, a column per field, with
 * the columns declared beside the schema that validates them — and never as
 * JSON in a text box.
 */
import {
  type CollectionField,
  collectionChoiceLabelKey,
  collectionFieldLabelKey,
  collectionFields,
  emptyCollectionRow,
} from '@uacademic/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'

type Row = Record<string, unknown>

const CONTROL = 'h-9 rounded-control border border-border bg-surface px-2 text-sm text-text'

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : []
}

export function CollectionEditor({
  paramKey,
  value,
  editing,
  onChange,
}: {
  paramKey: string
  value: unknown
  editing: boolean
  onChange: (rows: Row[]) => void
}) {
  const { t } = useTranslation()
  const columns = collectionFields(paramKey)
  const rows = asRows(value)

  if (!columns) return null

  const update = (index: number, field: string, next: unknown) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, [field]: next } : row)))

  if (rows.length === 0 && !editing) {
    return <p className="mt-2 text-sm italic text-text-muted">{t('settings.collections.empty')}</p>
  }

  return (
    <div className="mt-2 space-y-2">
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.name}
                    scope="col"
                    className="whitespace-nowrap px-2 py-1 text-left text-xs font-medium text-text-muted"
                  >
                    {t(collectionFieldLabelKey(paramKey, column.name))}
                    {column.unit ? <span className="ml-1 font-normal">({column.unit})</span> : null}
                  </th>
                ))}
                {editing ? (
                  <th scope="col" className="w-10">
                    <span className="sr-only">{t('common.remove')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {columns.map((column) => (
                    <td key={column.name} className="px-2 py-1 align-middle">
                      <Cell
                        paramKey={paramKey}
                        column={column}
                        value={row[column.name]}
                        editing={editing}
                        position={index}
                        onChange={(next) => update(index, column.name, next)}
                      />
                    </td>
                  ))}
                  {editing ? (
                    <td className="px-1 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('settings.collections.remove', { position: index + 1 })}
                        onClick={() => onChange(rows.filter((_, position) => position !== index))}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <Button
          variant="secondary"
          onClick={() => onChange([...rows, emptyCollectionRow(paramKey)])}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('settings.collections.add')}
        </Button>
      ) : null}
    </div>
  )
}

function Cell({
  paramKey,
  column,
  value,
  editing,
  position,
  onChange,
}: {
  paramKey: string
  column: CollectionField
  value: unknown
  editing: boolean
  position: number
  onChange: (next: unknown) => void
}) {
  const { t } = useTranslation()
  const label = `${t(collectionFieldLabelKey(paramKey, column.name))} · ${position + 1}`

  if (!editing) {
    if (column.kind === 'boolean') return <span>{value ? '✓' : '✗'}</span>
    if (column.kind === 'choice' && typeof value === 'string')
      return <span>{t(collectionChoiceLabelKey(paramKey, column.name, value))}</span>
    if (value === null || value === undefined || value === '')
      return <span className="text-text-muted">—</span>
    return (
      <span className={column.kind === 'number' ? 'tabular-nums' : undefined}>{String(value)}</span>
    )
  }

  if (column.kind === 'boolean') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded-sm border-border"
      />
    )
  }

  if (column.kind === 'choice') {
    return (
      <select
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className={`${CONTROL} min-w-36`}
      >
        {column.nullable ? <option value="">{t('common.choose')}</option> : null}
        {(column.options ?? []).map((option) => (
          <option key={option} value={option}>
            {t(collectionChoiceLabelKey(paramKey, column.name, option))}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={column.kind === 'date' ? 'date' : column.kind === 'number' ? 'number' : 'text'}
      step={column.kind === 'number' ? 'any' : undefined}
      aria-label={label}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(event) => {
        const raw = event.target.value
        // An empty box is null where the schema allows it, and the empty
        // string where it does not: reporting "expected a number, got null"
        // is what tells somebody the column is required.
        if (raw === '') return onChange(column.nullable ? null : '')
        onChange(column.kind === 'number' ? Number(raw) : raw)
      }}
      className={`${CONTROL} ${column.kind === 'number' ? 'w-28 tabular-nums' : 'w-44'}`}
    />
  )
}

/**
 * The days the center teaches: seven checkboxes, Monday first, rather than a
 * list of integers. Stored sorted, because the planner reads it in order.
 */
export function WeekdaysEditor({
  value,
  editing,
  onChange,
}: {
  value: unknown
  editing: boolean
  onChange: (weekdays: number[]) => void
}) {
  const { t } = useTranslation()
  const selected = new Set(Array.isArray(value) ? (value as number[]) : [])
  const days = [1, 2, 3, 4, 5, 6, 7]

  if (!editing) {
    const names = days.filter((day) => selected.has(day)).map((day) => t(`weekday.${day}`))
    return <span className="text-text">{names.length > 0 ? names.join(' · ') : '—'}</span>
  }

  return (
    <div className="flex flex-wrap gap-3">
      {days.map((day) => (
        <label key={day} className="flex items-center gap-1 text-sm text-text">
          <input
            type="checkbox"
            checked={selected.has(day)}
            onChange={(event) => {
              const next = new Set(selected)
              if (event.target.checked) next.add(day)
              else next.delete(day)
              onChange([...next].sort((a, b) => a - b))
            }}
            className="size-4 rounded-sm border-border"
          />
          {t(`weekday.${day}`)}
        </label>
      ))}
    </div>
  )
}
