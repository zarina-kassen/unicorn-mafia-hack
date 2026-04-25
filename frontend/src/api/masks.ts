import { createApiClient } from './base'

export interface MaskResponse {
  mask_url: string
  width: number
  height: number
  source: string
}

export class MasksClient {
  private readonly fetch: ReturnType<typeof createApiClient>

  constructor(getToken?: () => Promise<string | null>) {
    this.fetch = createApiClient(getToken)
  }

  async extract(imageUrl: string): Promise<MaskResponse> {
    const { data, error } = await this.fetch<MaskResponse>('/api/pose-variants/mask', {
      method: 'POST',
      body: { image_url: imageUrl },
    })
    if (error) throw new Error(`Mask extraction failed: ${String(error)}`)
    return data
  }
}