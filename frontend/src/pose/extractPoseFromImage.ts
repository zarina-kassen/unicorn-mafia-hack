import { extractPoseMask } from '../backend/client'

export interface ExtractedPoseGuide {
  /** LLM-generated person mask URL (white foreground, transparent background). */
  photoMaskUrl: string | null
  /** Hard error message from mask extraction path. */
  error: string | null
}

/** LLM-only path: no local fallback extraction. */
export async function extractPoseGuideFromGeneratedImage(
  imageUrl: string,
): Promise<ExtractedPoseGuide> {
  try {
    const llmMask = await extractPoseMask(imageUrl)
    return { photoMaskUrl: llmMask.mask_url, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pose mask extraction failed'
    return { photoMaskUrl: null, error: message }
  }
}
