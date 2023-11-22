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
  submitted: 'Submitted',
  processingPayment: 'Processing Payment',
  placed: 'Placed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const statusColor = {
  submitted: 'secondary',
  processingPayment: 'secondary',
  placed: 'primary',
  processing: 'tertiary',
  shipped: 'warning',
  delivered: 'success',
  cancelled: 'danger',
}
