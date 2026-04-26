import { Card } from '@/components/ui/card'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { cn } from '@/lib/utils'
import type { GalleryPose } from '@/hooks/usePoseVariants'

/** strip = horizontal carousel (fixed width). stack = sidebar column (full width). */
export type PoseCardLayout = 'strip' | 'stack'

const layoutClass: Record<PoseCardLayout, string> = {
  strip: 'w-[120px] shrink-0',
  stack: 'w-full min-w-0',
}

interface PoseCardProps {
  pose: GalleryPose
  active: boolean
  onSelect: () => void
  layout?: PoseCardLayout
}

export function PoseCard({
  pose,
  active,
  onSelect,
  layout = 'strip',
}: PoseCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      size="sm"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      aria-pressed={active}
      className={cn(
        'group relative cursor-pointer gap-0 overflow-hidden rounded-2xl border bg-white/5 py-0 shadow-lg transition-all duration-300',
        'hover:scale-[1.02] hover:shadow-xl',
        layoutClass[layout],
        active
          ? 'border-cam-active-border shadow-cam-card-active ring-2 ring-white/25'
          : 'border-cam-subtle-border hover:border-cam-hairline',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      <div className="relative w-full">
        <AspectRatio ratio={2 / 3}>
          <img
            src={pose.imageSrc}
            alt={pose.title}
            width={480}
            height={720}
            loading="lazy"
            decoding="async"
            sizes={layout === 'strip' ? '120px' : '(max-width: 768px) 100vw, 360px'}
            className="size-full min-h-0 object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {/* Active indicator overlay */}
          {active && (
            <div className="absolute inset-0 bg-cam-active/20 transition-opacity duration-300" />
          )}
        </AspectRatio>
        {/* Active checkmark badge */}
        {active && (
          <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-cam-active shadow-lg ring-2 ring-white/50">
            <svg
              className="h-3.5 w-3.5 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <p className="text-[0.8rem] font-[850] leading-tight text-white/90 transition-colors group-hover:text-white">
          {pose.title}
        </p>
      </div>
    </Card>
  )
}

interface PoseCardSkeletonProps {
  className?: string
  layout?: PoseCardLayout
}

export function PoseCardSkeleton({
  className,
  layout = 'strip',
}: PoseCardSkeletonProps) {
  return (
    <Card
      size="sm"
      className={cn(
        'relative gap-0 overflow-hidden rounded-2xl border border-cam-subtle-border bg-white/[0.07] py-0 shadow-lg',
        layoutClass[layout],
        className,
      )}
      aria-hidden
    >
      <div className="relative w-full">
        <AspectRatio ratio={2 / 3}>
          <div className="relative size-full min-h-0 overflow-hidden bg-cam-hairline/15">
            <div className="cam-skeleton-shimmer absolute inset-0" />
          </div>
        </AspectRatio>
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <div className="h-3.5 w-4/5 rounded-full bg-cam-hairline/60" />
      </div>
    </Card>
  )
}
