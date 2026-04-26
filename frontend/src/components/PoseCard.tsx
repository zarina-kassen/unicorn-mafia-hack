import { Card } from '@/components/ui/card'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { cn } from '@/lib/utils'
import type { GalleryPose } from '@/hooks/usePoseVariants'

interface PoseCardProps {
  pose: GalleryPose
  active: boolean
  onSelect: () => void
}

export function PoseCard({
  pose,
  active,
  onSelect,
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
        active
          ? 'border-cam-active-border shadow-cam-card-active ring-2 ring-white/25'
          : 'border-cam-subtle-border',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      <div className="relative">
        <AspectRatio ratio={2 / 3}>
          <img
            src={pose.imageSrc}
            alt={pose.title}
            className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
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
}

export function PoseCardSkeleton({ className }: PoseCardSkeletonProps) {
  return (
    <Card
      size="sm"
      className={cn(
        'relative h-[calc(clamp(116px,28vw,152px)*1.58)] gap-0 overflow-hidden rounded-[22px] border border-cam-subtle-border bg-white/5 py-0 ring-0',
        className,
      )}
    >
      <div
        className="cam-skeleton-shimmer absolute inset-0"
        aria-hidden
      />
      <span className="absolute bottom-3 left-2.5 right-6 block h-3 rounded-full bg-cam-hairline" />
    </Card>
  )
}
