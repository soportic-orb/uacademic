import type { CenterSettings } from '@uacademic/shared'
import { parseCenterSettings } from '@uacademic/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlannerGrid } from '../src/features/planner/planner-grid'
import type { VersionDetailDto } from '../src/features/planner/queries'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const SETTINGS: CenterSettings = parseCenterSettings({
  schedule: {
    dayStart: '09:00',
    dayEnd: '12:00',
    slotMinutes: 60,
    workingWeekdays: [1, 2],
    teachingWeeks: 15,
  },
})

const CONTEXT = {
  settings: SETTINGS,
  teachers: [
    {
      teacherProfileId: 'p1',
      availability: [
        { weekday: 1 as const, startTime: '09:00', endTime: '12:00', level: 'available' as const },
        { weekday: 2 as const, startTime: '09:00', endTime: '10:00', level: 'available' as const },
      ],
      weeklyCapacityHours: 8,
    },
  ],
  spaces: [
    {
      spaceId: 's1',
      name: 'Aula 1.1',
      building: 'A',
      capacity: 60,
      type: 'classroom',
      equipment: [],
    },
  ],
  groups: [
    {
      groupId: 'g1',
      code: 'T1',
      subjectId: 'sub1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      capacity: 40,
      requiredSpaceType: null,
      requiredEquipment: [],
    },
    {
      groupId: 'g2',
      code: 'T2',
      subjectId: 'sub1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      capacity: 40,
      requiredSpaceType: null,
      requiredEquipment: [],
    },
  ],
}

const VERSION: VersionDetailDto = {
  id: 'v1',
  name: 'Esborrany',
  status: 'draft',
  editable: true,
  publishedAt: null,
  parentVersionId: null,
  grid: { dayStart: '09:00', dayEnd: '12:00', slotMinutes: 60, weekdays: [1, 2] },
  sessions: [
    {
      id: 'session-1',
      groupId: 'g1',
      groupCode: 'T1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      teacherProfileId: 'p1',
      teacherName: 'Marta Puig',
      spaceId: 's1',
      spaceName: 'Aula 1.1',
      building: 'A',
      weekday: 1,
      startTime: '09:00',
      endTime: '10:00',
      recurrence: 'weekly',
      dateFrom: '2026-09-14',
      dateTo: '2026-12-18',
    },
  ],
  violations: [],
  penalties: [],
  summary: {
    placed: 1,
    pending: 1,
    blocked: 0,
    warnings: 1,
    softCost: 3,
    teachersOutOfRange: 0,
  },
  pending: [
    {
      requirementId: 'g2#1',
      groupId: 'g2',
      groupCode: 'T2',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      durationMinutes: 60,
      candidateTeacherIds: ['p1'],
      candidateSpaceIds: ['s1'],
    },
  ],
  context: CONTEXT,
}

describe('the visual planner', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useSessionStore.getState().setCenterId('center-1')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => VERSION } as Response)
  })

  afterEach(() => vi.unstubAllGlobals())

  /** While a session is held, every cell announces what dropping it would do. */
  const target = (group: string, weekday: string, start: string) =>
    screen.getByRole('button', { name: `Mou ${group} a ${weekday} a les ${start}` })

  it('draws the placed sessions and the groups still pending', () => {
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    const grid = screen.getByRole('grid')
    expect(within(grid).getByText('MAT101')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Selecciona la sessió MAT101 T2' }),
    ).toBeInTheDocument()
  })

  it('reports the state of the week in the bottom bar', () => {
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    const placed = screen.getByText('Col·locades').closest('div')
    expect(placed).toHaveTextContent('1')
    const pending = screen.getByText('Pendents').closest('div')
    expect(pending).toHaveTextContent('1')
  })

  it('paints the grid the moment a session is picked up, with the reason in the tooltip', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    await user.click(screen.getByRole('button', { name: /MAT101 T1, Dilluns de 09:00 a 10:00/ }))

    // Tuesday 09:00 is inside the teacher's availability, so it is allowed —
    // but it would leave them coming in for a single session, which costs.
    const allowed = target('MAT101 T1', 'Dimarts', '09:00')
    expect(within(allowed).getByText('Penalitza')).toBeInTheDocument()
    expect(allowed.getAttribute('title')).toContain('una sola sessió')

    // Tuesday 10:00 is outside it: impossible, and the tooltip says why.
    const blocked = target('MAT101 T1', 'Dimarts', '10:00')
    expect(within(blocked).getByText('Impossible')).toBeInTheDocument()
    expect(blocked.getAttribute('title')).toContain('no disponible')
  })

  it('moves a session with the keyboard alone (R8)', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    const session = screen.getByRole('button', { name: /MAT101 T1, Dilluns de 09:00 a 10:00/ })
    session.focus()
    await user.keyboard(' ')
    expect(session).toHaveAttribute('aria-pressed', 'true')

    // Arrows move the cursor; Space drops on the focused cell.
    const destination = target('MAT101 T1', 'Dilluns', '11:00')
    destination.focus()
    await user.keyboard(' ')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      expect(String(patch?.[0])).toContain('/sessions/session-1')
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
        weekday: 1,
        startTime: '11:00',
        endTime: '12:00',
      })
    })
  })

  it('refuses an impossible drop and says why instead of failing silently', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    await user.click(screen.getByRole('button', { name: /MAT101 T1, Dilluns de 09:00 a 10:00/ }))
    await user.click(target('MAT101 T1', 'Dimarts', '10:00'))

    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'PATCH')).toBe(
      false,
    )
    // The refusal is announced politely rather than swallowed.
    expect(screen.getByText(/No es pot col·locar aquí/)).toBeInTheDocument()
  })

  it('cancels the move on Escape', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    const session = screen.getByRole('button', { name: /MAT101 T1, Dilluns de 09:00 a 10:00/ })
    session.focus()
    await user.keyboard(' ')
    await user.keyboard('{Escape}')

    expect(session).toHaveAttribute('aria-pressed', 'false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('places a pending group into the week', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    await user.click(screen.getByRole('button', { name: 'Selecciona la sessió MAT101 T2' }))
    await user.click(target('MAT101 T2', 'Dilluns', '10:00'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST')
      expect(post).toBeDefined()
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        groupId: 'g2',
        weekday: 1,
        startTime: '10:00',
      })
    })
  })

  it('undoes the last move by sending its inverse', async () => {
    const user = userEvent.setup()
    render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

    expect(screen.getByRole('button', { name: 'Desfés' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /MAT101 T1, Dilluns de 09:00 a 10:00/ }))
    await user.click(target('MAT101 T1', 'Dilluns', '11:00'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Desfés' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Desfés' }))

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit)?.method === 'PATCH',
      )
      expect(patches).toHaveLength(2)
      expect(JSON.parse(String((patches[1]?.[1] as RequestInit).body))).toMatchObject({
        weekday: 1,
        startTime: '09:00',
        endTime: '10:00',
      })
    })
    expect(screen.getByRole('button', { name: 'Refés' })).toBeEnabled()
  })

  it('locks the week when the version is published', () => {
    render(
      wrap(
        <PlannerGrid
          version={{ ...VERSION, status: 'published', editable: false }}
          context={CONTEXT}
        />,
      ),
    )

    expect(
      screen.getByText('Aquesta versió està publicada: només es pot consultar.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /MAT101 T1, Dilluns/ })).toBeDisabled()
  })
})
