import { type GetToken, createApiClient } from './base'

export interface ApiErrorDetail {
  code?: string
  message?: string
  remaining_credits?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: ApiErrorDetail | null

  constructor(message: string, status: number, detail: ApiErrorDetail | null = null) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export const CREDIT_PACKS = [
  { pack_id: 'pack_100' as const, credits: 100, label: '100 credits' },
  { pack_id: 'pack_200' as const, credits: 200, label: '200 credits' },
] as const

export interface BillingAccount {
  user_id: string
  plan_type: string
  balance: number
  free_monthly_credits: number
  guidance_cost: number
  pose_variant_cost: number
  has_stripe_customer: boolean
}

export interface CheckoutSessionResponse {
  checkout_url: string
  session_id: string
}

export async function getBillingAccount(getToken?: GetToken): Promise<BillingAccount> {
  const apiFetch = createApiClient(getToken)
  const { data, error } = await apiFetch<BillingAccount>('/api/billing/account')
  if (error) {
    const status = (error as { status?: number }).status ?? 500
    throw new ApiError(`Billing account request failed (${status})`, status, null)
  }
  return data as BillingAccount
}

export async function createCheckoutSession(
  payload: { pack_id: (typeof CREDIT_PACKS)[number]['pack_id']; success_url: string; cancel_url: string },
  getToken?: GetToken,
): Promise<CheckoutSessionResponse> {
  const apiFetch = createApiClient(getToken)
  const { data, error } = await apiFetch<CheckoutSessionResponse>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  })
  if (error) {
    const status = (error as { status?: number }).status ?? 500
    throw new ApiError(`Checkout session failed (${status})`, status, null)
  }
  return data as CheckoutSessionResponse
}
