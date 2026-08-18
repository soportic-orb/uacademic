/**
 * Realtime, with the transport hidden behind a hook.
 *
 * CLAUDE.md §2: the target hosting may not allow WebSockets, so the default is
 * a Server-Sent Events stream, and anything that cannot hold one open falls
 * back to polling the same events. Whoever uses this hook never learns which
 * of the two answered.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { apiFetch } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

const BASE_URL = import.meta.env.VITE_UACADEMIC_API_URL ?? 'http://localhost:3001'

/**
 * Development and e2e only. `EventSource` cannot carry the identity header the
 * mock mode switches users with, so those builds poll instead — which also
 * keeps the fallback path exercised by the e2e suite.
 */
const MOCK_AUTH = import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock'

const POLL_INTERVAL_MS = 15_000

export interface RealtimeEvent {
  id: number
  type: string
  payload: Record<string, unknown>
  createdAt: number
}

/** Which queries an event makes stale. */
const INVALIDATES: Record<string, string[]> = {
  notification: ['notifications'],
  message: ['conversations', 'thread', 'notifications'],
  'schedule.published': ['planner-version', 'calendar', 'notifications'],
}

export type RealtimeTransportName = 'stream' | 'poll'

export interface RealtimeState {
  transport: RealtimeTransportName
  connected: boolean
  lastEvent: RealtimeEvent | null
}

/**
 * Subscribes once, for the whole session: the center's channel and the user's
 * own. Events do not carry enough to update a cache safely, so they mark the
 * affected queries stale and TanStack Query refetches what is on screen.
 */
export function useRealtime(onEvent?: (event: RealtimeEvent) => void): RealtimeState {
  const queryClient = useQueryClient()
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const [state, setState] = useState<RealtimeState>({
    transport: MOCK_AUTH ? 'poll' : 'stream',
    connected: false,
    lastEvent: null,
  })

  // The callback is read through a ref so a new closure on every render does
  // not tear the stream down and open it again.
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    if (!centerId) return

    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let cursor = 0

    const receive = (event: RealtimeEvent) => {
      if (disposed) return
      setState((current) => ({ ...current, lastEvent: event }))
      for (const key of INVALIDATES[event.type] ?? []) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
      handler.current?.(event)
    }

    const poll = async () => {
      try {
        const batch = await apiFetch<{ lastEventId: number; events: RealtimeEvent[] }>(
          `/api/v1/events/poll?after=${cursor}`,
        )
        cursor = batch.lastEventId
        if (!disposed) setState((current) => ({ ...current, connected: true }))
        for (const event of batch.events) receive(event)
      } catch {
        if (!disposed) setState((current) => ({ ...current, connected: false }))
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
    }

    const startPolling = () => {
      if (disposed) return
      setState((current) => ({ ...current, transport: 'poll' }))
      void poll()
    }

    if (MOCK_AUTH || typeof EventSource === 'undefined') {
      startPolling()
    } else {
      source = new EventSource(`${BASE_URL}/api/v1/events/stream`, { withCredentials: true })
      source.onopen = () => {
        if (!disposed) setState((current) => ({ ...current, transport: 'stream', connected: true }))
      }
      source.onerror = () => {
        // The browser retries a stream by itself; two failures in a row mean
        // something between here and the server will not keep it open.
        if (source?.readyState === EventSource.CLOSED) {
          source.close()
          source = null
          startPolling()
        } else {
          setState((current) => ({ ...current, connected: false }))
        }
      }
      for (const type of Object.keys(INVALIDATES)) {
        source.addEventListener(type, (event) => {
          const message = event as MessageEvent<string>
          receive({
            id: Number(message.lastEventId ?? 0),
            type,
            payload: JSON.parse(message.data) as Record<string, unknown>,
            createdAt: Date.now(),
          })
        })
      }
    }

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      source?.close()
    }
    // `mockUserEmail` is in the list on purpose: switching demo identity in
    // development has to reopen the subscription as the new person.
  }, [centerId, mockUserEmail, queryClient])

  return state
}
