import { createFileRoute, Outlet } from '@tanstack/react-router'

/** Layout: children handle `/sign-in/sso-callback` and other Clerk subpaths. */
export const Route = createFileRoute('/sign-in')({
  component: () => <Outlet />,
})
