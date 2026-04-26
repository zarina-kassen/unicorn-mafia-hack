import { ImagePlus, Images } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ShutterDockProps {
  canTakePicture: boolean
  onShutter: () => void
  lastCapturePreviewUrl: string | null
  onSaveLastAgain: () => void
  /** Opens the pose-gallery sheet. */
  onOpenGallery: () => void
  className?: string
}

export function ShutterDock({
  canTakePicture,
  onShutter,
  lastCapturePreviewUrl,
  onSaveLastAgain,
  onOpenGallery,
  className,
}: ShutterDockProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-[15] flex items-center justify-center',
        'bottom-[max(20px,env(safe-area-inset-bottom,0px))] md:bottom-6',
        '[&>*]:pointer-events-auto',
        className,
      )}
    >
      <div className="flex w-full max-w-[320px] items-center justify-between gap-4 px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={lastCapturePreviewUrl === null}
              onClick={() => void onSaveLastAgain()}
              className="size-[52px] shrink-0 overflow-hidden rounded-full border-[2.5px] border-white/90 bg-black/55 p-0 shadow-lg hover:bg-black/65"
              aria-label="Save the last capture again"
            >
              {lastCapturePreviewUrl ? (
                <img
                  src={lastCapturePreviewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <ImagePlus className="size-5 text-white/50" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save last capture again</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void onShutter()}
              disabled={!canTakePicture}
              aria-label={
                canTakePicture
                  ? 'Take picture and save to device'
                  : 'Choose a pose and wait for the outline guide to take a picture'
              }
              className="flex size-[76px] shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-4 border-white/95 bg-black/35 shadow-xl outline-none transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="size-14 rounded-full bg-white shadow-inner" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Capture aligned photo</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onOpenGallery()}
              className="size-[52px] shrink-0 overflow-hidden rounded-full border-[2.5px] border-white/90 bg-black/55 p-0 text-white shadow-lg hover:bg-black/65"
              aria-label="Open pose gallery"
            >
              <Images className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Choose a pose</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
