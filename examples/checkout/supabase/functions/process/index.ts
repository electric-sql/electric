// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function errorResponse(msg: string) {
  return new Response(JSON.stringify({ msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function asyncTimeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (request: Request) => {
  let id: string | undefined
  if (request.method == 'POST') {
    const body = await request.text()
    const data = JSON.parse(body)
    id = data.id
    if (!id) {
      return errorResponse('missing id in request')
    }
  } else {
    return errorResponse('invalid request method')
  }

  const authHeader = request.headers.get('Authorization')!
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data, error } = await supabaseClient
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    return errorResponse(error.message)
  }

  // Update the item status to 'processingPayment'
  const { data: result, error: updateError } = await supabaseClient
    .from('orders')
    .update({ status: 'processingPayment' })
    .eq('id', id)
    .single()

  // Simulate a payment processing delay
  await asyncTimeout(1500)

  // Update the item status to 'placed'
  const { data: result2, error: updateError2 } = await supabaseClient
    .from('orders')
    .update({ status: 'placed' })
    .eq('id', id)
    .single()

  return new Response(JSON.stringify({ msg: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
