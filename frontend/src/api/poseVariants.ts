import { type ApiFetch, type GetToken, createApiClient } from './base'

export interface PoseVariantResult {
  id: string
  slot_index: number
  title: string
  image_url: string
  replaceable: boolean
}

export class PoseVariantsClient {
  private readonly fetch: ApiFetch

  constructor(getToken?: GetToken) {
    this.fetch = createApiClient(getToken)
  }

  async createJob(referenceImage: Blob): Promise<PoseVariantResult[]> {
    const form = new FormData()
    form.append('reference_image', referenceImage, 'camera-reference.jpg')
    const { data, error } = await this.fetch<PoseVariantResult[]>('/api/pose-variants', {
      method: 'POST',
      body: form,
    })
    if (error) throw new Error(`Pose generation failed: ${String(error)}`)
    return data
  }
}
