/**
 * Two questions about where the app is running, kept out of the components so
 * fast refresh only ever sees component exports.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false

  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's own flag, which predates the standard one and is still what
    // iOS sets.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent

  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}
