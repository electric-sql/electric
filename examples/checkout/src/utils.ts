import type { SupabaseClient } from '@supabase/supabase-js'

export function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price / 100)
}

export async function getSupabaseJWT(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new Error('No token')
  }
  return token
}

export const statusDisplay = {
  awaitingSubmission: 'Awaiting Submission',
  submitted: 'Submitted',
  processingPayment: 'Processing Payment',
  placed: 'Placed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export type Status = keyof typeof statusDisplay

export const statusColor: {
  [key in Status]: string
} = {
  awaitingSubmission: 'warning',
  submitted: 'secondary',
  processingPayment: 'secondary',
  placed: 'success',
  shipped: 'success',
  delivered: 'success',
  cancelled: 'danger',
}
