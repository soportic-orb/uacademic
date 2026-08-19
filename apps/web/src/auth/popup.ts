/**
 * Whether this document is the sign-in pop-up carrying Microsoft's answer.
 *
 * It matters because the application must *not* start here. An installation
 * whose Entra registration still points at the site root sends the pop-up to
 * the app itself, and starting it there is actively harmful, not merely
 * wasteful: the window stays white while React and the translations load, and a
 * service-worker update waiting in the wings reloads the pop-up — throwing away
 * the answer Microsoft just put in the address bar. The opener then waits for a
 * response that no longer exists, and the person is left looking at a blank
 * window until it times out.
 *
 * Doing nothing leaves that answer exactly where the opener is looking for it.
 */
export function isSignInPopup(window: Window): boolean {
  if (window.opener == null) return false
  const response = window.location.hash + window.location.search
  return /[#&?](code|error|id_token|state)=/.test(response)
}
