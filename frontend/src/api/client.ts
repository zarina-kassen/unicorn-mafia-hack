const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export type GetToken = () => Promise<string | null>

/**
 * Abstract authenticated API client.
 *
 * Subclasses call {@link request} to make JSON requests that automatically
 * include the Clerk session JWT as a Bearer token.
 */
export abstract class ApiClient {
  protected getToken: GetToken
  protected baseUrl: string

  constructor(getToken: GetToken, baseUrl: string = BACKEND_URL) {
    this.getToken = getToken
    this.baseUrl = baseUrl
  }

  protected async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const token = await this.getToken()
    const headers = new Headers(init?.headers)
    headers.set('content-type', 'application/json')
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    })
    if (!res.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
    }
    return res.json() as Promise<T>
  }
}
