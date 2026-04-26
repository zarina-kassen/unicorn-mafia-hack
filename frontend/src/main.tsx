import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { router } from './router'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const queryClient = new QueryClient()

const app = (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={200}>
      <ErrorBoundary>
        <RouterProvider router={router} />
        <Toaster position="top-center" richColors closeButton />
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {PUBLISHABLE_KEY ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        {app}
      </ClerkProvider>
    ) : (
      app
    )}
  </StrictMode>,
)
