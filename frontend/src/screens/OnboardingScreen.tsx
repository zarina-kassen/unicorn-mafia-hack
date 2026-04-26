import { useId } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'

import type { OnboardingResult } from '@/api/onboarding'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

interface OnboardingScreenProps {
  files: File[]
  setFiles: (files: File[]) => void
  allowLearning: boolean
  setAllowLearning: (value: boolean) => void
  skip: () => void
  mutation: UseMutationResult<OnboardingResult, Error, void>
}

export function OnboardingScreen({
  files,
  setFiles,
  allowLearning,
  setAllowLearning,
  skip,
  mutation,
}: OnboardingScreenProps) {
  const fileInputId = useId()
  const learningId = useId()

  return (
    <div className="flex min-h-dvh w-full items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-lg border-cam-hairline bg-cam-panel/90 text-cam-ink shadow-cam-panel backdrop-blur-xl">
        <CardHeader>
          <Badge
            variant="outline"
            className="mb-2 w-fit border-cam-warn-border bg-black/30 text-cam-accent"
          >
            Taste onboarding
          </Badge>
          <CardTitle className="text-2xl font-black tracking-tight">
            Pick up to 5 gallery photos
          </CardTitle>
          <CardDescription className="text-base text-cam-ink-muted">
            We use your selected images to learn your style and improve generated
            pose prompts for this account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={fileInputId}>Gallery photos</Label>
            <Input
              id={fileInputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={mutation.isPending}
              className="cursor-pointer border-cam-hairline bg-black/25 file:mr-3 file:rounded-md file:border-0 file:bg-cam-button-face file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-cam-inverse"
              onChange={(e) =>
                setFiles(Array.from(e.target.files ?? []).slice(0, 5))
              }
            />
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                {files.length}/5
              </Badge>
              <span className="text-sm text-cam-ink-muted">selected</span>
            </div>
          </div>

          <Separator className="bg-cam-hairline" />

          <div className="flex gap-3 rounded-lg border border-cam-subtle-border bg-black/20 p-3">
            <Checkbox
              id={learningId}
              checked={allowLearning}
              onCheckedChange={(v) => setAllowLearning(v === true)}
              disabled={mutation.isPending}
            />
            <Label
              htmlFor={learningId}
              className="cursor-pointer text-left text-sm leading-snug text-cam-ink-muted"
            >
              Allow using my selected photos to learn my style for pose suggestions
              (uploaded to the server for analysis).
            </Label>
          </div>

          {mutation.isError && (
            <p className="text-sm text-cam-error">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Upload failed.'}
            </p>
          )}
          {mutation.isSuccess &&
            mutation.data &&
            !mutation.data.ok && (
              <p className="text-sm text-cam-error">{mutation.data.message}</p>
            )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={skip}
            disabled={mutation.isPending}
            className="w-full border-cam-hairline sm:w-auto"
          >
            Skip for now
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending || files.length === 0 || !allowLearning
            }
            className="w-full sm:w-auto"
          >
            {mutation.isPending ? 'Uploading…' : 'Use selected photos'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
