/// <reference lib="webworker" />

/**
 * The service worker.
 *
 * Four jobs: precache the shell, keep the built assets fresh without blocking
 * on the network, let a teacher open their own week on a train, and receive
 * push notifications.
 *
 * **What is cached from the API, and what is never cached.** Only one family
 * of GET responses is stored: the caller's own timetable
 * (`/api/v1/calendar/sessions`), with NetworkFirst, so an unreachable server
 * shows yesterday's answer rather than an empty screen. Everything else —
 * every list, every document, every message — goes to the network every time,
 * because a tenant-scoped answer served to the next identity would be a leak
 * (R2). The calendar cache is dropped the moment the identity or the active
 * center changes: the app posts `CLEAR_API_CACHE` on sign-out and on centre
 * switch, and this worker honours it immediately.
 *
 * **Updates are invisible.** A new version is downloaded and kept waiting.
 * Nothing reloads under anybody's hands — a teacher halfway through a message
 * loses nothing — and the app applies it at its next start (see
 * `app/service-worker.ts`).
 */
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

const API_CACHE = 'uacademic-api-v1'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

/**
 * Static assets: served from the cache and refreshed behind the reader's back.
 * Hashed filenames make this safe — a changed asset is a different URL.
 */
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'uacademic-assets-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
)

/**
 * The caller's own timetable, and nothing else. Network first: the answer on
 * screen is the live one whenever there is a network, and the stored copy
 * only stands in when there is not.
 */
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' && url.pathname.startsWith('/api/v1/calendar/sessions'),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
)

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string })?.type

  // Applied at the app's next start, never mid-session.
  if (type === 'SKIP_WAITING') void self.skipWaiting()

  // Signing out, or switching center: whatever was cached belonged to the
  // previous identity and must not survive it.
  if (type === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API_CACHE))
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
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
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
