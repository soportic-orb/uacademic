/**
 * Realtime transport abstraction.
 *
 * Shared hosting may not allow WebSockets, so the default transport is
 * Server-Sent Events with a polling fallback. Both read from the same bus, and
 * the bus is the only thing the rest of the API knows about — swapping SSE for
 * WebSockets later touches this file and nothing else.
 */
export interface RealtimeEvent {
  /** Monotonic per-process sequence, also used as the SSE `Last-Event-ID`. */
  id: number
  channel: string
  type: string
  payload: unknown
  createdAt: number
}

export type RealtimeListener = (event: RealtimeEvent) => void

export interface RealtimeTransport {
  publish(channel: string, type: string, payload: unknown): RealtimeEvent
  subscribe(channel: string, listener: RealtimeListener): () => void
  /**
   * Events published after a given event id, for the polling fallback.
   * The cursor is the sequence and not a timestamp on purpose: two events
   * published in the same millisecond would make a time cursor lose one.
   */
  since(channel: string, afterEventId: number): RealtimeEvent[]
}

export interface InMemoryBusOptions {
  /** How many events to keep per channel for late pollers. */
  bufferSize?: number
}

/**
 * Single-process bus. PM2 runs several API workers, so phase 1 replaces the
 * buffer with the `jobs`/notifications tables in MySQL; the interface stays.
 */
export class InMemoryRealtimeBus implements RealtimeTransport {
  readonly #listeners = new Map<string, Set<RealtimeListener>>()
  readonly #buffer = new Map<string, RealtimeEvent[]>()
  readonly #bufferSize: number
  #sequence = 0

  constructor(options: InMemoryBusOptions = {}) {
    this.#bufferSize = options.bufferSize ?? 100
  }

  publish(channel: string, type: string, payload: unknown): RealtimeEvent {
    this.#sequence += 1
    const event: RealtimeEvent = {
      id: this.#sequence,
      channel,
      type,
      payload,
      createdAt: Date.now(),
    }

    const buffered = this.#buffer.get(channel) ?? []
    buffered.push(event)
    if (buffered.length > this.#bufferSize) buffered.splice(0, buffered.length - this.#bufferSize)
    this.#buffer.set(channel, buffered)

    for (const listener of this.#listeners.get(channel) ?? []) listener(event)
    return event
  }

  subscribe(channel: string, listener: RealtimeListener): () => void {
    const listeners = this.#listeners.get(channel) ?? new Set<RealtimeListener>()
    listeners.add(listener)
    this.#listeners.set(channel, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(channel)
    }
  }

  since(channel: string, afterEventId: number): RealtimeEvent[] {
    return (this.#buffer.get(channel) ?? []).filter((event) => event.id > afterEventId)
  }
}

/** Channel naming keeps tenants apart on the wire too (R2). */
export function centerChannel(centerId: string): string {
  return `center:${centerId}`
}

export function userChannel(userId: string): string {
  return `user:${userId}`
}

export function formatSseFrame(event: RealtimeEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`
}
