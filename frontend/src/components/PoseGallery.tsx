import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GalleryPose } from '@/hooks/usePoseVariants'
import { PoseCard, PoseCardSkeleton } from '@/components/PoseCard'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Sparkles } from 'lucide-react'

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
  loadMoreSentinel?: React.RefObject<HTMLDivElement | null>
  isLoadingMore?: boolean
  hasMore?: boolean
  onGenerate?: () => void
}

interface GalleryBodyProps {
  poses: GalleryPose[]
  activeId: string | null
  onSelect: (id: string) => void
  galleryBusy: boolean
  skeletonSlots: number
  isError: boolean
  errorMessage: string | null
  selectedTitle: string
  variant: 'sheet' | 'dialog'
  loadMoreSentinel?: React.RefObject<HTMLDivElement | null>
  isLoadingMore?: boolean
  hasMore?: boolean
  onGenerate?: () => void
}

function GalleryBody({
  poses,
  activeId,
  onSelect,
  galleryBusy,
  skeletonSlots,
  isError,
  errorMessage,
  selectedTitle,
  variant,
  loadMoreSentinel,
  isLoadingMore,
  hasMore,
  onGenerate,
}: GalleryBodyProps) {
  const hasContent = poses.length > 0 || galleryBusy
  const isEmpty = !hasContent && !isError

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col',
        variant === 'sheet' && 'mx-auto md:max-w-2xl',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'shrink-0 border-b border-cam-hairline/50 bg-gradient-to-b from-white/10 to-transparent',
          variant === 'sheet' ? 'px-6 pt-5 pb-4' : 'px-6 pt-5 pb-4',
        )}
      >
        <p className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-cam-ink-muted/80">
          {galleryBusy ? 'AI pose recommendations' : 'Pose recommendations'}
        </p>
        <h2 className="mt-2 text-lg font-black tracking-tight text-cam-ink md:text-xl">
          {galleryBusy ? 'Generating…' : selectedTitle}
        </h2>
        {galleryBusy && (
          <p className="mt-1 text-xs text-cam-ink-muted/70">
            Creating personalized poses for you
          </p>
        )}
      </div>

      {/* Error state */}
      {isError && errorMessage ? (
        <div className="mx-6 mt-4 rounded-xl border border-cam-error/30 bg-cam-error/10 px-4 py-3">
          <p className="text-sm font-medium text-cam-error">{errorMessage}</p>
        </div>
      ) : null}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-cam-hairline/20">
              <svg
                className="h-8 w-8 text-cam-ink-muted/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-cam-ink">No poses yet</h3>
            <p className="mt-1 text-xs text-cam-ink-muted">
              Generate poses to get started
            </p>
            {onGenerate && (
              <Button
                onClick={onGenerate}
                disabled={galleryBusy}
                className="mt-4 gap-1.5 rounded-full border-cam-button-border bg-cam-button-face font-black text-cam-inverse shadow-cam-button hover:bg-cam-button-face/90"
              >
                <Sparkles className="size-3.5" />
                Generate poses
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {hasContent && (
        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          <div
            className={cn(
              'grid gap-4 pb-4',
              variant === 'sheet'
                ? 'grid-cols-2 md:grid-cols-3'
                : 'grid-cols-2 sm:grid-cols-3',
            )}
          >
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

          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-4">
              <div className="flex gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-2 w-2 animate-bounce rounded-full bg-cam-ink-muted/50"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {hasMore && loadMoreSentinel && (
            <div ref={loadMoreSentinel} className="h-4" />
          )}
        </ScrollArea>
      )}
    </div>
  )
}

export function PoseGallery(props: PoseGalleryProps) {
  const { open, onOpenChange, loadMoreSentinel, isLoadingMore, hasMore, onGenerate, ...bodyProps } = props
  /* md breakpoint = 768px (Tailwind default). Use Dialog on desktop, Sheet on mobile. */
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton
          className={cn(
            'gap-0 overflow-hidden border-cam-hairline bg-popover/95 p-0',
            'flex h-[70dvh] w-full max-w-3xl flex-col',
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Pose recommendations</DialogTitle>
            <DialogDescription>
              Choose a generated pose to match on camera.
            </DialogDescription>
          </DialogHeader>
          <GalleryBody
            {...bodyProps}
            variant="dialog"
            loadMoreSentinel={loadMoreSentinel}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            onGenerate={onGenerate}
          />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn(
          'gap-0 border-cam-hairline bg-popover/95 p-0',
          'max-h-[min(88dvh,720px)] rounded-t-3xl',
          'pb-[env(safe-area-inset-bottom,0px)]',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Pose recommendations</SheetTitle>
          <SheetDescription>
            Choose a generated pose to match on camera.
          </SheetDescription>
        </SheetHeader>
        <GalleryBody
          {...bodyProps}
          variant="sheet"
          loadMoreSentinel={loadMoreSentinel}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onGenerate={onGenerate}
        />
      </SheetContent>
    </Sheet>
  )
}
