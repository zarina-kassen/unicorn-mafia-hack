import { ImagePlus } from 'lucide-react'

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
  variant: 'overlay' | 'inline'
  className?: string
}

export function ShutterDock({
  canTakePicture,
  onShutter,
  lastCapturePreviewUrl,
  onSaveLastAgain,
  variant,
  className,
}: ShutterDockProps) {
  const isOverlay = variant === 'overlay'

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        isOverlay &&
          'pointer-events-none absolute inset-x-0 bottom-[calc(100px+env(safe-area-inset-bottom,0px))] z-[15] [&>*]:pointer-events-auto md:static md:inset-auto md:bottom-auto md:z-auto md:mt-4 md:pb-0',
        !isOverlay && 'mt-4',
        className,
      )}
    >
      <div className="grid w-full max-w-[280px] grid-cols-[1fr_auto_1fr] items-center gap-2 md:max-w-[320px]">
        <div className="flex justify-end pr-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={lastCapturePreviewUrl === null}
                onClick={() => void onSaveLastAgain()}
                className="size-[50px] shrink-0 overflow-hidden rounded-full border-[2.5px] border-white/90 bg-black/55 p-0 shadow-lg hover:bg-black/65"
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
        </div>

        <div className="flex justify-center">
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
                className={cn(
                  'flex size-[76px] shrink-0 cursor-pointer items-center justify-center rounded-full border-4 border-white/95 bg-black/35 shadow-xl outline-none transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55',
                  'touch-manipulation',
                )}
              >
                <span className="size-14 rounded-full bg-white shadow-inner" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Capture aligned photo</TooltipContent>
          </Tooltip>
        </div>

        <div aria-hidden className="min-w-0" />
      </div>
    </div>
  )
}
