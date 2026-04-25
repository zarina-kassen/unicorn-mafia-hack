import { ApiClient, type GetToken } from './client'
import type { GuidanceResponse, PoseContextPayload } from './types'

/**
 * Client for the `/api/guidance` resource.
 */
export class GuidanceClient extends ApiClient {
  constructor(getToken: GetToken, baseUrl?: string) {
    super(getToken, baseUrl)
  }

  async postGuidance(
    ctx: PoseContextPayload,
    signal?: AbortSignal,
  ): Promise<GuidanceResponse> {
    return this.request<GuidanceResponse>('/api/guidance', {
      method: 'POST',
      body: JSON.stringify(ctx),
      signal,
    })
  }
}
