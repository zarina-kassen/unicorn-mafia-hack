import { createRootRoute, Outlet } from '@tanstack/react-router'
import '../App.css'

export const Route = createRootRoute({
  component: () => <Outlet />,
})
