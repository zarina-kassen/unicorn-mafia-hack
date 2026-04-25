import { ApiClient } from './client'
import type { GuidanceResponse, PoseContextPayload } from './types'

/**
 * Client for the `/api/guidance` resource.
 */
export class GuidanceClient extends ApiClient {
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
