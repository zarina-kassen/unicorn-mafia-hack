import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { GalleryPose } from '@/hooks/usePoseVariants'
import { PoseCard, PoseCardSkeleton } from '@/components/PoseCard'

export interface PoseGalleryPanelProps {
  poses: GalleryPose[]
  activeId: string | null
  onSelect: (id: string) => void
  galleryBusy: boolean
  skeletonSlots: number
  isError: boolean
  errorMessage: string | null
  selectedTitle: string
  layout: 'horizontal' | 'vertical'
}

export function PoseGalleryPanel({
  poses,
  activeId,
  onSelect,
  galleryBusy,
  skeletonSlots,
  isError,
  errorMessage,
  selectedTitle,
  layout,
}: PoseGalleryPanelProps) {
  const isVertical = layout === 'vertical'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-1">
        <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-cam-ink-muted">
          {galleryBusy ? 'AI pose recommendations' : 'Pose recommendations'}
        </p>
        <h2 className="mt-1 text-base font-black tracking-tight text-cam-ink md:text-lg">
          {galleryBusy ? 'Generating…' : selectedTitle}
        </h2>
      </div>

      {isError && errorMessage ? (
        <p className="mx-4 mt-2 text-sm text-cam-error">{errorMessage}</p>
      ) : null}

      <Separator className="my-3 bg-cam-hairline" />

      {isVertical ? (
        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="flex flex-col gap-3 px-3 pb-4">
            {poses.map((pose) => (
              <PoseCard
                key={pose.id}
                layout="stack"
                pose={pose}
                active={pose.id === activeId}
                onSelect={() => onSelect(pose.id)}
              />
            ))}
            {galleryBusy &&
              Array.from({ length: skeletonSlots }).map((_, i) => (
                <PoseCardSkeleton key={`sk-${i}`} layout="stack" />
              ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="max-h-[min(48dvh,420px)] min-h-0 flex-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-h-[200px] flex-row items-stretch gap-3 px-4 pb-4">
            {poses.map((pose) => (
              <PoseCard
                key={pose.id}
                layout="strip"
                pose={pose}
                active={pose.id === activeId}
                onSelect={() => onSelect(pose.id)}
              />
            ))}
            {galleryBusy &&
              Array.from({ length: skeletonSlots }).map((_, i) => (
                <PoseCardSkeleton key={`sk-${i}`} layout="strip" />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

type PoseGalleryMobileSheetProps = {
  variant: 'mobile-sheet'
  open: boolean
  onOpenChange: (open: boolean) => void
} & PoseGalleryPanelProps

type PoseGalleryDesktopSidebarProps = {
  variant: 'desktop-sidebar'
} & PoseGalleryPanelProps

export type PoseGalleryProps =
  | PoseGalleryMobileSheetProps
  | PoseGalleryDesktopSidebarProps

export function PoseGallery(props: PoseGalleryProps) {
  const panel: PoseGalleryPanelProps = {
    poses: props.poses,
    activeId: props.activeId,
    onSelect: props.onSelect,
    galleryBusy: props.galleryBusy,
    skeletonSlots: props.skeletonSlots,
    isError: props.isError,
    errorMessage: props.errorMessage,
    selectedTitle: props.selectedTitle,
    layout: props.layout,
  }

  if (props.variant === 'desktop-sidebar') {
    return (
      <aside
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-cam-hairline',
          'bg-[linear-gradient(180deg,var(--cam-panel-highlight),transparent_42%),var(--cam-panel)]',
          'shadow-cam-panel backdrop-blur-[22px]',
          'md:sticky md:top-[max(24px,env(safe-area-inset-top,0px))]',
          'md:max-h-[min(90dvh,920px)]',
        )}
        aria-label="Generated pose gallery"
      >
        <PoseGalleryPanel {...panel} />
      </aside>
    )
  }

  const { open, onOpenChange } = props
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn(
          'max-h-[min(88dvh,720px)] gap-0 rounded-t-3xl border-cam-hairline bg-popover/95 p-0',
          'pb-[env(safe-area-inset-bottom,0px)]',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Pose recommendations</SheetTitle>
          <SheetDescription>
            Choose a generated pose to match on camera.
          </SheetDescription>
        </SheetHeader>
        <PoseGalleryPanel {...panel} />
      </SheetContent>
    </Sheet>
  )
}
