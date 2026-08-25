import type { CenterSettings } from '@uacademic/shared'
import { parseCenterSettings } from '@uacademic/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { PlannerGrid } from '../src/features/planner/planner-grid'
import { addDays, isoDate, mondayOf } from '../src/features/planner/week-dates'
import type { VersionDetailDto } from '../src/features/planner/queries'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        {/* Warnings are toasts, and a warning nobody can see is not one. */}
        <Toaster />
      </MemoryRouter>
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
  directory: [
    {
      teacherProfileId: 'p1',
      name: 'Marta Puig',
      avatarUrl: null,
      capacityHours: 240,
      weeklyCapacityHours: 8,
    },
    {
      teacherProfileId: 'p2',
      name: 'Sergi Vila',
      avatarUrl: null,
      capacityHours: 120,
      weeklyCapacityHours: 4,
    },
    {
      teacherProfileId: 'p3',
      name: 'Aina Bosch',
      avatarUrl: null,
      capacityHours: 240,
      weeklyCapacityHours: 8,
    },
  ],
  teachers: [
    {
      teacherProfileId: 'p1',
      availability: [
        { weekday: 1 as const, startTime: '09:00', endTime: '12:00', level: 'available' as const },
        { weekday: 2 as const, startTime: '09:00', endTime: '10:00', level: 'available' as const },
      ],
      weeklyCapacityHours: 8,
    },
    {
      teacherProfileId: 'p2',
      availability: [
        // Monday morning is refused outright; the afternoon is only something
        // they would rather avoid.
        {
          weekday: 1 as const,
          startTime: '09:00',
          endTime: '10:00',
          level: 'unavailable' as const,
        },
        { weekday: 1 as const, startTime: '15:00', endTime: '18:00', level: 'avoid' as const },
      ],
      weeklyCapacityHours: 4,
    },
    {
      teacherProfileId: 'p3',
      availability: [
        { weekday: 1 as const, startTime: '09:00', endTime: '14:00', level: 'available' as const },
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

/**
 * The term the fixture's classes run in.
 *
 * Ten weeks either side of today, because the grid opens on this week and only
 * draws what actually happens in it: a term hard-coded to autumn 2026 would
 * make every one of these tests pass or fail depending on the date they run.
 */
const TERM = {
  dateFrom: isoDate(addDays(mondayOf(new Date()), -70)),
  dateTo: isoDate(addDays(mondayOf(new Date()), 70)),
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
      teachers: [{ teacherProfileId: 'p1', name: 'Marta Puig' }],
      spaceId: 's1',
      spaceName: 'Aula 1.1',
      building: 'A',
      weekday: 1,
      startTime: '09:00',
      endTime: '10:00',
      recurrence: 'weekly',
      dateFrom: TERM.dateFrom,
      dateTo: TERM.dateTo,
      topic: null,
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
  groups: [
    {
      groupId: 'g1',
      groupCode: 'T1',
      subjectId: 'sub-1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      plannedHours: 60,
      durationMinutes: 60,
      targetMinutes: 120,
      placedMinutes: 60,
      remainingMinutes: 60,
      overplannedMinutes: 0,
      sessionsRemaining: 1,
      complete: false,
      candidateTeacherIds: ['p1'],
      candidateSpaceIds: ['s1'],
    },
    {
      groupId: 'g2',
      groupCode: 'T2',
      subjectId: 'sub-1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      plannedHours: 60,
      durationMinutes: 60,
      targetMinutes: 120,
      placedMinutes: 0,
      remainingMinutes: 120,
      overplannedMinutes: 0,
      sessionsRemaining: 2,
      complete: false,
      candidateTeacherIds: ['p1'],
      candidateSpaceIds: ['s1'],
    },
    {
      // Another subject, and one that is finished: both are what the column
      // has to keep showing rather than tidy away.
      groupId: 'g3',
      groupCode: 'T1',
      subjectId: 'sub-2',
      subjectCode: 'FIS201',
      subjectName: 'Física',
      plannedHours: 30,
      durationMinutes: 60,
      targetMinutes: 60,
      placedMinutes: 60,
      remainingMinutes: 0,
      overplannedMinutes: 0,
      sessionsRemaining: 0,
      complete: true,
      candidateTeacherIds: [],
      candidateSpaceIds: [],
    },
  ],
  range: { from: TERM.dateFrom, to: TERM.dateTo },
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

  describe('the groups column', () => {
    it('lists every group, finished ones included', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      expect(
        screen.getByRole('button', { name: 'Selecciona la sessió MAT101 T1' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Selecciona la sessió MAT101 T2' }),
      ).toBeInTheDocument()
      // A finished group stays on the list and says so, because "have I done
      // this one?" is what the column is for.
      expect(
        screen.getByRole('button', { name: 'Selecciona la sessió FIS201 T1' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Planificat')).toBeInTheDocument()
    })

    it('says how much of each group is still to place', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // Two decimals, as every other hour figure in the product (CLAUDE.md §4).
      expect(screen.getByText('Falten 1,00 h per planificar')).toBeInTheDocument()
      expect(screen.getByText('Falten 2,00 h per planificar')).toBeInTheDocument()
    })

    it('narrows to the subject being planned', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await user.selectOptions(screen.getByLabelText('Assignatura'), 'sub-2')

      expect(
        screen.getByRole('button', { name: 'Selecciona la sessió FIS201 T1' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Selecciona la sessió MAT101 T1' }),
      ).not.toBeInTheDocument()
    })

    it('offers every subject that has groups, and all of them by default', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      const select = screen.getByLabelText('Assignatura') as HTMLSelectElement
      expect(select.value).toBe('')
      expect(within(select).getByRole('option', { name: /MAT101/ })).toBeInTheDocument()
      expect(within(select).getByRole('option', { name: /FIS201/ })).toBeInTheDocument()
    })
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
      // A class is placed on a day, so a move sends the day it moved to —
      // Monday of the week on screen, which is where the grid opens.
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
        date: isoDate(mondayOf(new Date())),
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
    // The refusal is announced politely rather than swallowed. Scoped to the
    // toast: the same sentence is also the cell's own tooltip.
    expect(
      within(screen.getByRole('status')).getByText(/No es pot col·locar aquí/),
    ).toBeInTheDocument()
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
        date: isoDate(mondayOf(new Date())),
        startTime: '10:00',
      })
    })
  })

  /**
   * The grid draws only the classes that happen in the week it is showing,
   * which makes "which week" a correctness question. A class placed into a
   * term that has not started is correctly not drawn — and reads exactly like
   * the class having been lost.
   */
  describe('a class whose term is not this week', () => {
    it('opens on the first week of the year when today is outside it', () => {
      const nextYear = {
        ...VERSION,
        sessions: [],
        range: {
          dateFrom: undefined,
          from: isoDate(addDays(mondayOf(new Date()), 140)),
          to: isoDate(addDays(mondayOf(new Date()), 350)),
        },
      } as unknown as VersionDetailDto

      render(wrap(<PlannerGrid version={nextYear} context={CONTEXT} />))

      const expected = mondayOf(addDays(mondayOf(new Date()), 140))
      expect(
        within(screen.getByRole('grid')).getByText(String(expected.getDate())),
      ).toBeInTheDocument()
    })

    it('goes to the week the class lands in, rather than losing it', async () => {
      const user = userEvent.setup()
      const later = isoDate(addDays(mondayOf(new Date()), 70))

      // What the server answers with: the new class, dated to its own term.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...VERSION,
          sessions: [
            ...VERSION.sessions,
            {
              ...VERSION.sessions[0]!,
              id: 'session-new',
              groupId: 'g2',
              groupCode: 'T2',
              weekday: 1,
              startTime: '10:00',
              endTime: '11:00',
              dateFrom: later,
              dateTo: isoDate(addDays(mondayOf(new Date()), 140)),
            },
          ],
        }),
      } as Response)

      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await user.click(screen.getByRole('button', { name: 'Selecciona la sessió MAT101 T2' }))
      await user.click(target('MAT101 T2', 'Dilluns', '10:00'))

      // The week moved to where the class actually is, and said so.
      await waitFor(() =>
        expect(
          within(screen.getByRole('grid')).getByText(String(new Date(later).getDate())),
        ).toBeInTheDocument(),
      )
    })
  })

  describe('what the class is about', () => {
    it('is typed on the block and saved when the box is left', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      const topic = screen.getByLabelText('Tema de la classe')
      await user.type(topic, 'Derivades')
      await user.tab()

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit)?.method === 'PATCH',
        )
        expect(patch).toBeDefined()
        expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ topic: 'Derivades' })
      })
    })

    it('writes nothing when the box is left untouched', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // A request per letter is a request per letter; a request for a box
      // somebody clicked into and out of is worse still.
      await user.click(screen.getByLabelText('Tema de la classe'))
      await user.tab()

      expect(
        fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'PATCH'),
      ).toBe(false)
    })

    it('shows it above the teacher once it is there', () => {
      const withTopic = {
        ...VERSION,
        editable: false,
        sessions: [{ ...VERSION.sessions[0]!, topic: 'Derivades' }],
      }
      render(wrap(<PlannerGrid version={withTopic} context={CONTEXT} />))

      const block = screen.getByText('Derivades').closest('div')!
      expect(within(block).getByText('Derivades')).toBeInTheDocument()
      expect(within(block).getByText('Marta Puig')).toBeInTheDocument()
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
        date: VERSION.sessions[0]!.dateFrom,
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

  describe('putting somebody in front of a class', () => {
    it('refuses an hour the teacher said they cannot do, and does not send it', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // The class already has somebody, so this control adds the second.
      await user.selectOptions(screen.getByLabelText('Afegeix un docent'), 'p2')

      expect(await screen.findByText(/no té disponibilitat/)).toBeInTheDocument()
      // Nothing was written: the refusal is the answer, not a warning after it.
      const writes = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(writes).toHaveLength(0)
    })

    it('names the teacher in the week beside the grid, with their hours', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // Their own button in the rail, not the one that takes them off a class.
      const rail = screen.getByRole('button', { name: /^Marta Puig/ })
      // One placed hour of the eight this contract leaves for a week.
      expect(rail).toHaveTextContent('1')
      expect(rail).toHaveTextContent('8')
    })

    it('shows who is teaching each class, not only the subject code', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      expect(within(screen.getByRole('grid')).getByText('Marta Puig')).toBeInTheDocument()
    })

    it('lets a second person be added to a class, and sends both', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await user.selectOptions(screen.getByLabelText('Afegeix un docent'), 'p3')

      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
        teacherProfileIds: ['p1', 'p3'],
      })
    })

    it('reads the people giving a class as one line, not a column', () => {
      const shared = {
        ...VERSION,
        sessions: [
          {
            ...VERSION.sessions[0]!,
            teachers: [
              { teacherProfileId: 'p1', name: 'Marta Puig' },
              { teacherProfileId: 'p3', name: 'Aina Bosch' },
            ],
          },
        ],
      }

      render(wrap(<PlannerGrid version={shared} context={CONTEXT} />))

      // Both names, one dropdown: the one that adds the next person. Scoped
      // to the grid, because the rail beside it names them too.
      const grid = within(screen.getByRole('grid'))
      expect(grid.getByText('Marta Puig')).toBeInTheDocument()
      expect(grid.getByText('Aina Bosch')).toBeInTheDocument()
      expect(screen.getAllByLabelText('Afegeix un docent')).toHaveLength(1)
    })

    it('takes somebody off a class from the line their name is on', async () => {
      const user = userEvent.setup()
      const shared = {
        ...VERSION,
        sessions: [
          {
            ...VERSION.sessions[0]!,
            teachers: [
              { teacherProfileId: 'p1', name: 'Marta Puig' },
              { teacherProfileId: 'p3', name: 'Aina Bosch' },
            ],
          },
        ],
      }

      render(wrap(<PlannerGrid version={shared} context={CONTEXT} />))

      await user.click(screen.getByRole('button', { name: 'Treu Aina Bosch de la classe' }))

      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
        teacherProfileIds: ['p1'],
      })
    })
  })

  /**
   * Three groups can meet on Wednesday at eleven — that is what having three
   * groups means. Only rooms and groups cannot be in two places at once.
   */
  describe('several groups sharing an hour', () => {
    const together = (): VersionDetailDto => ({
      ...VERSION,
      sessions: [
        VERSION.sessions[0]!,
        {
          ...VERSION.sessions[0]!,
          id: 'session-2',
          groupId: 'g2',
          groupCode: 'T2',
          spaceId: null,
          spaceName: null,
          teacherProfileId: 'p3',
          teacherName: 'Aina Bosch',
          teachers: [{ teacherProfileId: 'p3', name: 'Aina Bosch' }],
        },
      ],
    })

    it('draws both classes, not whichever was read last', () => {
      render(wrap(<PlannerGrid version={together()} context={CONTEXT} />))

      const grid = within(screen.getByRole('grid'))
      expect(grid.getByText('T1')).toBeInTheDocument()
      expect(grid.getByText('T2')).toBeInTheDocument()
    })

    it('warns when the same person is put on both, and sends it anyway', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={together()} context={CONTEXT} />))

      // Marta already gives T1 at this hour; this puts her on T2 as well.
      const adders = screen.getAllByLabelText('Afegeix un docent')
      await user.selectOptions(adders[1]!, 'p1')

      expect(await screen.findByText(/ja té MAT101 T1/)).toBeInTheDocument()

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        )
        expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
          teacherProfileIds: ['p3', 'p1'],
        })
      })
    })
  })

  describe('changing how long a class lasts', () => {
    /**
     * jsdom lays nothing out, so the grid's rows measure zero and a drag has
     * nothing to count in. One row is given a height, which is the only thing
     * the handle asks the layout for.
     */
    const withRowHeight = (height: number) => {
      const original = HTMLTableRowElement.prototype.getBoundingClientRect
      HTMLTableRowElement.prototype.getBoundingClientRect = () =>
        ({ height, top: 0, bottom: height, left: 0, right: 0, width: 0, x: 0, y: 0 }) as DOMRect
      return () => {
        HTMLTableRowElement.prototype.getBoundingClientRect = original
      }
    }

    /** A press, a move and a release, as a pointer actually arrives. */
    const drag = (handle: HTMLElement, from: number, to: number) => {
      fireEvent.pointerDown(handle, { clientY: from, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: to, pointerId: 1 })
      fireEvent.pointerUp(window, { clientY: to, pointerId: 1 })
    }

    it('lengthens the class by the rows the pointer travelled', async () => {
      const restore = withRowHeight(40)
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      try {
        // The grid is drawn in hour rows here, so 40px down is one hour more.
        drag(screen.getByRole('button', { name: 'Allarga o escurça per baix' }), 100, 140)

        await waitFor(() => {
          const patch = fetchMock.mock.calls.find(
            (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
          )
          expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
            startTime: '09:00',
            endTime: '11:00',
          })
        })
      } finally {
        restore()
      }
    })

    it('moves the start of the class when it is the top edge that is dragged', async () => {
      const restore = withRowHeight(40)
      // A class in the middle of the day, so there is an hour above it to
      // grow into: the fixture's grid opens at 09:00.
      const later = {
        ...VERSION,
        sessions: [{ ...VERSION.sessions[0]!, startTime: '10:00', endTime: '11:00' }],
      }
      render(wrap(<PlannerGrid version={later} context={CONTEXT} />))

      try {
        // Upwards: the class starts an hour earlier and lasts an hour longer.
        drag(screen.getByRole('button', { name: 'Allarga o escurça per dalt' }), 100, 60)

        await waitFor(() => {
          const patch = fetchMock.mock.calls.find(
            (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
          )
          expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
            startTime: '09:00',
            endTime: '11:00',
          })
        })
      } finally {
        restore()
      }
    })

    it('shows the hour it would become while the edge is being dragged', () => {
      const restore = withRowHeight(40)
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      try {
        const handle = screen.getByRole('button', { name: 'Allarga o escurça per baix' })
        fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
        fireEvent.pointerMove(window, { clientY: 140, pointerId: 1 })

        expect(handle).toHaveTextContent('11:00')
      } finally {
        restore()
      }
    })

    it('does nothing when the pointer never left the row it started in', async () => {
      const restore = withRowHeight(40)
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      try {
        drag(screen.getByRole('button', { name: 'Allarga o escurça per baix' }), 100, 104)

        expect(
          fetchMock.mock.calls.filter(
            (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
          ),
        ).toHaveLength(0)
      } finally {
        restore()
      }
    })

    it('lengthens it from the keyboard, which the pointer alternative needs (R8)', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // One slot down on the bottom edge: 09:00–10:00 becomes 09:00–11:00.
      const bottom = screen.getByRole('button', { name: 'Allarga o escurça per baix' })
      bottom.focus()
      await user.keyboard('{ArrowDown}')

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        )
        expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
          startTime: '09:00',
          endTime: '11:00',
        })
      })
    })

    it('will not shorten a class into nothing', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // The class is one slot long already: pulling its bottom edge up would
      // leave no class at all.
      const bottom = screen.getByRole('button', { name: 'Allarga o escurça per baix' })
      bottom.focus()
      await user.keyboard('{ArrowUp}')

      expect(
        fetchMock.mock.calls.filter(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toHaveLength(0)
    })
  })

  describe('typing the hour instead of dragging it', () => {
    const openHours = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: "Edita l'horari" }))
    }

    it('writes the hour that was typed', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await openHours(user)
      const end = screen.getByLabelText('Hora de fi')
      fireEvent.change(end, { target: { value: '11:30' } })
      fireEvent.blur(end)

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        )
        expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
          startTime: '09:00',
          endTime: '11:30',
        })
      })
    })

    it('refuses an hour that ends before it starts, and says so', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await openHours(user)
      const end = screen.getByLabelText('Hora de fi')
      fireEvent.change(end, { target: { value: '08:00' } })
      fireEvent.blur(end)

      expect(await screen.findByText(/ha de ser posterior/)).toBeInTheDocument()
      expect(
        fetchMock.mock.calls.filter(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toHaveLength(0)
    })

    it('refuses an hour the grid does not draw', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      // The fixture's grid runs 09:00–12:00.
      await openHours(user)
      const end = screen.getByLabelText('Hora de fi')
      fireEvent.change(end, { target: { value: '14:00' } })
      fireEvent.blur(end)

      expect(await screen.findByText(/09:00 a 12:00/)).toBeInTheDocument()
    })
  })

  describe('repeating a class across the term', () => {
    it('asks which days, at what time, and until when', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await user.click(screen.getByRole('button', { name: 'Duplica' }))

      const dialog = screen.getByRole('dialog')
      // The day it is already on is ticked; the rest are there to add.
      expect(within(dialog).getByLabelText('Dilluns')).toBeChecked()
      expect(within(dialog).getByLabelText('Dimecres')).not.toBeChecked()

      await user.click(within(dialog).getByLabelText('Dimecres'))
      await user.click(within(dialog).getByRole('button', { name: 'Duplica' }))

      await waitFor(() => {
        const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/duplicate'))
        expect(call).toBeDefined()
        expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
          weekdays: [1, 3],
          startTime: '09:00',
          endTime: '10:00',
        })
      })
    })

    it('will not send a series with no day in it', async () => {
      const user = userEvent.setup()
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      await user.click(screen.getByRole('button', { name: 'Duplica' }))
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByLabelText('Dilluns'))

      expect(within(dialog).getByRole('button', { name: 'Duplica' })).toBeDisabled()
    })
  })

  describe('moving through the year', () => {
    it('puts the day of the month under each weekday', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      const monday = mondayOf(new Date())
      expect(
        within(screen.getByRole('grid')).getByText(String(monday.getDate())),
      ).toBeInTheDocument()
    })

    it('draws only the classes that happen in the week on screen', () => {
      // The same class, a term that ended before this week began.
      const past: VersionDetailDto = {
        ...VERSION,
        sessions: [
          {
            ...VERSION.sessions[0]!,
            dateFrom: isoDate(addDays(mondayOf(new Date()), -140)),
            dateTo: isoDate(addDays(mondayOf(new Date()), -70)),
          },
        ],
      }
      render(wrap(<PlannerGrid version={past} context={CONTEXT} />))

      expect(within(screen.getByRole('grid')).queryByText('MAT101')).not.toBeInTheDocument()
      expect(screen.getByText('0 de 1 classes aquesta setmana')).toBeInTheDocument()
    })

    it('skips the off week of a fortnightly class', () => {
      const fortnightly: VersionDetailDto = {
        ...VERSION,
        sessions: [{ ...VERSION.sessions[0]!, recurrence: 'biweekly', dateFrom: TERM.dateFrom }],
      }
      render(wrap(<PlannerGrid version={fortnightly} context={CONTEXT} />))

      // dateFrom is a Monday ten whole weeks back, and the class is on Monday,
      // so this week is an even number of weeks from the first one.
      expect(within(screen.getByRole('grid')).getByText('MAT101')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Setmana següent' }))
      expect(within(screen.getByRole('grid')).queryByText('MAT101')).not.toBeInTheDocument()
    })

    it('steps a week at a time, across the end of a month', () => {
      render(wrap(<PlannerGrid version={VERSION} context={CONTEXT} />))

      const before = mondayOf(new Date())
      fireEvent.click(screen.getByRole('button', { name: 'Setmana següent' }))

      const expected = new Date(before)
      expected.setDate(expected.getDate() + 7)
      expect(
        within(screen.getByRole('grid')).getByText(String(expected.getDate())),
      ).toBeInTheDocument()
    })
  })
})
