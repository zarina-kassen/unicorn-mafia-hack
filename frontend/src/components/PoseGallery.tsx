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

export interface PoseGalleryProps {
  poses: GalleryPose[]
  activeId: string | null
  onSelect: (id: string) => void
  galleryBusy: boolean
  skeletonSlots: number
  isError: boolean
  errorMessage: string | null
  selectedTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PoseGallery({
  poses,
  activeId,
  onSelect,
  galleryBusy,
  skeletonSlots,
  isError,
  errorMessage,
  selectedTitle,
  open,
  onOpenChange,
}: PoseGalleryProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn(
          'gap-0 border-cam-hairline bg-popover/95 p-0',
          'max-h-[min(88dvh,720px)] rounded-t-3xl',
          'pb-[env(safe-area-inset-bottom,0px)]',
          /* From md+ center the sheet and cap its width like a desktop modal. */
          'md:!inset-x-auto md:left-1/2 md:!-translate-x-1/2',
          'md:!w-[min(640px,82vw)] md:!max-w-[640px]',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Pose recommendations</SheetTitle>
          <SheetDescription>
            Choose a generated pose to match on camera.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-3">
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
        </div>
      </SheetContent>
    </Sheet>
  )
}
