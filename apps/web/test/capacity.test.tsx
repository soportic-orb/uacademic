import type { AvailabilityResponseDto, TeacherWorkloadDto } from '@uacademic/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AvailabilityEditor } from '../src/features/capacity/availability-editor'
import { LoadPanel } from '../src/features/capacity/load-panel'
import { WorkloadBreakdown } from '../src/features/capacity/workload-breakdown'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const AVAILABILITY: AvailabilityResponseDto = {
  teacherProfileId: 'profile-1',
  entries: [{ weekday: 1, startTime: '08:00', endTime: '09:00', level: 'available' }],
  exceptions: [],
  grid: { dayStart: '08:00', dayEnd: '11:00', slotMinutes: 60, weekdays: [1, 2, 3] },
  hoursByLevel: { preferred: 0, available: 1, avoid: 0, unavailable: 0 },
  editable: true,
}

describe('availability editor', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => AVAILABILITY,
    } as Response)
  })

  afterEach(() => vi.unstubAllGlobals())

  const cell = (weekday: string, time: string, level: string) =>
    screen.getByRole('button', { name: `${weekday} de ${time} a ${nextHour(time)}: ${level}` })

  const nextHour = (time: string) =>
    `${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}:${time.slice(3)}`

  it('renders one cell per weekday and slot, with the stored levels', () => {
    render(wrap(<AvailabilityEditor teacherId="me" data={AVAILABILITY} />))

    // 3 weekdays × 3 slots.
    expect(within(screen.getByRole('grid')).getAllByRole('button')).toHaveLength(9)
    expect(cell('Dilluns', '08:00', 'Disponible')).toBeInTheDocument()
    expect(cell('Dimarts', '08:00', 'No disponible')).toBeInTheDocument()
  })

  it('paints a cell from the keyboard alone, with no pointer involved (R8)', async () => {
    const user = userEvent.setup()
    render(wrap(<AvailabilityEditor teacherId="me" data={AVAILABILITY} />))

    const first = cell('Dilluns', '08:00', 'Disponible')
    first.focus()
    await user.keyboard('{ArrowRight}')
    expect(cell('Dimarts', '08:00', 'No disponible')).toHaveFocus()

    await user.keyboard(' ')
    // The default paint level is "preferred", the first of the legend.
    expect(cell('Dimarts', '08:00', 'Preferit')).toHaveFocus()
  })

  it('paints a rectangle with Shift and the arrow keys', async () => {
    const user = userEvent.setup()
    render(wrap(<AvailabilityEditor teacherId="me" data={AVAILABILITY} />))

    cell('Dilluns', '08:00', 'Disponible').focus()
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{/Shift}')

    // Anchor plus one column and one row: four cells.
    for (const weekday of ['Dilluns', 'Dimarts']) {
      for (const time of ['08:00', '09:00']) {
        expect(cell(weekday, time, 'Preferit')).toBeInTheDocument()
      }
    }
    expect(cell('Dimecres', '08:00', 'No disponible')).toBeInTheDocument()
  })

  it('switches the paint level with the number keys', async () => {
    const user = userEvent.setup()
    render(wrap(<AvailabilityEditor teacherId="me" data={AVAILABILITY} />))

    const target = cell('Dimecres', '10:00', 'No disponible')
    target.focus()
    await user.keyboard('3 ')

    expect(cell('Dimecres', '10:00', 'Millor evitar')).toBeInTheDocument()
  })

  it('saves the painted week as merged intervals, not as one row per cell', async () => {
    const user = userEvent.setup()
    render(wrap(<AvailabilityEditor teacherId="me" data={AVAILABILITY} />))

    cell('Dilluns', '09:00', 'No disponible').focus()
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    await user.click(screen.getByRole('button', { name: 'Desa la disponibilitat' }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'PUT')
      expect(put).toBeDefined()
      const body = JSON.parse(String((put?.[1] as RequestInit).body))
      expect(body.entries).toEqual([
        { weekday: 1, startTime: '08:00', endTime: '09:00', level: 'available' },
        { weekday: 1, startTime: '09:00', endTime: '11:00', level: 'preferred' },
      ])
    })
  })

  it('locks the grid when the reader may not edit it', () => {
    render(wrap(<AvailabilityEditor teacherId="p1" data={{ ...AVAILABILITY, editable: false }} />))

    expect(screen.getByText('Només pots consultar aquesta disponibilitat.')).toBeInTheDocument()
    expect(within(screen.getByRole('grid')).getAllByRole('button')[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Desa la disponibilitat' })).not.toBeInTheDocument()
  })
})

describe('center load panel', () => {
  const fetchMock = vi.fn()

  const RESPONSE = {
    academicYearId: 'year-1',
    teachers: [
      {
        teacherProfileId: 'p1',
        userId: 'u1',
        firstName: 'Aina',
        lastName: 'Mestre Pons',
        category: 'full_professor',
        dedication: 'full_time',
        contractedHours: 240,
        reductionHours: 0,
        capacityHours: 180,
        assignedHours: 210,
        remainingHours: -30,
        ratioPercent: 116.67,
        status: 'over',
        degreeIds: ['d1'],
      },
    ],
    summary: {
      teachers: 1,
      totalCapacityHours: 180,
      totalAssignedHours: 210,
      ratioPercent: 116.67,
      byStatus: { under: 0, optimal: 0, limit: 0, over: 1 },
    },
    facets: {
      categories: ['full_professor', 'adjunct'],
      degrees: [{ id: 'd1', code: 'GEI', name: 'Grau en Enginyeria Informàtica' }],
    },
  }

  beforeEach(() => {
    // The panel refuses to query without an active center (R2), so the store
    // has to carry one before anything renders.
    useSessionStore.getState().setCenterId('center-1')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => RESPONSE } as Response)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows the traffic light with its label, never colour alone', async () => {
    render(wrap(<LoadPanel />))

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Aina Mestre Pons')).toBeInTheDocument()
    expect(within(table).getByText('Sobrecàrrega')).toBeInTheDocument()
  })

  it('sends the filters to the server rather than trimming rows in the browser', async () => {
    const user = userEvent.setup()
    render(wrap(<LoadPanel />))

    await screen.findByRole('table')
    await user.selectOptions(screen.getByLabelText('Estat de la càrrega'), 'over')

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('status=over'))).toBe(true)
    })
  })

  it('downloads the export with the same filters as the table on screen', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:load')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(wrap(<LoadPanel />))
    await screen.findByRole('table')
    await user.selectOptions(screen.getByLabelText('Titulació'), 'd1')

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESPONSE,
      blob: async () => new Blob(['x']),
    } as Response)

    await user.click(screen.getByRole('button', { name: /Exporta a Excel/ }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('/load/export?') && url.includes('degreeId=d1'))).toBe(
        true,
      )
    })
    expect(createObjectURL).toHaveBeenCalled()
  })
})

describe('personal workload breakdown', () => {
  const WORKLOAD: TeacherWorkloadDto = {
    teacherProfileId: 'p1',
    userId: 'u1',
    firstName: 'Sergi',
    lastName: 'Vila Rovira',
    category: 'adjunct',
    dedication: 'part_time',
    contractedHours: 120,
    reductionHours: 0,
    capacityHours: 120,
    assignedHours: 90,
    remainingHours: 30,
    ratioPercent: 75,
    status: 'under',
    degreeIds: ['d1'],
    academicYearId: 'year-1',
    bySubject: [
      {
        subjectId: 's1',
        subjectCode: 'MAT101',
        subjectName: 'Matemàtiques I',
        hours: 60,
        percent: 66.67,
        byConcept: [{ concept: 'lecture', hours: 60, percent: 100 }],
        groups: [{ groupId: 'g1', groupCode: 'T1', hours: 60 }],
      },
      {
        subjectId: 's2',
        subjectCode: 'FIS201',
        subjectName: 'Física',
        hours: 30,
        percent: 33.33,
        byConcept: [{ concept: 'tutoring', hours: 30, percent: 100 }],
        groups: [{ groupId: null, groupCode: null, hours: 30 }],
      },
    ],
    conceptTotals: [
      { concept: 'lecture', hours: 60, percent: 66.67 },
      { concept: 'tutoring', hours: 30, percent: 33.33 },
      { concept: 'coordination', hours: 0, percent: 0 },
      { concept: 'tfg', hours: 0, percent: 0 },
      { concept: 'other', hours: 0, percent: 0 },
    ],
  }

  it('shows the chart as a table, so it reads the same by eye and by screen reader', () => {
    render(wrap(<WorkloadBreakdown workload={WORKLOAD} />))

    const [byConcept] = screen.getAllByRole('table')
    expect(within(byConcept!).getByText('Docència')).toBeInTheDocument()
    expect(within(byConcept!).getByText('Tutories')).toBeInTheDocument()
    // Concepts with no hours are left out of the chart, not shown as zero bars.
    expect(within(byConcept!).queryByText('Coordinació')).not.toBeInTheDocument()
  })

  it('lists the subjects with their groups and totals', () => {
    render(wrap(<WorkloadBreakdown workload={WORKLOAD} />))

    const bySubject = screen.getAllByRole('table')[1]
    expect(within(bySubject!).getByText('Matemàtiques I')).toBeInTheDocument()
    expect(within(bySubject!).getByText('T1')).toBeInTheDocument()
  })

  it('offers an empty state instead of an empty chart', () => {
    render(
      wrap(
        <WorkloadBreakdown
          workload={{ ...WORKLOAD, assignedHours: 0, bySubject: [], conceptTotals: [] }}
        />,
      ),
    )

    expect(screen.getByText('Encara no tens hores assignades en aquest curs.')).toBeInTheDocument()
  })
})
