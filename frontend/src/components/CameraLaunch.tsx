import type { CameraState } from '@/hooks/useCamera'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface CameraLaunchProps {
  cameraState: CameraState
  onRequestCamera: () => void
  className?: string
}

export function CameraLaunch({
  cameraState,
  onRequestCamera,
  className,
}: CameraLaunchProps) {
  const launchMessage =
    cameraState.status === 'idle'
      ? 'Allow camera access to place a white pose guide over your live preview.'
      : cameraState.status === 'requesting'
        ? 'Opening camera…'
        : cameraState.status === 'denied' ||
            cameraState.status === 'unavailable' ||
            cameraState.status === 'error'
          ? cameraState.message
          : ''

  const isError =
    cameraState.status === 'denied' ||
    cameraState.status === 'unavailable' ||
    cameraState.status === 'error'

  return (
    <div
      className={cn(
        'absolute inset-0 z-[5] flex items-center justify-center p-6 md:p-8',
        className,
      )}
    >
      {/* Mobile: full-bleed gradient */}
      <div
        className="absolute inset-0 md:hidden"
        style={{
          background: `
            radial-gradient(circle at 50% 22%, var(--cam-launch-glow-center), transparent 18%),
            radial-gradient(circle at 18% 72%, var(--cam-launch-glow-warm), transparent 23%),
            linear-gradient(180deg, var(--cam-launch-dark-start), var(--cam-launch-dark-end))
          `,
        }}
        aria-hidden
      />

      <Card className="relative z-[1] w-full max-w-md border-cam-hairline bg-cam-panel/95 text-cam-ink shadow-cam-panel backdrop-blur-xl">
        <CardHeader className="space-y-1 text-center sm:text-left">
          <div
            className="mx-auto mb-2 h-[118px] w-[82px] shrink-0 rounded-[52%_48%_46%_54%_/_36%_40%_60%_64%] border-[3px] border-cam-active-border shadow-[0_0_22px_var(--cam-glow-medium)] sm:mx-0"
            style={{ transform: 'rotate(-5deg)' }}
            aria-hidden
          />
          <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-cam-accent">
            Pose camera
          </p>
          <CardTitle className="text-2xl font-black tracking-tight text-cam-ink sm:text-3xl">
            Line up before the shot.
          </CardTitle>
          <CardDescription
            className={cn(
              'text-base text-cam-ink-muted',
              isError && 'text-cam-error',
            )}
          >
            {launchMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {cameraState.status !== 'requesting' &&
            cameraState.status !== 'unavailable' && (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className={cn(
                  'h-auto rounded-full border-cam-active-border px-6 py-3.5 font-black shadow-cam-launch-btn',
                  /* outline + dark: use bg-input/30 — force solid white CTA */
                  '!bg-white !text-cam-inverse hover:!bg-white/92 hover:!text-cam-inverse',
                  'dark:!bg-white dark:!text-cam-inverse dark:hover:!bg-white/92',
                )}
                onClick={() => void onRequestCamera()}
              >
                {cameraState.status === 'idle' ? 'Enable camera' : 'Retry camera'}
              </Button>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
