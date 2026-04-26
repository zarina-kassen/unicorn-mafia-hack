import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface CameraTopBarProps {
  onPrevPose: () => void
  onNextPose: () => void
  onClearSelection: () => void
  poseCount: number
  galleryBusy: boolean
  className?: string
}

export function CameraTopBar({
  onPrevPose,
  onNextPose,
  onClearSelection,
  poseCount,
  galleryBusy,
  className,
}: CameraTopBarProps) {
  const navDisabled = poseCount < 2 || galleryBusy

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2',
        'pointer-events-none [&>*]:pointer-events-auto',
        className,
      )}
      style={{ textShadow: 'var(--shadow-cam-text)' }}
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full border border-white/15 bg-black/45 text-cam-ink backdrop-blur-md hover:bg-black/55"
              disabled={navDisabled}
              onClick={onPrevPose}
              aria-label="Previous pose"
            >
              <ChevronLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Previous pose</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full border border-white/15 bg-black/45 text-cam-ink backdrop-blur-md hover:bg-black/55"
              disabled={navDisabled}
              onClick={onNextPose}
              aria-label="Next pose"
            >
              <ChevronRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Next pose</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full border border-white/15 bg-black/45 text-cam-ink backdrop-blur-md hover:bg-black/55"
              onClick={onClearSelection}
              aria-label="Clear pose selection"
            >
              <RotateCcw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Reset selection</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
