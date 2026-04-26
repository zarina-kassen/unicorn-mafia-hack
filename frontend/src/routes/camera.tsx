import { createFileRoute } from '@tanstack/react-router'
import { CameraPage } from '@/pages/CameraPage'

export const Route = createFileRoute('/camera')({
  component: CameraPage,
})
