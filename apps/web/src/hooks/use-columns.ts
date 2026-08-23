/**
 * Which columns of a listing somebody wants to see.
 *
 * Every table in the platform shows what its screen decided was interesting,
 * which is never the same as what the person in front of it needs today: a
 * timetable coordinator wants the room, whoever is chasing signatures wants
 * the dates. So each listing carries a control to put columns away, and what
 * they put away is kept on their account rather than in the browser — the
 * arrangement is their work, and losing it because they opened the screen on
 * another machine would be losing work.
 *
 * Hidden rather than shown: a column added in a later release appears for
 * everybody instead of staying invisible to whoever had arranged that table
 * before it existed.
 */
import type { TableLayouts } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../lib/api'

export interface ColumnChoice {
  key: string
  label: string
}

export interface ColumnVisibility {
  /** Whether this column is drawn. Everything is, until proven otherwise. */
  shows: (key: string) => boolean
  hidden: string[]
  toggle: (key: string) => void
  /** The columns offered by the control, in the order the table draws them. */
  choices: ColumnChoice[]
  table: string
}

const QUERY_KEY = ['me', 'tables']

/**
 * @param table  A stable name for this listing. It is the key the arrangement
 *               is stored under, so renaming it forgets what people arranged.
 */
export function useColumnVisibility(table: string, choices: ColumnChoice[]): ColumnVisibility {
  const queryClient = useQueryClient()

  const layouts = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<TableLayouts>('/api/v1/me/tables'),
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: (hidden: string[]) =>
      apiJson<TableLayouts>(`/api/v1/me/tables/${table}`, 'PUT', { hidden }),
    onSuccess: (result) => queryClient.setQueryData(QUERY_KEY, result),
  })

  // What is on screen right now: the pending arrangement while it is being
  // saved, so a tick box answers immediately rather than a request later.
  const hidden = save.isPending
    ? (save.variables ?? [])
    : (layouts.data?.tables?.[table]?.hidden ?? [])

  return {
    table,
    choices,
    hidden,
    shows: (key) => !hidden.includes(key),
    toggle: (key) =>
      save.mutate(
        hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key],
      ),
  }
}
