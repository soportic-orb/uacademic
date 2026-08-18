import {
  type AccountInfo,
  type Configuration,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from '@azure/msal-browser'

/**
 * MSAL Browser with the authorization code flow and PKCE — the only flow a SPA
 * should use. MSAL implements the code challenge itself; there is no secret in
 * the bundle, and the resulting access token is exchanged once for a server
 * session cookie (see `auth/session.tsx`).
 */
const clientId = import.meta.env.VITE_UACADEMIC_ENTRA_CLIENT_ID ?? ''

/**
 * `/organizations` because the app is registered as multi-tenant: any work or
 * school account can *authenticate* here. Whether it may *enter* is decided by
 * the API against the registered tenants (R3).
 */
const authority =
  import.meta.env.VITE_UACADEMIC_ENTRA_AUTHORITY ??
  'https://login.microsoftonline.com/organizations'

const configuration: Configuration = {
  auth: {
    clientId,
    authority,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // Session storage, not local: closing the browser ends the Microsoft
    // session too, and our own session lives in an httpOnly cookie anyway.
    cacheLocation: 'sessionStorage',
  },
}

export const SCOPES = clientId
  ? [`api://${clientId}/access_as_user`, 'openid', 'profile', 'email']
  : []

let instance: PublicClientApplication | undefined
let initialized: Promise<void> | undefined

export function isEntraConfigured(): boolean {
  return clientId.length > 0
}

export async function getMsal(): Promise<PublicClientApplication> {
  instance ??= new PublicClientApplication(configuration)
  initialized ??= instance.initialize()
  await initialized
  return instance
}

export async function signInWithMicrosoft(): Promise<string> {
  const msal = await getMsal()
  const result = await msal.loginPopup({ scopes: SCOPES, prompt: 'select_account' })
  msal.setActiveAccount(result.account)
  return result.accessToken
}

/**
 * Silent refresh: MSAL renews the token from its cache or the refresh token,
 * and only falls back to interaction when Microsoft demands it.
 */
export async function acquireTokenSilently(): Promise<string | null> {
  const msal = await getMsal()
  const account: AccountInfo | null = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
  if (!account) return null

  try {
    const result = await msal.acquireTokenSilent({ account, scopes: SCOPES })
    return result.accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) return null
    throw error
  }
}

export async function signOutFromMicrosoft(): Promise<void> {
  const msal = await getMsal()
  const account = msal.getActiveAccount()
  if (!account) return

  // Clears the local MSAL cache without bouncing the user through Microsoft's
  // sign-out page: our own session was already revoked server-side.
  await msal.clearCache({ account })
}
