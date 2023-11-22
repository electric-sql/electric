import { createContext } from 'react';
import { type SupabaseClient } from "@supabase/supabase-js";

export const SupabaseContext = createContext<SupabaseClient | null>(null);
