import { useAuth, useClerk } from '@clerk/react'
import { useCallback } from 'react'

/**
 * Returns a function that returns true only when the user is signed in.
 * If Clerk has finished loading and the user is signed out, opens the Clerk sign-in modal.
 */
export function useRequireAuthAction() {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()

  const ensureSignedIn = useCallback((): boolean => {
    if (!isLoaded) return false
    if (isSignedIn) return true
    clerk.openSignIn({})
    return false
  }, [clerk, isLoaded, isSignedIn])

  return { ensureSignedIn, isLoaded, isSignedIn }
}
