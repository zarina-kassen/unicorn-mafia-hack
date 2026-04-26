import type { ReactNode, RefObject } from 'react'

import { cn } from '@/lib/utils'

interface CameraFrameProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** Pose overlay canvas (rendered above video, below vignette) */
  overlay?: ReactNode
  shutterFlashActive: boolean
  onShutterFlashEnd: () => void
  generateFlashActive: boolean
  onGenerateFlashEnd: () => void
  className?: string
}

export function CameraFrame({
  videoRef,
  overlay,
  shutterFlashActive,
  onShutterFlashEnd,
  generateFlashActive,
  onGenerateFlashEnd,
  className,
}: CameraFrameProps) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden bg-cam-surface',
        'h-full min-h-0 w-full md:h-auto',
        'md:mx-auto md:aspect-[9/16] md:max-h-[min(82dvh,860px)] md:w-full md:max-w-[min(420px,42vw)]',
        'md:rounded-3xl md:border md:border-cam-hairline md:shadow-cam-preview',
        className,
      )}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full -scale-x-100 bg-cam-surface object-cover"
        playsInline
        muted
      />
      {overlay}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg, var(--cam-vignette-top) 0%, transparent 25%),
            linear-gradient(0deg, var(--cam-vignette-bottom) 0%, transparent 34%),
            radial-gradient(circle at center, transparent 46%, var(--cam-vignette-edge) 100%)
          `,
        }}
        aria-hidden
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-10 bg-white opacity-0',
          shutterFlashActive && 'cam-shutter-flash-active',
        )}
        aria-hidden
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onShutterFlashEnd()
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-9 opacity-0',
          generateFlashActive && 'cam-generate-flash-active',
        )}
        aria-hidden
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onGenerateFlashEnd()
        }}
      />
    </div>
  )
}
