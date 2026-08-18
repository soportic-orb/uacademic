/// <reference lib="webworker" />

/**
 * The service worker.
 *
 * Two jobs: precache the shell (so the app opens on a bad campus connection)
 * and receive push notifications. API responses are never cached — they are
 * tenant-scoped, and a cached answer served to the next identity would be a
 * leak (R2).
 */
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') void self.skipWaiting()
})

interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    payload = { title: 'UAcademic', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // One notification per kind replaces the previous one instead of
      // stacking six identical cards on a lock screen.
      tag: payload.tag ?? 'uacademic',
      data: { url: payload.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Focus the tab the person already has open rather than opening a fifth.
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    }),
  )
})
