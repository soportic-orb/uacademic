/**
 * Filling the screen.
 *
 * A page cannot resize the window it is in — only the browser can — so
 * "maximise" here is the Fullscreen API: the chrome goes and the platform gets
 * the whole display. It survives moving around the product because a single
 * page application never reloads, which is the point of the request.
 *
 * The state is read from the document rather than remembered, and the store
 * only mirrors it. Anything else drifts: the browser gives fullscreen back on
 * Escape, on a permission refusal and on some tab switches, without asking,
 * and a button that then still says "minimise" is a button that lies.
 */
import { create } from 'zustand'

interface FullscreenState {
  active: boolean
  /** Set from the document's own event; never called by a component. */
  sync: (active: boolean) => void
}

export const useFullscreenStore = create<FullscreenState>()((set) => ({
  active: false,
  sync: (active) => set({ active }),
}))

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null
}

/**
 * Asks for it, or gives it back.
 *
 * A refusal is not an error worth a toast: the browser refuses when the click
 * was not a real gesture, or when an embedding page forbids it, and in both
 * cases the button simply stays as it was.
 */
export async function toggleFullscreen(): Promise<void> {
  if (!fullscreenSupported()) return

  try {
    if (isFullscreen()) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* left as it was */
  }
}
