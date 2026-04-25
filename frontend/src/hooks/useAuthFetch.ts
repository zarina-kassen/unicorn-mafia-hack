import { useAuth } from '@clerk/react'
import { useCallback } from 'react'

/**
 * Returns an augmented `fetch` that automatically attaches
 * the Clerk session JWT as a Bearer token.
 */
export function useAuthFetch() {
  const { getToken } = useAuth()

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const token = await getToken()
      const headers = new Headers(init?.headers)
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      return fetch(input, { ...init, headers })
    },
    [getToken],
  )
}
