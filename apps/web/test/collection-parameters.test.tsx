/**
 * The parameters that are lists rather than figures.
 *
 * A center whose regulation the extraction could not read has to be able to
 * name its own contractual categories, and until now the only editable
 * parameters were the ones that fit in a single box.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CollectionEditor, WeekdaysEditor } from '../src/features/settings/collection-editor'

type Row = Record<string, unknown>

/**
 * The editor is controlled, so a spy alone leaves the boxes showing their
 * first value while the keystrokes pile up behind them. This holds the rows
 * the way the settings card does, and reports what they ended up as.
 */
function Controlled({
  paramKey,
  initial,
  onSettle,
}: {
  paramKey: string
  initial: Row[]
  onSettle: (rows: Row[]) => void
}) {
  const [rows, setRows] = useState(initial)
  return (
    <CollectionEditor
      paramKey={paramKey}
      value={rows}
      editing
      onChange={(next) => {
        setRows(next)
        onSettle(next)
      }}
    />
  )
}

const CATEGORIES = [
  {
    code: 'TU',
    label: 'Titular',
    baseCapacityHours: 240,
    maxTeachingHours: 320,
    mapsTo: 'associate_professor',
    notes: null,
  },
]

describe('editing a collection parameter', () => {
  it('reads as a table, one column per field, not as JSON', () => {
    render(
      <CollectionEditor
        paramKey="categories"
        value={CATEGORIES}
        editing={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('columnheader', { name: /Codi/ })).toBeInTheDocument()
    expect(screen.getByText('TU')).toBeInTheDocument()
    // The mapping is named, not left as the enum value the schema stores.
    expect(screen.getByText('Professor/a titular')).toBeInTheDocument()
  })

  it('says so plainly when the center has recorded nothing', () => {
    render(<CollectionEditor paramKey="reductions" value={[]} editing={false} onChange={vi.fn()} />)

    expect(screen.getByText('Encara no hi ha cap entrada.')).toBeInTheDocument()
  })

  it('adds a blank row with every column present', async () => {
    const onChange = vi.fn()
    render(<CollectionEditor paramKey="categories" value={[]} editing onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Afegeix una fila' }))

    expect(onChange).toHaveBeenCalledWith([
      {
        code: '',
        label: '',
        baseCapacityHours: '',
        maxTeachingHours: '',
        mapsTo: null,
        notes: null,
      },
    ])
  })

  it('edits one cell and sends a number, without disturbing the rest of the row', async () => {
    const onSettle = vi.fn()
    render(<Controlled paramKey="categories" initial={CATEGORIES} onSettle={onSettle} />)

    await userEvent.clear(screen.getByLabelText('Capacitat base · 1'))
    await userEvent.type(screen.getByLabelText('Capacitat base · 1'), '180')

    const last = onSettle.mock.calls.at(-1)![0] as Row[]
    // A number, not the string the browser hands over: the schema on the
    // server refuses "180" where it wants 180.
    expect(last[0]!.baseCapacityHours).toBe(180)
    expect(last[0]!.code).toBe('TU')
    expect(last[0]!.label).toBe('Titular')
  })

  it('keeps an emptied optional column as null rather than an empty string', async () => {
    const onSettle = vi.fn()
    render(<Controlled paramKey="categories" initial={CATEGORIES} onSettle={onSettle} />)

    await userEvent.type(screen.getByLabelText('Notes · 1'), 'x')
    await userEvent.clear(screen.getByLabelText('Notes · 1'))

    const last = onSettle.mock.calls.at(-1)![0] as Row[]
    expect(last[0]!.notes).toBeNull()
  })

  it('removes the row it names, and only that one', async () => {
    const onChange = vi.fn()
    const two = [...CATEGORIES, { ...CATEGORIES[0]!, code: 'AS', label: 'Associat' }]
    render(<CollectionEditor paramKey="categories" value={two} editing onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Elimina la fila 2' }))

    expect(onChange).toHaveBeenCalledWith([CATEGORIES[0]])
  })

  it('offers nothing to edit while the card is only being read', () => {
    render(
      <CollectionEditor
        paramKey="categories"
        value={CATEGORIES}
        editing={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Afegeix una fila' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Codi · 1')).not.toBeInTheDocument()
  })
})

describe('the days the center teaches', () => {
  it('names them rather than listing their numbers', () => {
    render(<WeekdaysEditor value={[1, 3]} editing={false} onChange={vi.fn()} />)

    expect(screen.getByText('Dilluns · Dimecres')).toBeInTheDocument()
  })

  it('is seven checkboxes, and keeps them in order', async () => {
    const onChange = vi.fn()
    render(<WeekdaysEditor value={[3]} editing onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('Dilluns'))

    expect(onChange).toHaveBeenCalledWith([1, 3])
  })

  it('takes a day away', async () => {
    const onChange = vi.fn()
    render(<WeekdaysEditor value={[1, 2, 3]} editing onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('Dimarts'))

    expect(onChange).toHaveBeenCalledWith([1, 3])
  })
})
