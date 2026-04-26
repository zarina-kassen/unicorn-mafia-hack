import { useEffect, useRef } from 'react'

/**
 * Custom hook for infinite scroll detection using Intersection Observer.
 * Triggers the callback when the sentinel element comes into view.
 *
 * @param callback - Function to call when scroll threshold is reached
 * @param options - Intersection Observer options
 * @param options.rootMargin - Margin around the root (default: '200px' for early trigger)
 * @param options.threshold - Visibility threshold (default: 0.1)
 * @param options.enabled - Whether the observer is active (default: true)
 */
export function useInfiniteScroll(
  callback: () => void,
  {
    rootMargin = '200px',
    threshold = 0.1,
    enabled = true,
  }: {
    rootMargin?: string
    threshold?: number
    enabled?: boolean
  } = {}
) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const callbackRef = useRef(callback)

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          callbackRef.current()
        }
      },
      { rootMargin, threshold }
    )

    observer.observe(sentinelRef.current)
    observerRef.current = observer

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [rootMargin, threshold, enabled])

  return sentinelRef as React.RefObject<HTMLDivElement | null>
}
