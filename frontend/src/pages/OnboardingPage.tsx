import { useOnboarding } from '@/hooks/useOnboarding'
import { Button } from '@/components/ui/button'
import { Navigate } from '@tanstack/react-router'

export function OnboardingPage() {
  const {
    done,
    files,
    setFiles,
    allowLearning,
    setAllowLearning,
    skip: skipOnboarding,
    mutation: onboardingMutation,
  } = useOnboarding()

  if (done) {
    return <Navigate to="/camera" replace />
  }

  return (
    <div className="min-h-screen min-h-dvh w-full max-w-none overflow-x-hidden">
      <main className="stage-two-shell">
        <section className="camera-preview">
          <div className="camera-launch">
            <div className="launch-mark" aria-hidden="true" />
            <p className="launch-kicker">Taste onboarding</p>
            <h1>Pick up to 5 gallery photos.</h1>
            <p>
              We use your selected images to learn your style and improve
              generated pose prompts for this account.
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) =>
                setFiles(Array.from(e.target.files ?? []).slice(0, 5))
              }
              disabled={onboardingMutation.isPending}
            />
            <p>{files.length}/5 selected</p>
            <label className="mt-2 flex max-w-[min(340px,92vw)] cursor-pointer items-start gap-2 text-left text-[0.9rem] leading-snug text-cam-ink-muted">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={allowLearning}
                onChange={(e) => setAllowLearning(e.target.checked)}
                disabled={onboardingMutation.isPending}
              />
              <span>
                Allow using my selected photos to learn my style for pose
                suggestions (uploaded to the server for analysis).
              </span>
            </label>
            {onboardingMutation.isError && (
              <p className="error">
                {onboardingMutation.error instanceof Error
                  ? onboardingMutation.error.message
                  : 'Upload failed.'}
              </p>
            )}
            {onboardingMutation.isSuccess && !onboardingMutation.data.ok && (
              <p className="error">{onboardingMutation.data.message}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => onboardingMutation.mutate()}
                disabled={
                  onboardingMutation.isPending ||
                  files.length === 0 ||
                  !allowLearning
                }
              >
                {onboardingMutation.isPending
                  ? 'Uploading...'
                  : 'Use selected photos'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={skipOnboarding}
                disabled={onboardingMutation.isPending}
              >
                Skip for now
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
