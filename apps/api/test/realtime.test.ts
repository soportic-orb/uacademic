import { describe, expect, it, vi } from 'vitest'

import {
  InMemoryRealtimeBus,
  centerChannel,
  formatSseFrame,
  userChannel,
} from '../src/lib/realtime.js'

describe('realtime bus', () => {
  it('delivers events to the subscribers of a channel only', () => {
    const bus = new InMemoryRealtimeBus()
    const centerListener = vi.fn()
    const otherListener = vi.fn()

    bus.subscribe(centerChannel('a'), centerListener)
    bus.subscribe(centerChannel('b'), otherListener)
    bus.publish(centerChannel('a'), 'schedule.published', { versionId: 'v1' })

    expect(centerListener).toHaveBeenCalledTimes(1)
    expect(otherListener).not.toHaveBeenCalled()
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new InMemoryRealtimeBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(userChannel('u1'), listener)

    unsubscribe()
    bus.publish(userChannel('u1'), 'notification', {})

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps a buffer so the polling fallback sees what it missed', () => {
    const bus = new InMemoryRealtimeBus({ bufferSize: 3 })
    const channel = centerChannel('a')

    const first = bus.publish(channel, 'one', {})
    bus.publish(channel, 'two', {})

    expect(bus.since(channel, 0)).toHaveLength(2)
    // Both events land in the same millisecond: a time-based cursor would
    // silently drop the second one, an id cursor does not.
    expect(bus.since(channel, first.id).map((event) => event.type)).toEqual(['two'])
  })

  it('drops the oldest events past the buffer size', () => {
    const bus = new InMemoryRealtimeBus({ bufferSize: 2 })
    const channel = centerChannel('a')

    bus.publish(channel, 'one', {})
    bus.publish(channel, 'two', {})
    bus.publish(channel, 'three', {})

    expect(bus.since(channel, 0).map((event) => event.type)).toEqual(['two', 'three'])
  })

  it('formats a valid SSE frame', () => {
    const bus = new InMemoryRealtimeBus()
    const event = bus.publish(centerChannel('a'), 'schedule.published', { versionId: 'v1' })

    expect(formatSseFrame(event)).toBe(
      `id: ${event.id}\nevent: schedule.published\ndata: {"versionId":"v1"}\n\n`,
    )
  })
})
