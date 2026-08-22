/**
 * What is waiting for this person, as a number on the menu.
 *
 * Only what they have to act on themselves. A badge that counts other
 * people's work is a badge people learn to ignore, and then it stops carrying
 * the one thing it is for.
 */
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface PendingCounts {
  changes: number
  absences: number
}

const NONE: PendingCounts = { changes: 0, absences: 0 }

export function usePendingCounts(): PendingCounts {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  const query = useQuery({
    queryKey: ['pending-counts', centerId, mockUserEmail],
    queryFn: () => apiFetch<PendingCounts>('/api/v1/me/pending'),
    enabled: Boolean(centerId),
    // Refreshed by the realtime channel when something arrives; this is the
    // floor for a session that has been open all afternoon.
    staleTime: 60_000,
    retry: false,
  })

  return query.data ?? NONE
}

/** The menu entries a count belongs to. */
export function pendingFor(counts: PendingCounts, key: string): number {
  if (key === 'changes') return counts.changes
  if (key === 'absences') return counts.absences
  return 0
}
