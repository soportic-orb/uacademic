/**
 * Where a university's own Entra administrator goes to let UAcademic in.
 *
 * A multi-tenant application exists in the tenant it was registered in; every
 * other organisation has to have it installed once before anybody there can
 * use it. Until then Microsoft answers `AADSTS500011` — "the resource
 * principal was not found in the tenant" — and there is no consent prompt to
 * click through, because the resource cannot be resolved to prompt about.
 *
 * Nothing here is secret: the link identifies the application and the tenant,
 * and only somebody who can already administer that tenant can act on it.
 */
import { REDIRECT_PATH } from './msal'

export function adminConsentUrl(options: {
  clientId: string
  tenantId: string
  origin: string
}): string {
  const query = new URLSearchParams({
    client_id: options.clientId,
    // Where Microsoft returns the administrator afterwards. It has to be one of
    // the addresses registered on the application, and the sign-in callback is
    // the one that must be there for anything to work at all.
    redirect_uri: `${options.origin}${REDIRECT_PATH}`,
  })

  return `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/adminconsent?${query.toString()}`
}
