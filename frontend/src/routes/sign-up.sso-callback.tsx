import { createFileRoute } from '@tanstack/react-router'
import { SignUpPage } from '@/pages/SignUpPage'

/** Clerk may complete OAuth sign-up under `/sign-up/sso-callback`. */
export const Route = createFileRoute('/sign-up/sso-callback')({
  component: SignUpPage,
})
