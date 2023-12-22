import { createContext } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'

interface SupabaseContextObject {
  supabase: SupabaseClient
  session: Session | null
}

export const SupabaseContext = createContext<SupabaseContextObject | null>(null)
