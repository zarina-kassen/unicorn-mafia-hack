import { createFileRoute } from '@tanstack/react-router'
import { SignInPage } from '@/pages/SignInPage'

/** Clerk OAuth/SSO completes at `/sign-in/sso-callback`; must match in the SPA router. */
export const Route = createFileRoute('/sign-in/sso-callback')({
  component: SignInPage,
})
