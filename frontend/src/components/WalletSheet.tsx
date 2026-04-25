import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/react'

import {
  ApiError,
  createCheckoutSession,
  CREDIT_PACKS,
  getBillingAccount,
  type BillingAccount,
  type GetToken,
} from '@/backend/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const checkoutLoadingId = (id: string) => `wallet-checkout-${id}`

export interface WalletSheetProps {
  open: boolean
  onClose: () => void
  baseUrl: string
  getToken: GetToken
  onBalanceUpdated?: () => void
}

export function WalletSheet({ open, onClose, baseUrl, getToken, onBalanceUpdated }: WalletSheetProps) {
  const { isSignedIn } = useAuth()
  const [account, setAccount] = useState<BillingAccount | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setAccount(null)
      setLoadError(null)
      return
    }
    setLoadError(null)
    try {
      const next = await getBillingAccount(baseUrl, getToken)
      setAccount(next)
      onBalanceUpdated?.()
    } catch (err) {
      setAccount(null)
      setLoadError(err instanceof Error ? err.message : 'Could not load balance.')
    }
  }, [baseUrl, getToken, isSignedIn, onBalanceUpdated])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(t)
  }, [open, refresh])

  const onBuyPack = useCallback(
    async (packId: (typeof CREDIT_PACKS)[number]['pack_id']) => {
      if (!isSignedIn) return
      setCheckoutLoading(checkoutLoadingId(packId))
      setLoadError(null)
      try {
        const returnUrl = typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''
        const session = await createCheckoutSession(
          { pack_id: packId, success_url: returnUrl, cancel_url: returnUrl },
          baseUrl,
          getToken,
        )
        window.location.href = session.checkout_url
      } catch (err) {
        const message =
          err instanceof ApiError ? err.detail?.message ?? err.message : 'Checkout could not start.'
        setLoadError(message)
      } finally {
        setCheckoutLoading(null)
      }
    },
    [baseUrl, getToken, isSignedIn],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Credits and top up"
    >
      <button
        type="button"
        className="min-h-0 flex-1 cursor-default"
        aria-label="Close wallet"
        onClick={onClose}
      />
      <div
        className={cn(
          'max-h-[min(88vh,520px)] w-full overflow-y-auto rounded-t-2xl border border-border/60',
          'bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg',
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">Credits</h2>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>

        {!isSignedIn ? (
          <p className="text-sm text-muted-foreground">Sign in to see your balance and add credits.</p>
        ) : loadError && !account ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : account ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance</p>
              <p className="text-2xl font-semibold tabular-nums">{account.balance}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Plan: {account.plan_type} · {account.free_monthly_credits} free credits / month
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              <p>Live coaching: {account.guidance_cost} credit per tip</p>
              <p>Generate poses: {account.pose_variant_cost} credits per run</p>
            </div>
            {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Top up (Stripe)</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {CREDIT_PACKS.map((pack) => (
                  <Button
                    key={pack.pack_id}
                    type="button"
                    className="flex-1"
                    disabled={checkoutLoading !== null}
                    onClick={() => void onBuyPack(pack.pack_id)}
                  >
                    {checkoutLoading === checkoutLoadingId(pack.pack_id)
                      ? 'Redirecting…'
                      : `Buy ${pack.label}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  )
}
