import { ApiClient } from './client'
import type { PoseVariantResult } from './types'

/**
 * Client for the `/api/pose-variants` resource.
 */
export class PoseVariantClient extends ApiClient {
  async createPoseVariantJob(referenceImage: Blob): Promise<PoseVariantResult[]> {
    const form = new FormData()
    form.append('reference_image', referenceImage, 'camera-reference.jpg')
    const token = await this.getToken()
    const headers = new Headers()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const res = await fetch(`${this.baseUrl}/api/pose-variants`, {
      method: 'POST',
      headers,
      body: form,
    })
    if (!res.ok) {
      throw new Error(`Pose generation failed (${res.status})`)
    }
    return res.json() as Promise<PoseVariantResult[]>
  }
}
