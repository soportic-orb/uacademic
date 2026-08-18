/**
 * Registering the service worker, and applying an update without anybody
 * noticing.
 *
 * The rule this file exists for: **a new version never takes over a running
 * session.** Somebody halfway through writing a message, or dragging a class
 * across the planner, does not get their page reloaded under their hands and
 * does not get asked about it either — being asked is itself an interruption,
 * and "there is a new version" is not a decision a teacher should have to make.
 *
 * So a waiting worker is recorded and left alone. The next time the app is
 * started — a fresh tab, the PWA opened again tomorrow morning — the flag is
 * seen before anything is rendered, the waiting worker is told to take over,
 * and the page loads on the new version. From the outside it looks like
 * nothing happened, which is the point.
 */
const PENDING_KEY = 'uacademic:update-pending'
/** Guards the one reload the handover needs, so it can never become a loop. */
const APPLYING_KEY = 'uacademic:update-applying'

function markPending(): void {
  try {
    localStorage.setItem(PENDING_KEY, new Date().toISOString())
  } catch {
    // Private mode without storage: the update simply waits for a hard reload.
  }
}

export function updatePending(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) !== null
  } catch {
    return false
  }
}

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * Tells the worker to drop what it cached from the API.
 *
 * Called on sign-out and when the active center changes: the only thing kept
 * there is the caller's own timetable, and it belongs to the identity that
 * asked for it (R2).
 */
export function clearApiCache(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' })
}

/**
 * Applies a waiting update, if there is one, before the app renders.
 *
 * Returns true when a handover was started, in which case the page is about to
 * reload and the caller should not bother rendering.
 */
export async function applyPendingUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  if (!updatePending()) return false

  // The reload below re-enters this function; without this guard a worker that
  // refuses to activate would send the app round in circles.
  if (sessionStorage.getItem(APPLYING_KEY)) {
    sessionStorage.removeItem(APPLYING_KEY)
    clearPending()
    return false
  }

  const registration = await navigator.serviceWorker.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) {
    clearPending()
    return false
  }

  sessionStorage.setItem(APPLYING_KEY, '1')
  clearPending()

  return await new Promise<boolean>((resolve) => {
    // `controllerchange` fires once the waiting worker has taken over.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        window.location.reload()
        resolve(true)
      },
      { once: true },
    )

    waiting.postMessage({ type: 'SKIP_WAITING' })

    // If it never activates, carry on with the version already running rather
    // than leaving somebody staring at a blank page.
    setTimeout(() => resolve(false), 3_000)
  })
}

/**
 * Registers the worker and watches for new versions — recording them, never
 * acting on them.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { type: 'module' }).then((registration) => {
      if (registration.waiting) markPending()

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return

        installing.addEventListener('statechange', () => {
          // "Installed with a controller already in place" means: a new
          // version is ready and an old one is running. Note it and say
          // nothing.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            markPending()
          }
        })
      })

      // A long-lived PWA session may never reload; ask now and then whether
      // there is something new to have waiting.
      setInterval(
        () => {
          void registration.update()
        },
        60 * 60 * 1000,
      )
    })
  })
}
