import { createFetch } from '@better-fetch/fetch'

export type GetToken = () => Promise<string | null>

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export function createApiClient(getToken?: GetToken) {
  return createFetch({
    baseURL: BACKEND_URL,
    async onRequest(ctx) {
      const token = getToken ? await getToken() : null
      if (token) ctx.headers.set('Authorization', `Bearer ${token}`)
    },
  })
}

export type ApiFetch = ReturnType<typeof createApiClient>
