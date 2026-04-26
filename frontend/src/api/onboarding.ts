import { type ApiFetch, type GetToken, createApiClient } from './base'

export type OnboardingResult = { ok: true } | { ok: false; message: string }

export class OnboardingClient {
  private readonly fetch: ApiFetch

  constructor(getToken?: GetToken) {
    this.fetch = createApiClient(getToken)
  }

  async uploadImages(files: File[], allowCameraRoll = true): Promise<OnboardingResult> {
    const form = new FormData()
    form.append('allow_camera_roll', allowCameraRoll ? 'true' : 'false')
    for (const file of files.slice(0, 5)) {
      form.append('images', file, file.name || 'gallery.jpg')
    }

    const { data, error } = await this.fetch<{ ok?: boolean }>('/api/memory/onboarding/images', {
      method: 'POST',
      body: form,
    })

    if (error) {
      const status = (error as { status?: number }).status
      if (status === 401) return { ok: false, message: 'Sign in is required to save taste preferences.' }
      const detail = (error as { message?: string }).message
      return { ok: false, message: detail?.trim() || `Upload failed (${status ?? 'unknown'}).` }
    }

    return data?.ok === true
      ? { ok: true }
      : { ok: false, message: 'The server could not learn from these photos right now. You can skip and try again later.' }
  }
}
