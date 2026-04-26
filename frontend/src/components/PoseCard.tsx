import { Card } from '@/components/ui/card'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { cn } from '@/lib/utils'
import type { GalleryPose } from '@/hooks/usePoseVariants'

/** strip = horizontal carousel (fixed width). stack = sidebar column (full width). */
export type PoseCardLayout = 'strip' | 'stack'

const layoutClass: Record<PoseCardLayout, string> = {
  strip: 'w-[120px] shrink-0',
  stack: 'w-full min-w-0 max-w-full shrink',
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
        'group cursor-pointer gap-0 overflow-hidden rounded-[22px] border bg-white/5 py-0 shadow-cam-card ring-0 transition-[border-color,box-shadow,transform] duration-200 hover:border-cam-hairline',
        layoutClass[layout],
        active
          ? 'border-cam-active-border shadow-cam-card-active ring-2 ring-white/25'
          : 'border-cam-subtle-border',
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
            className="size-full min-h-0 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        </AspectRatio>
      </div>
      <p className="px-2.5 pb-[11px] pt-2 text-[0.78rem] font-[850] leading-tight text-white/[0.88]">
        {pose.title}
      </p>
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
        'relative gap-0 overflow-hidden rounded-[22px] border border-cam-subtle-border bg-white/[0.07] py-0 ring-0',
        layoutClass[layout],
        className,
      )}
      aria-hidden
    >
      <div className="relative w-full">
        <AspectRatio ratio={2 / 3}>
          <div className="relative size-full min-h-0 overflow-hidden bg-cam-hairline/25">
            <div className="cam-skeleton-shimmer absolute inset-0" />
          </div>
        </AspectRatio>
      </div>
      <div className="px-2.5 pb-[11px] pt-2">
        <div className="h-3 w-4/5 rounded-full bg-cam-hairline/80" />
      </div>
    </Card>
  )
}
