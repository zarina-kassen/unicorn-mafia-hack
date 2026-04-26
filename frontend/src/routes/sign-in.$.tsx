import { createFileRoute } from '@tanstack/react-router'
import { SignInPage } from '@/pages/SignInPage'

/** Catch-all for Clerk path routes (e.g. factor flows) not covered by explicit child routes. */
export const Route = createFileRoute('/sign-in/$')({
  component: SignInPage,
})
