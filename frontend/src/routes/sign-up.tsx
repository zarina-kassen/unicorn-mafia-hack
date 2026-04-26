import { createFileRoute, Outlet } from '@tanstack/react-router'

/** Layout: children handle `/sign-up/sso-callback` and other Clerk subpaths. */
export const Route = createFileRoute('/sign-up')({
  component: () => <Outlet />,
})
