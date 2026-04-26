import { type GetToken } from './base'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export interface PoseMaskResponse {
  mask_url: string
  width: number
  height: number
  source: string
}

function absoluteMaskUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${BACKEND_URL}${path}`
}

/**
 * Request a white-on-black person mask for a stored pose variant image (`/api/images/...`).
 */
export async function extractPoseMask(
  imageUrl: string,
  getToken?: GetToken,
): Promise<PoseMaskResponse> {
  const token = getToken ? await getToken() : null
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BACKEND_URL}/api/pose-mask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pose mask extraction failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as PoseMaskResponse
  if (!data.mask_url || !Number.isFinite(data.width) || !Number.isFinite(data.height)) {
    throw new Error('pose mask extraction returned invalid payload')
  }
  return { ...data, mask_url: absoluteMaskUrl(data.mask_url) }
}
