import { createFileRoute } from '@tanstack/react-router'
import { SignUpPage } from '@/pages/SignUpPage'

/** Catch-all for Clerk path routes (e.g. `/sign-up/verify-email-address`). */
export const Route = createFileRoute('/sign-up/$')({
  component: SignUpPage,
})
