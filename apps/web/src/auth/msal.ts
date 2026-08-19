import {
  type AccountInfo,
  AuthError,
  BrowserAuthErrorCodes,
  type Configuration,
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
} from '@azure/msal-browser'

/**
 * MSAL Browser with the authorization code flow and PKCE — the only flow a SPA
 * should use. MSAL implements the code challenge itself; there is no secret in
 * the bundle, and the resulting access token is exchanged once for a server
 * session cookie (see `auth/session.tsx`).
 */
/**
 * Where the application is registered, learned from the API at start-up.
 *
 * Not read from the bundle: a client id baked at build time means an operator
 * who registers the application and writes the id into `shared/.env` has to
 * rebuild the web app before the button will light up — and nothing tells them
 * so. The build-time variable is still honoured, because a developer running
 * Vite has no API to ask yet.
 */
let runtime: { clientId: string; authority: string } | null = import.meta.env
  .VITE_UACADEMIC_ENTRA_CLIENT_ID
  ? {
      clientId: import.meta.env.VITE_UACADEMIC_ENTRA_CLIENT_ID,
      authority:
        import.meta.env.VITE_UACADEMIC_ENTRA_AUTHORITY ??
        'https://login.microsoftonline.com/organizations',
    }
  : null

export function configureEntra(config: { clientId: string; authority: string } | null): void {
  // Changing it after MSAL has been built would leave the instance pointing at
  // the old application, so the instance is dropped with it.
  runtime = config
  instance = undefined
  initialized = undefined
}

/**
 * Where Microsoft sends the pop-up back to.
 *
 * A static, empty page rather than the site root. Pointing it at the root loads
 * the whole application inside the pop-up — React, the translations and the
 * service worker, in a window meant to be visible for an instant — which is a
 * blank window for as long as that takes and a half-started app when MSAL
 * closes it. This page has nothing in it: MSAL reads the response out of its
 * address bar and closes it.
 *
 * It must be registered in Entra ID under the *Single-page application*
 * platform, alongside the site root used for sign-out.
 */
export const REDIRECT_PATH = '/auth-callback.html'

/**
 * The authority is `/organizations` because the app is registered as
 * multi-tenant: any work or school account can *authenticate* here. Whether it
 * may *enter* is decided by the API against the registered tenants (R3).
 */
function buildConfiguration(config: { clientId: string; authority: string }): Configuration {
  return {
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      // Session storage, not local: closing the browser ends the Microsoft
      // session too, and our own session lives in an httpOnly cookie anyway.
      cacheLocation: 'sessionStorage',
    },
    system: {
      // MSAL replaces the text of its own errors with a link to its docs, so
      // the thrown object no longer carries what Microsoft actually said. Its
      // logger still does, and on the console that is the difference between
      // "invalid_request" and the AADSTS line naming the redirect URI.
      loggerOptions: {
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false,
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return
          if (level === LogLevel.Error) console.error(message)
          else console.warn(message)
        },
      },
    },
  }
}

export function scopes(): string[] {
  return runtime ? [`api://${runtime.clientId}/access_as_user`, 'openid', 'profile', 'email'] : []
}

let instance: PublicClientApplication | undefined
let initialized: Promise<void> | undefined

export function isEntraConfigured(): boolean {
  return runtime !== null
}

export async function getMsal(): Promise<PublicClientApplication> {
  if (!runtime) throw new Error('Microsoft sign-in is not configured on this installation.')

  instance ??= new PublicClientApplication(buildConfiguration(runtime))
  initialized ??= instance.initialize()
  await initialized
  return instance
}

export async function signInWithMicrosoft(): Promise<string> {
  const msal = await getMsal()
  const result = await msal.loginPopup({ scopes: scopes(), prompt: 'select_account' })
  msal.setActiveAccount(result.account)
  return result.accessToken
}

/**
 * Silent refresh: MSAL renews the token from its cache or the refresh token,
 * and only falls back to interaction when Microsoft demands it.
 */
export async function acquireTokenSilently(): Promise<string | null> {
  // Nothing to renew on an installation that does not use Microsoft; the caller
  // is a background timer, and throwing there helps nobody.
  if (!isEntraConfigured()) return null

  const msal = await getMsal()
  const account: AccountInfo | null = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
  if (!account) return null

  try {
    const result = await msal.acquireTokenSilent({ account, scopes: scopes() })
    return result.accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) return null
    throw error
  }
}

/**
 * What went wrong, in words an operator can act on.
 *
 * Everything Microsoft refuses arrives here as one of a handful of codes, and
 * they are the difference between "add the redirect URI" and "expose the API
 * scope". Reporting all of them as an unexpected error — which is what happens
 * when the caller only knows how to read our own API errors — leaves whoever
 * registered the application with nothing to go on.
 */
export interface EntraFailure {
  /** The person closed the window. Nothing failed; say nothing. */
  cancelled: boolean
  detail: string
}

export function describeEntraFailure(error: unknown): EntraFailure {
  if (error instanceof AuthError) {
    const cancelled =
      error.errorCode === BrowserAuthErrorCodes.userCancelled ||
      error.errorCode === BrowserAuthErrorCodes.interactionInProgressCancelled
    // The server messages carry the AADSTS code and a sentence explaining it;
    // that sentence is the useful half, and it is long, so it is trimmed to
    // what fits a toast without losing the code at the front.
    const message = (error.errorMessage || error.message || '').split(/\r?\n/)[0] ?? ''
    return {
      cancelled,
      detail: message ? `${error.errorCode}: ${message}`.slice(0, 300) : error.errorCode,
    }
  }

  if (error instanceof Error) return { cancelled: false, detail: error.message }
  return { cancelled: false, detail: String(error) }
}

export async function signOutFromMicrosoft(): Promise<void> {
  if (!isEntraConfigured()) return

  const msal = await getMsal()
  const account = msal.getActiveAccount()
  if (!account) return

  // Clears the local MSAL cache without bouncing the user through Microsoft's
  // sign-out page: our own session was already revoked server-side.
  await msal.clearCache({ account })
}
