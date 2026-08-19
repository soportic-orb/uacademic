import { useQuery } from '@tanstack/react-query'

import { apiDownload } from '../lib/api'

const isExternal = (url: string): boolean => /^(https?:)?\/\//.test(url) || url.startsWith('data:')

/**
 * Pictures come back from an authenticated route, so they cannot simply be the
 * `src` of an `<img>`: in development the API is on another origin and the
 * session cookie would not travel with the image request. They are fetched
 * like any other call and turned into a data URL, which the query cache then
 * holds — the same face on twenty rows is downloaded once.
 */
export function useImageData(url: string | null | undefined) {
  return useQuery({
    queryKey: ['image', url],
    enabled: Boolean(url),
    queryFn: async () => {
      // A logo configured before uploads existed is an address somewhere else
      // on the internet; it is already a usable `src` and there is nothing to
      // fetch through the API.
      if (!url || isExternal(url)) return url ?? ''

      const blob = await apiDownload(url)
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('image'))
        reader.readAsDataURL(blob)
      })
    },
    // The URL carries a checksum of the picture, so it is only ever stale when
    // it is a different URL.
    staleTime: Infinity,
    retry: false,
  })
}
